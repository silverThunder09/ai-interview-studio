/** Verify actual main push runs and their checkout logs inside GitHub Actions. */
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { REPO, RuntimeAPI } from './loop-coordinator.mjs';
import { APIError } from './event-worker.ts';

const SHA = /^[a-f0-9]{40}$/;
const CHECKOUT = 'Run actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const TYPES = [['.github/workflows/ci.yml', 'checks'], ['.github/workflows/windows-build.yml', 'package']];
const validId = n => Number.isSafeInteger(n) && n > 0;
function ensure(value, code) { if (!value) throw new Error(code); }
const DIAGNOSTICS = new Set(['untrusted_context', 'main_changed', 'main_ci_missing', 'main_ci_not_successful', 'main_ci_job_missing', 'main_ci_job_invalid', 'main_checkout_missing', 'main_checkout_invalid', 'main_checkout_unproven', 'main_ci_changed', 'missing_api_page', 'api_pagination_limit', 'job_log_http_error', 'untrusted_job_log_redirect', 'job_log_download_failed']);

/** Never print arbitrary exception text, URLs, headers, credentials or logs. */
export function mainCIFailure(error) {
  const proxy = error?.cause?.cause;
  const detail = error instanceof APIError && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? `github_http_${error.status}`
    : proxy?.code === 'UND_ERR_ABORTED' && proxy?.message === 'Proxy response (403) !== 200 when HTTP Tunneling' ? 'proxy_http_403'
    : DIAGNOSTICS.has(error?.message) ? error.message : 'unclassified';
  return { state: 'hold', reason: 'main_ci_unavailable', detail };
}

export function selectNativeMainRun(runs, path, main) {
  const matches = runs.filter(r => r.path === path && ['push', 'workflow_dispatch'].includes(r.event) && r.head_sha === main && r.head_branch === 'main' && r.repository?.full_name === REPO && r.head_repository?.full_name === REPO);
  ensure(matches.length && matches.every(r => validId(r.id) && validId(r.run_attempt) && Number.isFinite(Date.parse(r.updated_at))), 'main_ci_missing');
  matches.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
  return matches[0];
}

export async function verifyNativeMainCI({ api, main }) {
  ensure(SHA.test(main ?? '') && (await api.request('GET', '/branches/main'))?.commit?.sha === main, 'main_changed');
  const list = () => api.pagesObject(`/actions/runs?branch=main&head_sha=${main}`, 'workflow_runs');
  const runs = await list();
  for (const [path, name] of TYPES) {
    const selected = selectNativeMainRun(runs, path, main);
    const fresh = await api.request('GET', `/actions/runs/${selected.id}`);
    ensure(['id', 'path', 'event', 'head_sha', 'head_branch', 'run_attempt', 'updated_at'].every(k => fresh?.[k] === selected[k]) && fresh.repository?.full_name === REPO && fresh.head_repository?.full_name === REPO && fresh.status === 'completed' && fresh.conclusion === 'success', 'main_ci_not_successful');
    const jobs = await api.pagesObject(`/actions/runs/${fresh.id}/attempts/${fresh.run_attempt}/jobs`, 'jobs');
    const matching = jobs.filter(job => job.name === name);
    ensure(matching.length === 1, 'main_ci_job_missing');
    const job = matching[0];
    ensure(validId(job.id) && job.run_id === fresh.id && job.run_attempt === fresh.run_attempt && job.status === 'completed' && job.conclusion === 'success' && Array.isArray(job.steps), 'main_ci_job_invalid');
    const steps = job.steps.filter(step => step.name === CHECKOUT);
    ensure(steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success', 'main_checkout_missing');
    const start = Date.parse(steps[0].started_at), end = Date.parse(steps[0].completed_at) + 999;
    ensure(Number.isFinite(start) && Number.isFinite(end) && start <= end, 'main_checkout_invalid');
    const log = await api.jobLog(job.id);
    ensure(typeof log === 'string' && Buffer.byteLength(log, 'utf8') <= 16 * 1024 * 1024, 'main_checkout_invalid');
    const rows = log.replaceAll('\r\n', '\n').split('\n').flatMap(line => {
      const m = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z) (.*)$/);
      if (!m) return [];
      const t = Date.parse(m[1]); return t >= start && t <= end ? [m[2].replace(/\r$/, '')] : [];
    });
    const indexes = rows.flatMap((line, i) => /^\[command\](?:\/usr\/bin\/git|"[A-Za-z]:\\[^"\r\n]+\\git\.exe") log -1 --format=%H$/.test(line) ? [i] : []);
    ensure(indexes.length === 1 && rows[indexes[0] + 1] === main, 'main_checkout_unproven');
    const again = await api.request('GET', `/actions/runs/${fresh.id}`);
    ensure(['id', 'run_attempt', 'updated_at', 'status', 'conclusion'].every(k => again?.[k] === fresh[k]), 'main_ci_changed');
  }
  const last = await list();
  for (const [path] of TYPES) {
    const a = selectNativeMainRun(runs, path, main), b = selectNativeMainRun(last, path, main);
    ensure(a.id === b.id && a.run_attempt === b.run_attempt && a.updated_at === b.updated_at, 'main_ci_changed');
  }
  ensure((await api.request('GET', '/branches/main'))?.commit?.sha === main, 'main_changed');
  return { state: 'ready' };
}

async function main() {
  const token = process.env.GITHUB_TOKEN, expected = process.env.GITHUB_SHA;
  ensure(token && SHA.test(expected ?? '') && process.env.GITHUB_REPOSITORY === REPO && process.env.GITHUB_REF === 'refs/heads/main', 'untrusted_context');
  const local = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { timeout: 15000 })).stdout.trim();
  ensure(local === expected, 'main_changed');
  console.log(JSON.stringify(await verifyNativeMainCI({ api: new RuntimeAPI(token), main: expected })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(JSON.stringify(mainCIFailure(error))); process.exitCode = 1; });

/** Trusted-main CI completion bridge. Reads GitHub state; only dispatches the fixed coordinator. */
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { GitHub, APIError } from './event-worker.ts';
import { LoopStore, parseLoopConfig, REPO } from './loop-coordinator.mjs';
const SHA = /^[a-f0-9]{40}$/, KEY = /^[a-f0-9]{64}$/;
function ensure(value, code) { if (!value) throw new Error(code); }
export function parseWaitRequest(value) {
  ensure(value && typeof value.pr === 'string' && /^(0|[1-9][0-9]*)$/.test(value.pr) && Number.isSafeInteger(Number(value.pr)) && ['head', 'base', 'checkout'].every(k => typeof value[k] === 'string' && SHA.test(value[k])) && typeof value.key === 'string' && KEY.test(value.key), 'invalid_wait_request');
  return { pr: value.pr, head: value.head, base: value.base, checkout: value.checkout, key: value.key };
}
export function isPendingWakeup(state, input) {
  const r = parseWaitRequest(input);
  if (state?.repository !== REPO || !Array.isArray(state.tasks)) return false;
  if (r.pr === '0') {
    const bootstrap = state.bootstrap, check = bootstrap?.checks?.at(-1) ?? bootstrap;
    if (bootstrap?.ready === false && check?.key === r.key && check.main === r.head && r.head === r.base && r.head === r.checkout) return true;
    return state.tasks.some(t => t.phase === 'main-ci' && t.operation?.key === r.key && t.merged === r.head && r.head === r.base && r.head === r.checkout);
  }
  return state.tasks.some(t => t.pr === Number(r.pr) && t.phase === 'ci' && t.operation?.key === r.key && t.head === r.head && t.base === r.base && t.checkout === r.checkout);
}
async function runs(api, query) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const data = await api.request('GET', `/actions/runs?event=workflow_dispatch&${query}&per_page=100&page=${page}`);
    ensure(Array.isArray(data?.workflow_runs) && data.workflow_runs.length <= 100, 'incomplete_wait_runs');
    result.push(...data.workflow_runs);
    if (data.workflow_runs.length < 100) return result;
  }
  throw new Error('wait_pagination_limit');
}
function matching(list, path, title) {
  return list.filter(r => r.path === path && r.display_title === title && r.repository?.full_name === REPO && r.event === 'workflow_dispatch');
}
export async function waitForCI({ api, loadState, input, now = Date.now, sleep = pause, timeout = 35 * 60 * 1000, allowDispatch = true }) {
  const r = parseWaitRequest(input), deadline = now() + timeout;
  ensure(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 35 * 60 * 1000, 'invalid_wait_timeout');
  while (true) {
    if (!isPendingWakeup(await loadState(), r)) return { state: 'consumed' };
    const candidates = matching(await runs(api, `head_sha=${r.head}`), '.github/workflows/loop-validation.yml', `Approved loop ${r.key}`);
    ensure(candidates.length <= 1, 'ambiguous_wait_ci');
    const run = candidates[0];
    if (run) ensure(Number.isSafeInteger(run.id) && run.id > 0 && run.head_sha === r.head && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'invalid_wait_ci');
    if (run?.status === 'completed') {
      ensure(typeof run.conclusion === 'string' && run.conclusion.length > 0, 'missing_wait_conclusion');
      // Failed CI is handed back too. Only the coordinator verifies proofs/decides whether to pause.
      const previous = matching(await runs(api, 'branch=main'), '.github/workflows/approved-loop.yml', `Approved continuation ${r.key}`);
      ensure(previous.length <= 1, 'ambiguous_wait_delivery');
      if (previous.length) return { state: 'already-woken', ci_run: run.id };
      if (!isPendingWakeup(await loadState(), r)) return { state: 'consumed' };
      ensure(allowDispatch === true, 'ambiguous_wait_delivery');
      // No retry after an ambiguous write response; a rerun must inspect the API receipt first.
      await api.request('POST', '/actions/workflows/approved-loop.yml/dispatches', { ref: 'main', inputs: { key: r.key } });
      return { state: 'woken', ci_run: run.id };
    }
    ensure(now() < deadline, 'wait_ci_timeout');
    await sleep(Math.min(30000, deadline - now()));
  }
}
async function main() {
  ensure(process.env.GITHUB_REPOSITORY === REPO && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF === 'refs/heads/main' && SHA.test(process.env.AIS_CHECKOUT_SHA ?? '') && process.env.AIS_CHECKOUT_SHA === process.env.GITHUB_SHA && process.env.GITHUB_TOKEN, 'untrusted_wait_context');
  const input = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')).inputs;
  const config = parseLoopConfig(JSON.parse(await readFile('.github/approved-loop.json', 'utf8')));
  ensure(config.enabled, 'wait_loop_disabled');
  const api = new GitHub(process.env.GITHUB_TOKEN), store = new LoopStore(api, config);
  const result = await waitForCI({ api, loadState: async () => (await store.load()).state, input, allowDispatch: process.env.GITHUB_RUN_ATTEMPT === '1' });
  console.log(JSON.stringify({ repository: REPO, ...result }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(JSON.stringify({ error: error instanceof APIError ? `github_http_${error.status}` : /^[a-z0-9_]+$/.test(error.message ?? '') ? error.message : 'ci_wait_failed' })); process.exitCode = 1;
});

/** Read-only CI/API evidence boundary. No credentials, permission decisions or merge effects. */
import { Buffer } from 'node:buffer';
const REPOSITORY = 'silverThunder09/ai-interview-studio';
const CONTEXTS = ['checks', 'package', 'pr-policy'];
const SHA = /^[a-f0-9]{40}$/;
function requireValue(value, code) { if (!value) throw new Error(code); }
function object(value) { requireValue(value && typeof value === 'object' && !Array.isArray(value), 'invalid_api_object'); return value; }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function time(value) { const n = typeof value === 'string' ? Date.parse(value) : NaN; requireValue(Number.isFinite(n), 'invalid_api_time'); return n; }
function expected(value) {
  const e = object(value);
  requireValue(e.repository === REPOSITORY && positive(e.pr_number) && ['head_sha', 'base_sha', 'checkout_sha'].every(k => typeof e[k] === 'string' && SHA.test(e[k])) && CONTEXTS.includes(e.context), 'invalid_expected_ci');
  return e;
}
function compactJSON(value) {
  let result = '', quoted = false, escaped = false;
  for (const char of value) {
    if (quoted || !/[\t\r\n ]/.test(char)) result += char;
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
  }
  return result;
}
export function latestCheck(checks, context) {
  requireValue(Array.isArray(checks) && CONTEXTS.includes(context), 'missing_check_list');
  const matches = checks.filter(c => object(c).name === context);
  requireValue(matches.length && matches.every(c => positive(c.id)), 'missing_or_invalid_check');
  return [...matches].sort((a, b) => b.id - a.id)[0];
}
export function readJobCIEvidence(expectedValue, checks, runValue, jobValue, log) {
  const e = expected(expectedValue), check = latestCheck(checks, e.context), run = object(runValue), job = object(jobValue);
  requireValue(check.head_sha === e.head_sha && object(check.app).slug === 'github-actions' && check.status === 'completed' && check.conclusion === 'success', 'untrusted_or_unsuccessful_check');
  const allowedEvent = run.event === 'pull_request' || (run.event === 'workflow_dispatch' && run.path === '.github/workflows/loop-validation.yml');
  requireValue(positive(run.id) && positive(run.run_attempt) && run.status === 'completed' && run.conclusion === 'success' && allowedEvent && run.head_sha === e.head_sha && object(run.repository).full_name === REPOSITORY, 'invalid_or_stale_run');
  requireValue(positive(job.id) && job.run_id === run.id && job.run_attempt === run.run_attempt && job.name === e.context && job.status === 'completed' && job.conclusion === 'success', 'invalid_or_stale_job');
  requireValue(check.details_url === `https://github.com/${REPOSITORY}/actions/runs/${run.id}/job/${job.id}`, 'wrong_check_job');
  requireValue(Array.isArray(job.steps), 'missing_job_steps');
  const steps = job.steps.filter(s => object(s).name === 'Record tested head and base');
  requireValue(steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success', 'unsuccessful_evidence_step');
  const start = time(steps[0].started_at), end = time(steps[0].completed_at) + 999;
  requireValue(start <= end && typeof log === 'string' && Buffer.byteLength(log, 'utf8') <= 16 * 1024 * 1024, 'invalid_job_log');
  const rows = log.replaceAll('\r\n', '\n').split('\n').flatMap(line => {
    const m = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z) (.*)$/);
    if (!m) return [];
    const t = time(m[1]); return t >= start && t <= end ? [m[2]] : [];
  });
  const command = '##[group]Run node scripts/review/ci-evidence.mjs';
  const positions = rows.flatMap((line, i) => line === command ? [i] : []);
  requireValue(positions.length === 1, 'missing_or_ambiguous_evidence_command');
  const from = positions[0], next = rows.findIndex((line, i) => i > from && line.startsWith('##[group]'));
  const segment = rows.slice(from + 1, next < 0 ? undefined : next);
  // Runner prints command/environment inside the group; actual stdout follows its final end marker.
  const endGroup = segment.lastIndexOf('##[endgroup]');
  requireValue(endGroup >= 0, 'missing_command_end');
  let last;
  for (const line of segment.slice(endGroup + 1)) {
    const m = line.match(/^AIS_CI_EVIDENCE (\{.*\})$/); if (!m) continue;
    let parsed; try { parsed = JSON.parse(m[1]); } catch { continue; }
    // A later valid JSON object must be checked, never skipped in favor of an older matching SHA.
    last = { parsed, canonical: JSON.stringify(parsed) === compactJSON(m[1]) };
  }
  requireValue(last && last.canonical, 'missing_or_noncanonical_ci_evidence');
  const proof = object(last.parsed), fields = ['repository', 'context', 'run_id', 'pr_number', 'head_sha', 'base_sha', 'checkout_sha'];
  requireValue(Object.keys(proof).length === fields.length && fields.every(k => Object.hasOwn(proof, k)), 'invalid_ci_evidence_fields');
  requireValue(proof.repository === REPOSITORY && proof.context === e.context && proof.run_id === String(run.id) && proof.pr_number === e.pr_number && proof.head_sha === e.head_sha && proof.base_sha === e.base_sha && proof.checkout_sha === e.checkout_sha, 'stale_or_wrong_ci_evidence');
  return proof;
}

/** All pages, including COMMENTED/PENDING/DISMISSED. No decision filtering or inferred authorization. */
export async function readAllReviews(api, prNumber) {
  requireValue(positive(prNumber), 'invalid_pr_number');
  const reviews = [];
  for (let page = 1; page <= 50; page++) {
    const result = await api.request('GET', `/pulls/${prNumber}/reviews?per_page=100&page=${page}`);
    requireValue(Array.isArray(result) && result.length <= 100, 'invalid_review_page');
    reviews.push(...result);
    if (result.length < 100) return reviews;
  }
  throw new Error('review_pagination_limit');
}

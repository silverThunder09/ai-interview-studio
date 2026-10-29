/** Advance a single approved task through the existing direct Cloud boundaries. */
import { readLimits } from './cloud-preflight.mjs';
import { dispatchApprovedCloud } from './direct-cloud.mjs';
import { createDirectHistoryVerifier } from './direct-history.mjs';
import { allPages } from './event-worker.ts';
import { parseLoopConfig, parseLoopState, REPO, runLoop, scope } from './loop-coordinator.mjs';

function ensure(value, code) { if (!value) throw new Error(code); }
const disabledSender = { request: async () => { throw new Error('cloud_comment_disabled'); } };
const rejectedCredentials = new WeakSet();
async function notStopped(api) {
  const labels = await allPages(api, '/issues/35/labels');
  ensure(labels.every(label => label && typeof label.name === 'string') && !labels.some(label => ['agent-paused', 'needs-user'].includes(label.name)), 'loop_control_paused');
}
async function writerReady(c, writer) {
  if (c.pr_auth !== 'github-app') return true;
  if (!writer?.credentials || typeof writer.credentials.client !== 'function') return false;
  const credentials = writer.credentials;
  if (rejectedCredentials.has(credentials)) return false;
  try { await credentials.client(); return true; }
  catch {
    // AppCredentials may retain a token before its validation fails. Never
    // reuse that object, even if revocation has an ambiguous response.
    rejectedCredentials.add(credentials);
    try { if (typeof credentials.dispose === 'function') await credentials.dispose(); }
    catch { throw new Error('writer_cleanup_unconfirmed'); }
    return false;
  }
}
function capacity(value) {
  if (!value || typeof value !== 'object' || value.rateLimitReachedTypeKnown !== true || !Object.hasOwn(value, 'rateLimitReachedType')) return 'unknown';
  if (value.rateLimitReachedType !== null) return 'limited';
  // Missing buckets or percentages are not evidence that capacity is available.
  const buckets = [value.primary, value.secondary];
  if (buckets.some(b => !b || !Number.isFinite(b.usedPercent) || b.usedPercent < 0 || b.usedPercent > 100)) return 'unknown';
  return buckets.some(b => b.usedPercent >= 100) ? 'limited' : 'available';
}

/**
 * One invocation only. The caller provides trusted-main config and policy plus
 * existing repo/App access; this function creates no timer or credentials.
 * Never replay a persisted attempt, infer a failure cause, or consume a result
 * unless the existing direct-result verifier authenticates its receipt.
 */
export function validateDirectContext(config, policy) {
  const c = parseLoopConfig(config);
  const required = ['checks', 'package', 'pr-policy'];
  ensure(c.enabled && c.cloud_transport === 'disabled' && policy?.repository === REPO && Number.isSafeInteger(policy.max_prs_per_run) && policy.max_prs_per_run > 0 && policy.max_prs_per_run <= 2 && Number.isSafeInteger(policy.max_fix_cycles) && policy.max_fix_cycles > 0 && policy.max_fix_cycles <= 3 && Array.isArray(policy.required_checks) && policy.required_checks.length === required.length && required.every(name => policy.required_checks.includes(name)) && Array.isArray(policy.protected_paths) && policy.protected_paths.every(path => typeof path === 'string') && c.tasks.every(t => t.allowed_paths.every(path => !policy.protected_paths.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix))), 'direct_tick_disabled');
  return c;
}

export async function runDirectTick({ api, store, config, policy, writer, environment, now = Date.now, cloud = {} }) {
  const c = validateDirectContext(config, policy);
  const snap = await store.load(); parseLoopState(snap.state, c);
  const index = snap.state.tasks.findIndex(t => t.phase !== 'completed');
  if (index < 0) return { state: 'idle' };
  if (snap.state.lease && snap.state.lease.until > now()) return { state: 'leased' };
  const task = snap.state.tasks[index];
  if (task.phase === 'paused') return { state: 'paused' };
  // Before a first submission, reconcile prior work and use only official
  // capacity values. The existing dispatcher repeats reconciliation while
  // holding its CAS lease and refuses any attempted delivery.
  if (task.phase === 'development' && task.delivery?.phase === 'sending' && task.delivery.attempted === false && task.direct_cloud === undefined) {
    // A completed predecessor represents a verified post-merge main. For the
    // first task, only a verified bootstrap for the exact base is sufficient.
    // A later unrelated main change needs separate authenticated main CI.
    const base = task.request?.base_sha, previous = snap.state.tasks[index - 1];
    if (previous ? previous.phase !== 'completed' || previous.merged !== base : snap.state.bootstrap?.ready !== true || snap.state.bootstrap.main !== base) return { state: 'main-ci-hold' };
    const verifyHistory = createDirectHistoryVerifier({ api, config: c, list: cloud.list });
    try { await verifyHistory({ task, state: snap.state }); }
    catch (error) { return { state: 'history-hold', reason: /^[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'history_unavailable' }; }
    let quota;
    try { quota = capacity(await (cloud.limits ?? readLimits)()); }
    catch { return { state: 'limits-hold', reason: 'unavailable' }; }
    if (quota !== 'available') return { state: 'limits-hold', reason: quota };
    await notStopped(api);
    const { pr, main } = await scope(api, task, c.tasks[index]);
    ensure(pr.state === 'open' && pr.merged === false && pr.head.sha === task.request.head_sha && pr.head.ref === task.branch && pr.base.sha === base && main === base && (await api.request('GET', `/git/ref/heads/${task.branch}`)).object.sha === task.request.head_sha, 'stale_cloud_request');
    // Do not start work that the approved GitHub App writer cannot later apply.
    if (!await writerReady(c, writer)) return { state: 'writer-hold', reason: 'unavailable' };
    return dispatchApprovedCloud({ api, store, config: c, taskId: task.id, environment, now, verifyHistory, ...(cloud.launch ? { launch: cloud.launch } : {}) });
  }
  if (task.direct_cloud?.phase === 'attempting') return { state: 'waiting-direct-cloud' };
  await notStopped(api);
  if (!await writerReady(c, writer)) return { state: 'writer-hold', reason: 'unavailable' };
  // The coordinator handles a saved attempt, result application, CI and human
  // review gates. The disabled sender prevents any legacy PR comment request.
  return runLoop({ api, store, config: c, policy, writer, sender: disabledSender, now,
    directCloud: { enabled: true, ...(cloud.list ? { list: cloud.list } : {}), ...(cloud.diff ? { diff: cloud.diff } : {}) } });
}

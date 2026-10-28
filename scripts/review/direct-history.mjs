/** Fail-closed reconciliation of prior Cloud tasks before a new direct send. */
import { allPages } from './event-worker.ts';
import { cloudTasks } from './direct-result.mjs';
import { parseLoopConfig, parseLoopState } from './loop-coordinator.mjs';

const TASK = /^task_[a-zA-Z0-9_-]{1,123}$/, KEY = /^[a-f0-9]{64}$/;
function ensure(value, code) { if (!value) throw new Error(code); }
function terminalSnapshot(tasks) {
  ensure(Array.isArray(tasks) && tasks.length <= 1000, 'invalid_cloud_history');
  const seen = new Set();
  return tasks.map(t => {
    ensure(t && typeof t.id === 'string' && t.id.length <= 128 && TASK.test(t.id) && !seen.has(t.id) && t.known_status === true && ['ready', 'error'].includes(t.status) && Number.isSafeInteger(t.attempt_total) && t.attempt_total > 0 && typeof t.updated_at === 'string' && Number.isFinite(Date.parse(t.updated_at)), 'unsettled_cloud_history');
    seen.add(t.id); return { id: t.id, status: t.status, attempt_total: t.attempt_total, updated_at: t.updated_at };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
async function ensureNotStopped(api) {
  const labels = await allPages(api, '/issues/35/labels');
  ensure(labels.every(x => x && typeof x.name === 'string') && !labels.some(x => ['agent-paused', 'needs-user'].includes(x.name)), 'loop_control_paused');
}

/** Install once only while the existing approved queue is entirely completed. */
export async function installDirectInventory({ api, store, config, list = cloudTasks }) {
  const c = parseLoopConfig(config), old = await store.load(); parseLoopState(old.state, c);
  if (old.state.direct_inventory !== undefined) return { state: 'already_present' };
  ensure(c.enabled && c.cloud_transport === 'disabled' && old.state.lease === null && old.state.bootstrap?.ready === true && old.state.tasks.length > 0 && old.state.tasks.every(t => t.phase === 'completed'), 'inventory_queue_not_idle');
  await ensureNotStopped(api);
  const first = terminalSnapshot(await list()), second = terminalSnapshot(await list());
  ensure(JSON.stringify(first) === JSON.stringify(second), 'cloud_history_changed');
  // A terminal status alone does not bind an old Cloud task to an approved
  // request or prove that its result was consumed. Until that evidence can be
  // authenticated, only an empty account history is safe to initialize.
  ensure(first.length === 0, 'cloud_history_unreconciled');
  await ensureNotStopped(api);
  const current = await store.load();
  ensure(current.head === old.head && JSON.stringify(current.state) === JSON.stringify(old.state), 'loop_cas_conflict');
  const next = JSON.parse(JSON.stringify(old.state));
  next.direct_inventory = { schema: 1, queue_ids: old.state.tasks.map(t => t.id), tasks: first };
  next.revision++;
  await store.save(old, next);
  return { state: 'installed', count: first.length };
}

/** The returned verifier can be passed to dispatchApprovedCloud. */
export function createDirectHistoryVerifier({ api, config, list = cloudTasks }) {
  const c = parseLoopConfig(config);
  return async ({ task, state }) => {
    parseLoopState(state, c);
    const inventory = state.direct_inventory;
    ensure(inventory && inventory.tasks.length === 0, 'cloud_history_unreconciled');
    const index = state.tasks.findIndex(t => t.id === task.id);
    ensure(inventory && index >= inventory.queue_ids.length && state.tasks[index].phase === 'development' && state.tasks[index].request?.request_key === task.request?.request_key && KEY.test(task.request?.request_key ?? '') && task.delivery?.attempted === false && task.direct_cloud === undefined, 'direct_history_unverified');
    const expected = new Map(inventory.tasks.map(t => [t.id, t]));
    // No authenticated completion checkpoint exists yet for subsequent direct
    // tasks, so never trust a caller-supplied observation as a completed task.
    ensure(index === inventory.queue_ids.length, 'direct_history_unverified');
    const actual = terminalSnapshot(await list());
    ensure(actual.length === expected.size && actual.every(t => { const saved = expected.get(t.id); return saved && ['id', 'status', 'attempt_total', 'updated_at'].every(k => saved[k] === t[k]); }), 'cloud_history_changed');
    const when = Date.parse(task.request.requested_at);
    ensure(Number.isFinite(when), 'invalid_request_time');
    const comments = await allPages(api, `/issues/${task.pr}/comments`);
    for (const comment of comments) {
      ensure(comment && typeof comment.body === 'string' && Number.isFinite(Date.parse(comment.created_at)), 'invalid_history_comment');
      ensure(!comment.body.includes(`ais-development-request-v2:${task.request.request_key}`) && !(Date.parse(comment.created_at) + 999 >= when && /(?:^|\s)@codex\b/i.test(comment.body)), 'ambiguous_prior_request');
    }
    return true;
  };
}

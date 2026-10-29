/** Fail-closed reconciliation of prior Cloud tasks before a new direct send. */
import { allPages } from './event-worker.ts';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { applyDevelopmentPatch, parseDevelopmentPatch } from './connected-controller.ts';
import { cloudDiff, cloudTasks } from './direct-result.mjs';
import { parseLoopConfig, parseLoopState } from './loop-coordinator.mjs';

const TASK = /^task_[a-zA-Z0-9_-]{1,123}$/, KEY = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
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
export function createDirectHistoryVerifier({ api, config, list = cloudTasks, diff = cloudDiff }) {
  const c = parseLoopConfig(config);
  return async ({ task, state }) => {
    parseLoopState(state, c);
    const inventory = state.direct_inventory;
    ensure(inventory && inventory.tasks.length === 0, 'cloud_history_unreconciled');
    const index = state.tasks.findIndex(t => t.id === task.id);
    ensure(inventory && index >= inventory.queue_ids.length && state.tasks[index].phase === 'development' && state.tasks[index].request?.request_key === task.request?.request_key && KEY.test(task.request?.request_key ?? '') && task.delivery?.attempted === false && task.direct_cloud === undefined, 'direct_history_unverified');
    const expected = new Map(inventory.tasks.map(t => [t.id, t]));
    const firstRaw = await list(), first = terminalSnapshot(firstRaw);
    for (let i = inventory.queue_ids.length; i < index; i++) {
      const prior = state.tasks[i], definition = c.tasks[i];
      ensure(prior.phase === 'completed' && SHA.test(prior.merged ?? '') && Array.isArray(prior.direct_history) && prior.direct_history.length > 0 && prior.direct_cloud === undefined, 'direct_history_unverified');
      const pr = await api.request('GET', `/pulls/${prior.pr}`);
      ensure(pr.merged === true && pr.merge_commit_sha === prior.merged && pr.base?.repo?.full_name === c.repository && pr.base.ref === 'main', 'direct_history_unverified');
      for (const entry of prior.direct_history) {
        const direct = entry.direct_cloud, observed = first.find(t => t.id === direct.task_id), identity = firstRaw.find(t => t.id === direct.task_id);
        ensure(!expected.has(direct.task_id) && observed?.status === 'ready' && observed.attempt_total === 1 && (identity.environment_id === null || identity.environment_id === direct.environment), 'direct_history_unverified');
        const original = await api.request('GET', `/git/commits/${entry.applied.parent}`);
        const applied = await api.request('GET', `/git/commits/${entry.applied.sha}`);
        ensure(original?.sha === entry.applied.parent && applied?.sha === entry.applied.sha && applied.parents?.length === 1 && applied.parents[0].sha === entry.applied.parent && SHA.test(original.tree?.sha ?? '') && SHA.test(applied.tree?.sha ?? ''), 'direct_history_unverified');
        const before = await api.request('GET', `/git/trees/${original.tree.sha}?recursive=1`);
        const after = await api.request('GET', `/git/trees/${applied.tree.sha}?recursive=1`);
        ensure(before?.truncated === false && after?.truncated === false && Array.isArray(before.tree) && Array.isArray(after.tree), 'direct_history_unverified');
        const patch = await diff(direct.task_id), paths = parseDevelopmentPatch(patch, definition.allowed_paths).map(f => f.path), originals = {};
        for (const path of paths) {
          const matches = before.tree.filter(x => x.path === path);
          ensure(matches.length === 1 && matches[0].type === 'blob' && matches[0].mode === '100644' && SHA.test(matches[0].sha ?? ''), 'direct_history_unverified');
          const blob = await api.request('GET', `/git/blobs/${matches[0].sha}`);
          ensure(blob?.encoding === 'base64' && Number.isSafeInteger(blob.size) && blob.size >= 0 && blob.size <= 1024 * 1024 && typeof blob.content === 'string', 'direct_history_unverified');
          const bytes = Buffer.from(blob.content, 'base64');
          ensure(bytes.length === blob.size && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === matches[0].sha, 'direct_history_unverified');
          const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
          ensure(Buffer.from(content, 'utf8').equals(bytes), 'direct_history_unverified'); originals[path] = content;
        }
        const files = applyDevelopmentPatch(patch, definition.allowed_paths, originals);
        const changed = new Map(files.map(f => [f.path, createHash('sha1').update(`blob ${Buffer.byteLength(f.content)}\0`).update(f.content).digest('hex')]));
        const leaves = tree => tree.filter(x => x.type !== 'tree').map(x => [x.path, x.mode, x.type, x.sha]).sort((a, b) => a[0].localeCompare(b[0]));
        const left = leaves(before.tree), right = leaves(after.tree);
        ensure(left.length === right.length && left.every((x, n) => x[0] === right[n][0] && x[1] === right[n][1] && x[2] === right[n][2] && right[n][3] === (changed.get(x[0]) ?? x[3])), 'direct_history_unverified');
        expected.set(direct.task_id, observed);
      }
    }
    const actual = terminalSnapshot(await list());
    ensure(JSON.stringify(first) === JSON.stringify(actual) && actual.length === expected.size && actual.every(t => { const saved = expected.get(t.id); return saved && ['id', 'status', 'attempt_total', 'updated_at'].every(k => saved[k] === t[k]); }), 'cloud_history_changed');
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

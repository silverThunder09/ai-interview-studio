/** Checkpoint one authenticated Cloud result for the existing Actions writer. */
/* global structuredClone */
import { randomBytes, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { inspectDirectResult } from './direct-result.mjs';
import { parseLoopState } from './loop-coordinator.mjs';

function ensure(value, code) { if (!value) throw new Error(code); }

export async function checkpointDirectResult({ api, store, config, taskId, list, diff, now = Date.now }) {
  let snap = await store.load(); parseLoopState(snap.state, config);
  const index = snap.state.tasks.findIndex(t => t.id === taskId);
  ensure(index >= 0 && index === snap.state.tasks.findIndex(t => t.phase !== 'completed'), 'not_current_approved_task');
  if (snap.state.lease && snap.state.lease.until > now()) return { state: 'leased' };
  const initial = snap.state.tasks[index];
  ensure(initial.phase === 'development' && initial.direct_cloud?.phase === 'sent', 'unverified_direct_receipt');
  if (initial.direct_result) return { state: 'checkpointed' };
  const owner = randomBytes(32).toString('hex');
  const save = async change => {
    const next = structuredClone(snap.state); change(next); next.revision++;
    snap = await store.save(snap, next);
  };
  await save(s => { s.lease = { owner, until: now() + 300000 }; });
  try {
    const candidate = await inspectDirectResult({ api, store, config, taskId, ...(list ? { list } : {}), ...(diff ? { diff } : {}) });
    if (candidate.state !== 'candidate') return candidate;
    ensure(typeof candidate.patch === 'string' && Buffer.byteLength(candidate.patch, 'utf8') <= 128 * 1024, 'invalid_direct_result');
    await save(s => {
      const t = s.tasks[index];
      ensure(s.lease?.owner === owner && s.lease.until > now() && t.phase === 'development' && t.direct_cloud?.phase === 'sent' && t.direct_cloud.task_id === candidate.task_id && !t.direct_result, 'direct_result_conflict');
      t.direct_result = { task_id: candidate.task_id, request_key: t.request.request_key, head_sha: candidate.head_sha, base_sha: candidate.base_sha, patch: candidate.patch, patch_hash: createHash('sha256').update(candidate.patch).digest('hex'), wake_attempted: false };
    });
    return { state: 'checkpointed' };
  } finally {
    try {
      const current = await store.load();
      if (current.state.lease?.owner === owner) {
        const next = structuredClone(current.state); next.lease = null; next.revision++;
        await store.save(current, next);
      }
    } catch { /* A later runner must wait for lease expiry and re-read the checkpoint. */ }
  }
}

/** Record the wake intent before dispatch. An unknown response is never retried. */
export async function wakeCheckpointedResult({ api, store, config, taskId, now = Date.now }) {
  const snap = await store.load(); parseLoopState(snap.state, config);
  const index = snap.state.tasks.findIndex(t => t.id === taskId);
  ensure(index >= 0 && index === snap.state.tasks.findIndex(t => t.phase !== 'completed'), 'not_current_approved_task');
  if (snap.state.lease && snap.state.lease.until > now()) return { state: 'leased' };
  const task = snap.state.tasks[index];
  ensure(task.phase === 'development' && task.direct_result, 'missing_direct_result');
  if (task.direct_result.wake_attempted) return { state: 'wakeup-pending' };
  const next = structuredClone(snap.state); next.tasks[index].direct_result.wake_attempted = true; next.revision++;
  await store.save(snap, next);
  try {
    await api.request('POST', '/actions/workflows/approved-loop.yml/dispatches', { ref: 'main' });
    return { state: 'wakeup-sent' };
  } catch { return { state: 'wakeup-unknown' }; }
}

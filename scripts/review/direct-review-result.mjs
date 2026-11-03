/** Read-only inspection of a recorded direct Cloud review; never posts or merges. */
import { parseLoopConfig, parseLoopState, scope } from './loop-coordinator.mjs';
import { cloudDiff, cloudTasks } from './direct-result.mjs';
import { buildDirectReviewRequest, parseDirectReviewDiff } from './direct-review-protocol.mjs';

function ensure(value, code) { if (!value) throw new Error(code); }

export async function inspectDirectReview({ api, store, config, taskId, list = cloudTasks, diff = cloudDiff }) {
  const c = parseLoopConfig(config), snap = await store.load();
  parseLoopState(snap.state, c);
  const index = snap.state.tasks.findIndex(t => t.id === taskId);
  ensure(c.enabled && c.cloud_transport === 'disabled' && index >= 0 && index === snap.state.tasks.findIndex(t => t.phase !== 'completed'), 'not_current_approved_task');
  const task = snap.state.tasks[index], definition = c.tasks[index], direct = task.direct_cloud;
  ensure(task.phase === 'review' && direct?.phase === 'sent' && task.delivery?.phase === 'sending' && task.delivery.attempted === true && task.delivery.id === null && task.delivery.body === buildDirectReviewRequest(task.request, definition.allowed_paths), 'unverified_review_receipt');
  const check = async () => {
    const { pr, main } = await scope(api, task, definition);
    ensure(pr.state === 'open' && pr.merged === false && pr.head.sha === task.request.head_sha && pr.head.ref === task.branch && pr.base.sha === task.request.base_sha && main === task.request.base_sha, 'stale_cloud_review');
    ensure((await api.request('GET', `/git/ref/heads/${task.branch}`)).object.sha === task.request.head_sha, 'stale_cloud_review');
  };
  await check();
  const tasks = await list(); ensure(Array.isArray(tasks), 'invalid_cloud_list');
  const found = tasks.filter(t => t.id === direct.task_id);
  ensure(found.length === 1 && found[0].known_status === true && (found[0].environment_id === null || found[0].environment_id === direct.environment) && found[0].attempt_total === 1, 'uncorrelated_cloud_review');
  if (['pending', 'running', 'queued'].includes(found[0].status)) return { state: 'waiting' };
  if (found[0].status !== 'ready') return { state: 'hold_unknown_failure' };
  const patch = await diff(direct.task_id);
  ensure(typeof patch === 'string', 'invalid_cloud_diff');
  if (!patch) return { state: 'hold_empty_diff' };
  const report = parseDirectReviewDiff(patch, task.request, definition.allowed_paths);
  await check();
  const current = await store.load();
  ensure(current.head === snap.head, 'cloud_review_state_changed');
  if (report.outcome === 'blocked') return { state: 'hold_review_blocked' };
  return { state: 'candidate', task_id: direct.task_id, request_key: task.request.request_key, head_sha: task.request.head_sha, base_sha: task.request.base_sha, report };
}

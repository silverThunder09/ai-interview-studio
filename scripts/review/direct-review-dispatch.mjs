/** One-shot review submission. The caller must supply trusted history and CI verifiers. */
import { randomBytes } from 'node:crypto';
import { launchCloud } from './direct-cloud.mjs';
import { buildDirectReviewRequest } from './direct-review-protocol.mjs';
import { parseLoopConfig, parseLoopState, REPO, scope } from './loop-coordinator.mjs';

const ENV = /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/, TASK = /^task_[a-zA-Z0-9_-]+$/, SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[a-zA-Z0-9._/-]{1,200}$/;
function ensure(value, code) { if (!value) throw new Error(code); }

export async function dispatchApprovedReview({ api, store, config, taskId, environment, verifyHistory, verifyCI, launch = launchCloud, now = Date.now }) {
  const c = parseLoopConfig(config);
  ensure(c.enabled && c.cloud_transport === 'disabled' && ENV.test(environment ?? '') && typeof verifyHistory === 'function' && typeof verifyCI === 'function', 'direct_review_disabled');
  let snap = await store.load(); parseLoopState(snap.state, c);
  const index = snap.state.tasks.findIndex(t => t.id === taskId);
  ensure(index >= 0 && index === snap.state.tasks.findIndex(t => t.phase !== 'completed'), 'not_current_approved_task');
  const task = snap.state.tasks[index], definition = c.tasks[index], contexts = ['checks', 'package', 'pr-policy'];
  ensure(task.phase === 'review' && task.pr !== null && task.request && task.delivery?.phase === 'sending' && task.delivery.attempted === false && task.delivery.id === null && !task.direct_cloud && BRANCH.test(task.branch ?? ''), 'not_ready_for_direct_review');
  ensure(task.delivery.body === buildDirectReviewRequest(task.request, definition.allowed_paths), 'untrusted_review_body');
  ensure(task.head === task.request.head_sha && task.base === task.request.base_sha && SHA.test(task.checkout ?? '') && Array.isArray(task.validated_ci) && task.validated_ci.length === contexts.length && contexts.every(context => task.validated_ci.filter(p => p.context === context && p.repository === REPO && p.pr_number === task.pr && p.head_sha === task.head && p.base_sha === task.base && p.checkout_sha === task.checkout && /^[1-9][0-9]*$/.test(p.run_id ?? '')).length === 1), 'unverified_review_ci');
  ensure(snap.state.bootstrap?.ready === true && (!snap.state.lease || snap.state.lease.until <= now()), 'loop_busy_or_unverified');
  const check = async () => {
    ensure(await verifyCI({ task, definition }) === true, 'review_ci_changed');
    const { pr, main } = await scope(api, task, definition);
    ensure(pr.state === 'open' && pr.merged === false && pr.draft === false && pr.head.sha === task.head && pr.head.ref === task.branch && pr.base.sha === task.base && main === task.base && pr.head.repo.full_name === REPO && pr.merge_commit_sha === task.checkout, 'stale_review_request');
    ensure((await api.request('GET', `/git/ref/heads/${task.branch}`)).object.sha === task.head, 'stale_review_request');
  };
  ensure(await verifyHistory({ task, state: snap.state }) === true, 'cloud_history_unreconciled');
  await check();
  const owner = randomBytes(32).toString('hex');
  const save = async change => { const next = JSON.parse(JSON.stringify(snap.state)); change(next); next.revision++; snap = await store.save(snap, next); };
  await save(s => { s.lease = { owner, until: now() + 300000 }; });
  try {
    await check();
    ensure(await verifyHistory({ task, state: snap.state }) === true, 'cloud_history_unreconciled');
    await save(s => {
      const t = s.tasks[index];
      ensure(s.lease?.owner === owner && s.lease.until > now() && !t.direct_cloud && t.delivery.attempted === false, 'direct_review_conflict');
      t.delivery.attempted = true;
      t.direct_cloud = { request_key: t.request.request_key, environment, branch: t.branch, phase: 'attempting', task_id: null };
    });
    try {
      await check();
      ensure(await verifyHistory({ task, state: snap.state }) === true, 'cloud_history_unreconciled');
      const current = await store.load();
      ensure(current.head === snap.head && current.state.lease?.owner === owner && current.state.lease.until > now(), 'direct_review_conflict');
    } catch { return { state: 'preflight_changed' }; }
    let receipt;
    try { receipt = await launch({ environment, branch: task.branch, body: task.delivery.body }); }
    catch { return { state: 'ambiguous_delivery' }; }
    if (!TASK.test(receipt?.id ?? '')) return { state: 'ambiguous_delivery' };
    try {
      await save(s => {
        const direct = s.tasks[index].direct_cloud;
        ensure(s.lease?.owner === owner && direct?.phase === 'attempting' && direct.request_key === task.request.request_key, 'direct_review_conflict');
        direct.phase = 'sent'; direct.task_id = receipt.id;
      });
    } catch { return { state: 'receipt_persistence_unknown' }; }
    return { state: 'sent', task_id: receipt.id };
  } finally {
    try {
      const current = await store.load();
      if (current.state.lease?.owner === owner) { const next = JSON.parse(JSON.stringify(current.state)); next.lease = null; next.revision++; await store.save(current, next); }
    } catch { /* A persisted attempt is never safe to replay. */ }
  }
}

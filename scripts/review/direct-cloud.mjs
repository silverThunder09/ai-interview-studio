/** Durable, one-shot direct Cloud delivery for an existing approved queue entry. */
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { approvedDevelopmentBody, parseLoopConfig, parseLoopState, REPO, scope } from './loop-coordinator.mjs';
import { createDirectHistoryVerifier } from './direct-history.mjs';

const exec = promisify(execFile);
const TASK = /^task_[a-zA-Z0-9_-]+$/;
const ENV = /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[a-zA-Z0-9._/-]{1,200}$/;
const KEY = /^[a-f0-9]{64}$/;
function ensure(value, message) { if (!value) throw new Error(message); }

/** No shell, no hidden retries; nonzero, timeout, or unparseable output is ambiguous. */
export async function launchCloud({ environment, branch, body }) {
  ensure(ENV.test(environment ?? '') && BRANCH.test(branch ?? '') && typeof body === 'string' && body.length > 0 && body.length <= 20000, 'invalid_cloud_request');
  const { stdout } = await exec('codex', ['cloud', 'exec', '--env', environment, '--branch', branch, '--attempts', '1', body], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
  const urls = [...stdout.matchAll(/^\s*https:\/\/chatgpt\.com\/codex\/tasks\/(task_[a-zA-Z0-9_-]+)\s*$/gm)];
  ensure(urls.length === 1 && TASK.test(urls[0][1]), 'ambiguous_cloud_receipt');
  return { id: urls[0][1] };
}

/**
 * The caller must first reconcile historical Cloud tasks and supply a verifier.
 * A persisted attempt is never automatically sent again, even on lost responses.
 * This function does not interpret an ERROR as a transient failure or retry it.
 */
export async function dispatchApprovedCloud({ api, store, config, taskId, environment, expectedRequestKey, verifyHistory, launch = launchCloud, now = Date.now }) {
  const c = parseLoopConfig(config);
  const history = verifyHistory ?? createDirectHistoryVerifier({ api, config: c });
  ensure(c.enabled && c.cloud_transport === 'disabled' && ENV.test(environment ?? '') && typeof history === 'function', 'direct_cloud_disabled');
  let snap = await store.load(); parseLoopState(snap.state, c);
  const index = snap.state.tasks.findIndex(t => t.id === taskId);
  ensure(index >= 0 && index === snap.state.tasks.findIndex(t => t.phase !== 'completed'), 'not_current_approved_task');
  const task = snap.state.tasks[index], definition = c.tasks[index];
  ensure(expectedRequestKey === undefined || KEY.test(expectedRequestKey) && task.request?.request_key === expectedRequestKey, 'resumption_request_changed');
  ensure(task.phase === 'development' && task.pr !== null && task.request && KEY.test(task.request.request_key ?? '') && task.delivery?.phase === 'sending' && task.delivery.attempted === false && task.delivery.id === null && !task.direct_cloud && BRANCH.test(task.branch ?? ''), 'not_ready_for_direct_cloud');
  ensure(task.delivery.body === approvedDevelopmentBody(task.request, definition, task), 'untrusted_cloud_body');
  ensure(snap.state.bootstrap?.ready === true && (!snap.state.lease || snap.state.lease.until <= now()), 'loop_busy_or_unverified');
  // Reconciliation must use authoritative, complete evidence; a list alone is insufficient.
  ensure(await history({ task, state: snap.state }) === true, 'cloud_history_unreconciled');
  const check = async () => {
    const { pr, main } = await scope(api, task, definition);
    ensure(pr.state === 'open' && pr.merged === false && pr.head.sha === task.request.head_sha && pr.head.ref === task.branch && pr.base.sha === task.request.base_sha && main === task.request.base_sha && pr.head.repo.full_name === REPO, 'stale_cloud_request');
    const branch = await api.request('GET', `/git/ref/heads/${task.branch}`);
    ensure(branch.object.sha === task.request.head_sha, 'stale_cloud_request');
  };
  await check();
  const owner = randomBytes(32).toString('hex');
  const save = async change => {
    const next = JSON.parse(JSON.stringify(snap.state)); change(next); next.revision++;
    snap = await store.save(snap, next);
  };
  await save(s => { s.lease = { owner, until: now() + 300000 }; });
  try {
    await check();
    ensure(await history({ task, state: snap.state }) === true, 'cloud_history_unreconciled');
    await save(s => {
      const t = s.tasks[index];
      ensure(s.lease?.owner === owner && s.lease.until > now() && !t.direct_cloud && t.delivery.attempted === false, 'direct_cloud_conflict');
      t.delivery.attempted = true;
      t.direct_cloud = { request_key: t.request.request_key, environment, branch: t.branch, phase: 'attempting', task_id: null };
    });
    try {
      await check();
      ensure(await history({ task, state: snap.state }) === true, 'cloud_history_unreconciled');
      const current = await store.load();
      ensure(current.head === snap.head && current.state.lease?.owner === owner && current.state.lease.until > now(), 'direct_cloud_conflict');
    } catch { return { state: 'preflight_changed' }; }
    let receipt;
    try { receipt = await launch({ environment, branch: task.branch, body: task.delivery.body }); }
    catch { return { state: 'ambiguous_delivery' }; }
    if (!TASK.test(receipt?.id ?? '')) return { state: 'ambiguous_delivery' };
    try {
      await save(s => {
        const direct = s.tasks[index].direct_cloud;
        ensure(s.lease?.owner === owner && direct?.phase === 'attempting' && direct.request_key === task.request.request_key, 'direct_cloud_conflict');
        direct.phase = 'sent'; direct.task_id = receipt.id;
      });
    } catch { return { state: 'receipt_persistence_unknown' }; }
    return { state: 'sent', task_id: receipt.id };
  } finally {
    try {
      const current = await store.load();
      if (current.state.lease?.owner === owner) {
        const next = JSON.parse(JSON.stringify(current.state)); next.lease = null; next.revision++;
        await store.save(current, next);
      }
    } catch { /* An expired lease cannot authorize replay of the persisted attempt. */ }
  }
}

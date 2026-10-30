/** Read-only inspection of a result from a persisted direct Cloud submission. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { TextDecoder } from 'node:util';
import { applyDevelopmentPatch, parseDevelopmentPatch } from './connected-controller.ts';
import { readTaskPages } from './cloud-preflight.mjs';
import { approvedDevelopmentBody, parseLoopConfig, parseLoopState, scope } from './loop-coordinator.mjs';

const exec = promisify(execFile), SHA = /^[a-f0-9]{40}$/;
function ensure(value, code) { if (!value) throw new Error(code); }
export async function cloudTasks() {
  return readTaskPages(async args => (await exec('codex', args, { timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout);
}
export async function cloudDiff(id) {
  ensure(/^task_[a-zA-Z0-9_-]+$/.test(id ?? ''), 'invalid_cloud_task');
  try {
    return (await exec('codex', ['cloud', 'diff', '--attempt', '1', id], { timeout: 30000, maxBuffer: 128 * 1024, windowsHide: true })).stdout;
  } catch (error) {
    // This exact CLI message is not proof of completion. The caller first
    // verifies READY and then treats an empty diff as a hold, never success.
    const message = `Error: No diff available for task ${id}; it may still be running.`;
    if (error?.code === 1 && error.killed !== true && typeof error.stderr === 'string' && error.stderr.split(/\r?\n/).includes(message)) return '';
    // CLI stderr may include remote text; do not attach it to a logged error.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('cloud_diff_unavailable');
  }
}

/**
 * Returns a candidate only; no GitHub state, worktree or Cloud state is changed.
 * A candidate is not evidence of tests, review, approval, or permission to merge.
 */
export async function inspectDirectResult({ api, store, config, taskId, list = cloudTasks, diff = cloudDiff }) {
  const c = parseLoopConfig(config), snap = await store.load(); parseLoopState(snap.state, c);
  const index = snap.state.tasks.findIndex(t => t.id === taskId);
  ensure(c.enabled && index >= 0 && index === snap.state.tasks.findIndex(t => t.phase !== 'completed'), 'not_current_approved_task');
  const task = snap.state.tasks[index], definition = c.tasks[index], direct = task.direct_cloud;
  ensure(task.phase === 'development' && direct?.phase === 'sent' && direct.task_id && task.delivery?.phase === 'sending' && task.delivery.attempted === true && task.delivery.body === approvedDevelopmentBody(task.request, definition, task), 'unverified_direct_receipt');
  const check = async () => {
    const { pr, main } = await scope(api, task, definition);
    ensure(pr.state === 'open' && pr.merged === false && pr.head.sha === task.request.head_sha && pr.head.ref === task.branch && pr.base.sha === task.request.base_sha && main === task.request.base_sha, 'stale_cloud_result');
    const branch = await api.request('GET', `/git/ref/heads/${task.branch}`);
    ensure(branch.object.sha === task.request.head_sha, 'stale_cloud_result');
  };
  await check();
  const tasks = await list(); ensure(Array.isArray(tasks), 'invalid_cloud_list');
  const found = tasks.filter(t => t.id === direct.task_id);
  // The authenticated creation receipt already binds this exact task ID to
  // the requested environment. Legacy Cloud can omit its environment ID in
  // list results; a conflicting ID is still rejected, and a missing field is
  // not accepted. Never use the CLI's environment filter as identity evidence.
  ensure(found.length === 1 && found[0].known_status === true && (found[0].environment_id === null || found[0].environment_id === direct.environment) && found[0].attempt_total === 1, 'uncorrelated_cloud_task');
  const status = found[0].status;
  if (['pending', 'running', 'queued'].includes(status)) return { state: 'waiting' };
  if (status !== 'ready') return { state: 'hold_unknown_failure' };
  const patch = await diff(direct.task_id);
  ensure(typeof patch === 'string', 'invalid_cloud_diff');
  if (!patch) return { state: 'hold_empty_diff' };
  const paths = parseDevelopmentPatch(patch, definition.allowed_paths).map(f => f.path);
  const commit = await api.request('GET', `/git/commits/${task.request.head_sha}`);
  ensure(SHA.test(commit?.tree?.sha ?? ''), 'invalid_original_tree');
  const tree = await api.request('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
  ensure(tree?.truncated === false && Array.isArray(tree.tree), 'incomplete_original_tree');
  const originals = {};
  for (const path of paths) {
    const matches = tree.tree.filter(entry => entry.path === path);
    ensure(matches.length === 1 && matches[0].type === 'blob' && matches[0].mode === '100644' && SHA.test(matches[0].sha ?? ''), 'invalid_original_blob');
    const blob = await api.request('GET', `/git/blobs/${matches[0].sha}`);
    ensure(blob?.encoding === 'base64' && Number.isSafeInteger(blob.size) && blob.size >= 0 && blob.size <= 1024 * 1024 && typeof blob.content === 'string', 'invalid_original_blob');
    const bytes = Buffer.from(blob.content, 'base64');
    ensure(bytes.length === blob.size && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === matches[0].sha, 'invalid_original_blob');
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      ensure(Buffer.from(text, 'utf8').equals(bytes), 'invalid_original_encoding');
      originals[path] = text;
    } catch { throw new Error('invalid_original_encoding'); }
  }
  const files = applyDevelopmentPatch(patch, definition.allowed_paths, originals);
  await check();
  const current = await store.load();
  ensure(current.head === snap.head, 'cloud_result_state_changed');
  return { state: 'candidate', task_id: direct.task_id, head_sha: task.request.head_sha, base_sha: task.request.base_sha, files, patch };
}

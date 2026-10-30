import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { inspectDirectResult } from '../../scripts/review/direct-result.mjs';
import { checkpointDirectResult, wakeCheckpointedResult } from '../../scripts/review/direct-handoff.mjs';
import { runDirectTick } from '../../scripts/review/direct-tick.mjs';
import { approvedDevelopmentBody, emptyLoopState, parseLoopState, preserveDirectCloud, type LoopState } from '../../scripts/review/loop-coordinator.mjs';

const repo = 'silverThunder09/ai-interview-studio';
const sha = (n: string) => n.repeat(40), key = 'a'.repeat(64);
const config = { schema: 1, repository: repo, enabled: true, cloud_transport: 'disabled', tasks: [{ id: 'work-a', pr: 80, goal: '승인된 합성 작업', approval: '사용자 승인', allowed_paths: ['src/a.ts'] }] };
const patch = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-before\n+after\n';
const blobContent = 'before\n', blobSha = createHash('sha1').update(`blob ${Buffer.byteLength(blobContent)}\0${blobContent}`).digest('hex');

function fixture() {
  const state = emptyLoopState(config); state.bootstrap = { main: sha('1'), key: 'b'.repeat(64), ready: true };
  const request = { schema: 2, repository: repo, pr_number: 80, request_key: key, head_sha: sha('2'), base_sha: sha('1'), requested_at: '2026-10-28T00:00:00.000Z', mode: 'repair', allowed_paths: ['src/a.ts'] };
  const body = approvedDevelopmentBody(request, config.tasks[0], {});
  Object.assign(state.tasks[0]!, { phase: 'development', branch: 'work/a', request,
    delivery: { phase: 'sending', hash: createHash('sha256').update(body).digest('hex'), body, id: null, attempted: true },
    direct_cloud: { request_key: key, environment: 'env_1', branch: 'work/a', phase: 'sent', task_id: 'task_one' } });
  const store = { state, head: 'original', async load() { return { head: this.head, state: structuredClone(this.state) }; },
    async save(old: { head: string }, next: LoopState) {
      if (old.head !== this.head) throw new Error('loop_cas_conflict');
      parseLoopState(next, config); preserveDirectCloud(this.state.tasks[0]!, next.tasks[0]!);
      this.state = structuredClone(next); this.head += 'x'; return this.load();
    } };
  const calls: string[] = [];
  const api = { async request(method: string, path: string): Promise<unknown> {
    calls.push(method + ' ' + path);
    if (path.startsWith('/issues/')) return [];
    if (path.startsWith('/pulls/80/files')) return [{ filename: 'src/a.ts', status: 'modified' }];
    if (path === '/pulls/80') return { state: 'open', merged: false, user: { login: 'silverThunder09' }, head: { sha: sha('2'), ref: 'work/a', repo: { full_name: repo, fork: false } }, base: { sha: sha('1'), ref: 'main', repo: { full_name: repo } } };
    if (path === '/branches/main') return { commit: { sha: sha('1') } };
    if (path === '/git/ref/heads/work/a') return { object: { sha: sha('2') } };
    if (path === `/git/commits/${sha('2')}`) return { tree: { sha: sha('3') } };
    if (path.startsWith('/git/trees/')) return { truncated: false, tree: [{ path: 'src/a.ts', type: 'blob', mode: '100644', sha: blobSha }] };
    if (path === `/git/blobs/${blobSha}`) return { encoding: 'base64', size: Buffer.byteLength(blobContent), content: Buffer.from(blobContent).toString('base64') };
    throw new Error('unexpected_request');
  } };
  const list = vi.fn(async (): Promise<{ id: string; status: string; known_status: boolean; environment_id: string | null; attempt_total: number }[]> => [{ id: 'task_one', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 1 }]);
  const diff = vi.fn(async () => patch);
  return { store, api, calls, list, diff, options: { api, store, config, taskId: 'work-a', list, diff } };
}

describe('direct Cloud result inspection', () => {
  it('returns only a validated candidate from the recorded task without mutating anything', async () => {
    const f = fixture(); const before = structuredClone(f.store.state);
    const result = await inspectDirectResult(f.options);
    expect(result).toMatchObject({ state: 'candidate', task_id: 'task_one', files: [{ path: 'src/a.ts', content: 'after\n' }] });
    expect(f.diff).toHaveBeenCalledWith('task_one'); expect(f.store.state).toEqual(before);
    expect(f.calls.every(call => call.startsWith('GET '))).toBe(true);
  });
  it('uses the exact stored creation receipt when the server explicitly returns a null environment ID', async () => {
    const f = fixture();
    f.list.mockResolvedValue([{ id: 'task_one', status: 'ready', known_status: true, environment_id: null, attempt_total: 1 }]);
    expect(await inspectDirectResult(f.options)).toMatchObject({ state: 'candidate', task_id: 'task_one' });
  });
  it('waits for a running task and holds an error without assuming it is transient', async () => {
    const f = fixture(); f.list.mockResolvedValueOnce([{ id: 'task_one', status: 'running', known_status: true, environment_id: 'env_1', attempt_total: 1 }]);
    await expect(inspectDirectResult(f.options)).resolves.toEqual({ state: 'waiting' });
    f.list.mockResolvedValueOnce([{ id: 'task_one', status: 'error', known_status: true, environment_id: 'env_1', attempt_total: 1 }]);
    await expect(inspectDirectResult(f.options)).resolves.toEqual({ state: 'hold_unknown_failure' });
    expect(f.diff).not.toHaveBeenCalled();
  });
  it('rejects wrong environment, multiple attempts, duplicate IDs and unknown statuses', async () => {
    for (const tasks of [
      [{ id: 'task_one', status: 'ready', known_status: true, environment_id: 'other', attempt_total: 1 }],
      [{ id: 'task_one', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 2 }],
      [{ id: 'task_one', status: 'ready', known_status: false, environment_id: 'env_1', attempt_total: 1 }],
      Array(2).fill({ id: 'task_one', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 1 }),
    ]) { const f = fixture(); f.list.mockResolvedValue(tasks); await expect(inspectDirectResult(f.options)).rejects.toThrow('uncorrelated_cloud_task'); expect(f.diff).not.toHaveBeenCalled(); }
  });
  it('rejects a missing environment field or a different task even when environment metadata is null', async () => {
    const f = fixture();
    await expect(inspectDirectResult({ ...f.options, list: async () => [{ id: 'task_one', status: 'ready', known_status: true, attempt_total: 1 }] })).rejects.toThrow('uncorrelated_cloud_task');
    const other = fixture();
    other.list.mockResolvedValue([{ id: 'task_other', status: 'ready', known_status: true, environment_id: null, attempt_total: 1 }]);
    await expect(inspectDirectResult(other.options)).rejects.toThrow('uncorrelated_cloud_task');
    expect(f.diff).not.toHaveBeenCalled(); expect(other.diff).not.toHaveBeenCalled();
  });
  it('rejects patches outside the approval and changes to the state during inspection', async () => {
    const f = fixture(); f.diff.mockResolvedValue(patch.replaceAll('src/a.ts', 'src/private.ts'));
    await expect(inspectDirectResult(f.options)).rejects.toThrow('patch_path_not_allowed');
    const changed = fixture(); changed.diff.mockImplementation(async () => { changed.store.head = 'moved'; return patch; });
    await expect(inspectDirectResult(changed.options)).rejects.toThrow('cloud_result_state_changed');
  });
  it('holds an empty diff and rejects a bad original blob', async () => {
    const f = fixture(); f.diff.mockResolvedValue('');
    await expect(inspectDirectResult(f.options)).resolves.toEqual({ state: 'hold_empty_diff' });
    const invalid = fixture(), request = invalid.api.request;
    invalid.api.request = async (method, path) => path.startsWith('/git/blobs/') ? { encoding: 'base64', size: 7, content: Buffer.from('wrong!!').toString('base64') } : request(method, path);
    await expect(inspectDirectResult(invalid.options)).rejects.toThrow('invalid_original_blob');
  });
  it('preserves a UTF-8 BOM in unchanged original text', async () => {
    const f = fixture(), request = f.api.request, original = '\ufeffkeep\nbefore\n';
    const hash = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0${original}`).digest('hex');
    f.api.request = async (method, path) => {
      if (path.startsWith('/git/trees/')) return { truncated: false, tree: [{ path: 'src/a.ts', type: 'blob', mode: '100644', sha: hash }] };
      if (path === `/git/blobs/${hash}`) return { encoding: 'base64', size: Buffer.byteLength(original), content: Buffer.from(original).toString('base64') };
      return request(method, path);
    };
    f.diff.mockResolvedValue(patch.replace('@@ -1 +1 @@', '@@ -2 +2 @@'));
    expect(await inspectDirectResult(f.options)).toMatchObject({ state: 'candidate', files: [{ path: 'src/a.ts', content: '\ufeffkeep\nafter\n' }] });
  });
});

describe('Cloud result handoff', () => {
  it('resumes only the recorded task and delivers it through the Actions writer', async () => {
    const f = fixture(), request = f.api.request;
    const dispatch = vi.fn(async () => ({}));
    f.api.request = async (method, path) => method === 'POST' && path === '/actions/workflows/approved-loop.yml/dispatches' ? dispatch() : request(method, path);
    const policy = { repository: repo, max_prs_per_run: 2, max_fix_cycles: 3, protected_paths: [], required_checks: ['checks', 'package', 'pr-policy'] };
    const options = { api: f.api, store: f.store, config: { ...config, pr_auth: 'github-app' }, policy, environment: 'env_1', cloud: { list: f.list, diff: f.diff } };
    expect(await runDirectTick({ ...options, expectedCloudTaskId: 'task_other' })).toEqual({ state: 'resumption-hold' });
    expect(await runDirectTick({ ...options, expectedCloudTaskId: 'task_one' })).toEqual({ state: 'wakeup-sent' });
    expect(await runDirectTick({ ...options, expectedCloudTaskId: 'task_one' })).toEqual({ state: 'wakeup-pending' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('checkpoints a validated result and wakes Actions only once', async () => {
    const f = fixture();
    expect(await checkpointDirectResult(f.options)).toEqual({ state: 'checkpointed' });
    expect(f.store.state.tasks[0]!.direct_result).toMatchObject({ task_id: 'task_one', request_key: key, patch, wake_attempted: false });
    const dispatch = vi.fn(async () => ({}));
    const wake = { ...f.options, api: { request: dispatch } };
    expect(await wakeCheckpointedResult(wake)).toEqual({ state: 'wakeup-sent' });
    expect(await wakeCheckpointedResult(wake)).toEqual({ state: 'wakeup-pending' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('holds ambiguous delivery and never automatically dispatches it again', async () => {
    const f = fixture(); await checkpointDirectResult(f.options);
    const dispatch = vi.fn(async () => { throw new Error('lost_response'); });
    const wake = { ...f.options, api: { request: dispatch } };
    expect(await wakeCheckpointedResult(wake)).toEqual({ state: 'wakeup-unknown' });
    expect(await wakeCheckpointedResult(wake)).toEqual({ state: 'wakeup-pending' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('does not checkpoint an unknown failure or a changed state', async () => {
    const f = fixture(); f.list.mockResolvedValue([{ id: 'task_one', status: 'error', known_status: true, environment_id: 'env_1', attempt_total: 1 }]);
    expect(await checkpointDirectResult(f.options)).toEqual({ state: 'hold_unknown_failure' });
    expect(f.store.state.tasks[0]!.direct_result).toBeUndefined();
    const changed = fixture(); changed.diff.mockImplementation(async () => { changed.store.head = 'moved'; return patch; });
    await expect(checkpointDirectResult(changed.options)).rejects.toThrow('cloud_result_state_changed');
    expect(changed.store.state.tasks[0]!.direct_result).toBeUndefined();
  });
  it('refuses a modified checkpoint or rollback of a recorded wake', async () => {
    const f = fixture(); await checkpointDirectResult(f.options);
    const original = structuredClone(f.store.state.tasks[0]!);
    const modified = structuredClone(original); (modified.direct_result as { patch: string }).patch = 'changed';
    expect(() => preserveDirectCloud(original, modified)).toThrow('direct_result_history_changed');
    const awakened = structuredClone(original); (awakened.direct_result as { wake_attempted: boolean }).wake_attempted = true;
    expect(() => preserveDirectCloud(awakened, original)).toThrow('direct_result_history_changed');
  });
});

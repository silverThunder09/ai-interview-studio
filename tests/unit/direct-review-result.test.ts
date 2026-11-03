import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { emptyLoopState } from '../../scripts/review/loop-coordinator.mjs';
import { buildDirectReviewRequest, directReviewArtifactPath } from '../../scripts/review/direct-review-protocol.mjs';
import { inspectDirectReview } from '../../scripts/review/direct-review-result.mjs';
import { runDirectTick } from '../../scripts/review/direct-tick.mjs';
import { recordedCloudTask } from '../../scripts/review/direct-runner.mjs';

const repository = 'silverThunder09/ai-interview-studio', sha = (n: string) => n.repeat(40), key = 'a'.repeat(64);
const config = { schema: 1, repository, enabled: true, cloud_transport: 'disabled', tasks: [{ id: 'work-a', pr: 80, goal: '승인된 합성 작업', approval: '사용자 승인', allowed_paths: ['src/a.ts'] }] };
const request = { schema: 2, repository, pr_number: 80, request_key: key, head_sha: sha('2'), base_sha: sha('1'), requested_at: '2026-10-28T00:00:00.000Z', mode: 'read-only', allowed_paths: [] };
function report(outcome = 'complete') { return { schema: 1, repository, pr_number: 80, request_key: key, head_sha: sha('2'), base_sha: sha('1'), outcome, reason: outcome === 'blocked' ? 'base unavailable' : '', findings: [] }; }
function patch(value: unknown) {
  const raw = `${JSON.stringify(value)}\n`, hash = createHash('sha1').update(`blob ${Buffer.byteLength(raw)}\0${raw}`).digest('hex').slice(0, 7), path = directReviewArtifactPath(request);
  return `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..${hash}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${raw}`;
}
function fixture() {
  const state = emptyLoopState(config), body = buildDirectReviewRequest(request, config.tasks[0]!.allowed_paths);
  Object.assign(state.tasks[0]!, { phase: 'review', branch: 'work/a', request,
    delivery: { phase: 'sending', hash: createHash('sha256').update(body).digest('hex'), body, id: null, attempted: true },
    direct_cloud: { request_key: key, environment: 'env_1', branch: 'work/a', phase: 'sent', task_id: 'task_one' } });
  const store = { state, head: 'original', async load() { return { head: this.head, state: structuredClone(this.state) }; } };
  const calls: string[] = [];
  const api = { async request(method: string, path: string): Promise<unknown> {
    calls.push(method + ' ' + path);
    if (path.startsWith('/issues/')) return [];
    if (path.startsWith('/pulls/80/files')) return [{ filename: 'src/a.ts', status: 'modified' }];
    if (path === '/pulls/80') return { state: 'open', merged: false, user: { login: 'silverThunder09' }, head: { sha: sha('2'), ref: 'work/a', repo: { full_name: repository, fork: false } }, base: { sha: sha('1'), ref: 'main', repo: { full_name: repository } } };
    if (path === '/branches/main') return { commit: { sha: sha('1') } };
    if (path === '/git/ref/heads/work/a') return { object: { sha: sha('2') } };
    throw new Error('unexpected_request');
  } };
  const list = vi.fn(async (): Promise<{ id: string; status: string; known_status: boolean; environment_id: string | null; attempt_total: number }[]> => [{ id: 'task_one', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 1 }]);
  const diff = vi.fn(async () => patch(report()));
  return { store, api, calls, list, diff, options: { api, store, config, taskId: 'work-a', list, diff } };
}

describe('direct Cloud review inspection', () => {
  it('reads only the recorded task, and returns an unposted candidate without mutation', async () => {
    const f = fixture(), before = structuredClone(f.store.state);
    expect(await inspectDirectReview(f.options)).toMatchObject({ state: 'candidate', task_id: 'task_one', head_sha: sha('2'), report: { findings: [] } });
    expect(f.store.state).toEqual(before); expect(f.calls.every(c => c.startsWith('GET '))).toBe(true); expect(f.diff).toHaveBeenCalledWith('task_one');
  });
  it('waits for running, and holds failure, empty diff and blocked report', async () => {
    const f = fixture();
    f.list.mockResolvedValueOnce([{ id: 'task_one', status: 'running', known_status: true, environment_id: 'env_1', attempt_total: 1 }]);
    expect(await inspectDirectReview(f.options)).toEqual({ state: 'waiting' });
    f.list.mockResolvedValueOnce([{ id: 'task_one', status: 'error', known_status: true, environment_id: 'env_1', attempt_total: 1 }]);
    expect(await inspectDirectReview(f.options)).toEqual({ state: 'hold_unknown_failure' });
    f.diff.mockResolvedValueOnce(''); expect(await inspectDirectReview(f.options)).toEqual({ state: 'hold_empty_diff' });
    f.diff.mockResolvedValueOnce(patch(report('blocked'))); expect(await inspectDirectReview(f.options)).toEqual({ state: 'hold_review_blocked' });
  });
  it('rejects wrong identity, unknown status, multiple attempts, or missing environment', async () => {
    const f = fixture();
    for (const entry of [
      { id: 'task_other', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 1 },
      { id: 'task_one', status: 'ready', known_status: false, environment_id: 'env_1', attempt_total: 1 },
      { id: 'task_one', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 2 },
      { id: 'task_one', status: 'ready', known_status: true, environment_id: 'other', attempt_total: 1 },
    ]) { f.list.mockResolvedValueOnce([entry]); await expect(inspectDirectReview(f.options)).rejects.toThrow('uncorrelated_cloud_review'); }
    await expect(inspectDirectReview({ ...f.options, list: async () => [{ id: 'task_one', status: 'ready', known_status: true, attempt_total: 1 }] })).rejects.toThrow('uncorrelated_cloud_review');
    expect(f.diff).not.toHaveBeenCalled();
  });
  it('rejects a stale result, altered request body, or concurrent ledger change', async () => {
    const f = fixture(); f.diff.mockResolvedValueOnce(patch({ ...report(), head_sha: sha('3') }));
    await expect(inspectDirectReview(f.options)).rejects.toThrow('invalid_review_report');
    const changed = fixture(); changed.diff.mockImplementation(async () => { changed.store.head = 'moved'; return patch(report()); });
    await expect(inspectDirectReview(changed.options)).rejects.toThrow('cloud_review_state_changed');
    const altered = fixture(); (altered.store.state.tasks[0]!.delivery as { body: string }).body = 'untrusted';
    await expect(inspectDirectReview(altered.options)).rejects.toThrow(); expect(altered.diff).not.toHaveBeenCalled();
  });
  it('resumes only the recorded review and reports a candidate without posting or merging', async () => {
    const f = fixture();
    const policy = { repository, max_prs_per_run: 2, max_fix_cycles: 3, protected_paths: [], required_checks: ['checks', 'package', 'pr-policy'] };
    expect(recordedCloudTask({ tasks: [f.store.state.tasks[0] as unknown as { phase: string; direct_cloud: { phase: string; task_id: string } }] })).toEqual({ state: 'sent', task_id: 'task_one' });
    const options = { api: f.api, store: f.store, config, policy, environment: 'env_1', cloud: { list: f.list, diff: f.diff } };
    expect(await runDirectTick({ ...options, expectedCloudTaskId: 'task_other' })).toEqual({ state: 'resumption-hold' });
    expect(await runDirectTick({ ...options, expectedCloudTaskId: 'task_one' })).toEqual({ state: 'direct-review-candidate' });
    expect(f.calls.every(c => c.startsWith('GET '))).toBe(true);
  });
});

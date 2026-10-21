import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPendingWakeup, parseWaitRequest, waitForCI } from '../../scripts/review/loop-waiter.mjs';

const repository = 'silverThunder09/ai-interview-studio', head = 'a'.repeat(40), base = 'b'.repeat(40), checkout = 'c'.repeat(40), key = 'd'.repeat(64);
const input = { pr: '58', head, base, checkout, key };
const pending = () => ({ repository, tasks: [{ pr: 58, phase: 'ci', head, base, checkout, operation: { key } }] });
const ci = () => ({ id: 10, run_attempt: 1, repository: { full_name: repository }, event: 'workflow_dispatch', path: '.github/workflows/loop-validation.yml', display_title: `Approved loop ${key}`, head_sha: head, status: 'in_progress', conclusion: null as string | null });
const continuation = () => ({ ...ci(), id: 20, path: '.github/workflows/approved-loop.yml', display_title: `Approved continuation ${key}` });
function fixture() {
  const f = { now: 0, polls: 0, state: pending() as unknown, list: [ci()], previous: [] as ReturnType<typeof continuation>[], posts: [] as { path: string; body: unknown }[], failRead: false, failWrite: false };
  const api = { async request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (method === 'POST') { f.posts.push({ path, body }); if (f.failWrite) throw new Error('response_lost'); return null; }
    if (f.failRead) throw new Error('github_http_403');
    if (path.includes('head_sha=')) { f.polls++; return { workflow_runs: f.list }; }
    if (path.includes('branch=main')) return { workflow_runs: f.previous };
    throw new Error('unexpected_api');
  } };
  const options = () => ({ api, input, now: () => f.now, loadState: async () => f.state, sleep: async (ms: number) => { f.now += ms; }, timeout: 60000 });
  return Object.assign(f, { api, options });
}
describe('CI completion without a workflow_run delivery', () => {
  it('waits for actual completion and sends only the fixed trusted-main continuation', async () => {
    const f = fixture(), o = f.options();
    o.sleep = async (ms: number) => { f.now += ms; f.list[0]!.status = 'completed'; f.list[0]!.conclusion = 'success'; };
    expect(await waitForCI(o)).toEqual({ state: 'woken', ci_run: 10 });
    expect(f.polls).toBe(2);
    expect(f.posts).toEqual([{ path: '/actions/workflows/approved-loop.yml/dispatches', body: { ref: 'main', inputs: { key } } }]);
  });
  it('hands failed CI back for a policy decision instead of declaring it successful', async () => {
    const f = fixture(); f.list[0]!.status = 'completed'; f.list[0]!.conclusion = 'failure';
    expect((await waitForCI(f.options())).state).toBe('woken'); expect(f.posts).toHaveLength(1);
  });
  it('does not repeat a continuation with an actual API receipt, including a rerun', async () => {
    const f = fixture(); f.list[0]!.status = 'completed'; f.list[0]!.conclusion = 'success'; f.previous = [continuation()];
    expect((await waitForCI({ ...f.options(), allowDispatch: false })).state).toBe('already-woken'); expect(f.posts).toHaveLength(0);
  });
  it('does not resend after a lost write response without an observable receipt', async () => {
    const f = fixture(); f.list[0]!.status = 'completed'; f.list[0]!.conclusion = 'success'; f.failWrite = true;
    await expect(waitForCI(f.options())).rejects.toThrow('response_lost');
    await expect(waitForCI({ ...f.options(), allowDispatch: false })).rejects.toThrow('ambiguous_wait_delivery');
    expect(f.posts).toHaveLength(1);
  });
  it('does not wake work already consumed by a real completion event', async () => {
    const f = fixture(); f.state = { repository, tasks: [{ ...pending().tasks[0], phase: 'review' }] };
    expect((await waitForCI(f.options())).state).toBe('consumed'); expect(f.polls).toBe(0); expect(f.posts).toHaveLength(0);
  });
  it('rechecks the operation immediately before its write', async () => {
    const f = fixture(); f.list[0]!.status = 'completed'; f.list[0]!.conclusion = 'success'; let reads = 0;
    expect((await waitForCI({ ...f.options(), loadState: async () => ++reads === 1 ? pending() : { repository, tasks: [] } })).state).toBe('consumed');
    expect(f.posts).toHaveLength(0);
  });
  it('bounds waiting when CI is absent and never sends speculative work', async () => {
    const f = fixture(); f.list = [];
    await expect(waitForCI(f.options())).rejects.toThrow('wait_ci_timeout'); expect(f.now).toBe(60000); expect(f.posts).toHaveLength(0);
    await expect(waitForCI({ ...f.options(), timeout: 36 * 60 * 1000 })).rejects.toThrow('invalid_wait_timeout');
  });
  it('fails closed on unavailable API data and duplicate matching CI runs', async () => {
    const f = fixture(); f.failRead = true; await expect(waitForCI(f.options())).rejects.toThrow('github_http_403');
    f.failRead = false; f.list = [ci(), { ...ci(), id: 11 }]; await expect(waitForCI(f.options())).rejects.toThrow('ambiguous_wait_ci');
    expect(f.posts).toHaveLength(0);
  });
  it('rejects an unrelated path, wrong key, repository or SHA as CI authority', async () => {
    for (const wrong of [{ ...ci(), path: '.github/workflows/unrelated.yml' }, { ...ci(), display_title: 'Approved loop ' + 'e'.repeat(64) }, { ...ci(), repository: { full_name: 'untrusted/fork' } }, { ...ci(), head_sha: base }]) {
      const f = fixture(); f.list = [wrong];
      await expect(waitForCI(f.options())).rejects.toThrow(wrong.head_sha === base ? 'invalid_wait_ci' : 'wait_ci_timeout'); expect(f.posts).toHaveLength(0);
    }
  });
  it('refuses duplicate continuation receipts and incomplete pagination', async () => {
    const f = fixture(); f.list[0]!.status = 'completed'; f.list[0]!.conclusion = 'success'; f.previous = [continuation(), { ...continuation(), id: 21 }];
    await expect(waitForCI(f.options())).rejects.toThrow('ambiguous_wait_delivery'); expect(f.posts).toHaveLength(0);
    await expect(waitForCI({ ...f.options(), api: { async request() { return { workflow_runs: Array.from({ length: 100 }, ci) }; } } })).rejects.toThrow('wait_pagination_limit');
  });
});
describe('exact operation and workflow privilege boundaries', () => {
  it('binds the PR, key and all three SHAs', () => {
    expect(isPendingWakeup(pending(), input)).toBe(true);
    for (const wrong of [{ ...input, pr: '59' }, { ...input, key: 'e'.repeat(64) }, { ...input, head: base }, { ...input, base: head }, { ...input, checkout: head }]) expect(isPendingWakeup(pending(), wrong)).toBe(false);
    for (const wrong of [null, { ...input, pr: '../58' }, { ...input, pr: 58 }, { ...input, key: 'bad' }, { ...input, head: 'bad' }]) expect(() => parseWaitRequest(wrong)).toThrow('invalid_wait_request');
  });
  it('uses only the latest bootstrap checkpoint and also binds post-merge main CI', () => {
    const mainInput = { pr: '0', head, base: head, checkout: head, key };
    const state = { repository, bootstrap: { main: base, key: 'e'.repeat(64), ready: false, checks: [{ main: head, key, ready: false }] }, tasks: [] };
    expect(isPendingWakeup(state, mainInput)).toBe(true);
    expect(isPendingWakeup(state, { ...mainInput, key: 'e'.repeat(64) })).toBe(false);
    expect(isPendingWakeup({ ...state, bootstrap: { ...state.bootstrap, ready: true } }, mainInput)).toBe(false);
    expect(isPendingWakeup({ repository, tasks: [{ phase: 'main-ci', merged: head, operation: { key } }] }, mainInput)).toBe(true);
    expect(isPendingWakeup({ repository, tasks: [{ phase: 'main-ci', merged: head, operation: { key } }] }, { ...mainInput, base })).toBe(false);
  });
  it('keeps product CI read-only and the completion bridge on trusted main without user credentials or schedules', () => {
    const workflow = readFileSync('.github/workflows/loop-completion.yml', 'utf8');
    expect(workflow).toContain("github.ref == 'refs/heads/main'"); expect(workflow).toContain('ref: ${{ github.sha }}'); expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('actions: write'); expect(workflow).not.toContain('contents: write'); expect(workflow).not.toContain('secrets.'); expect(workflow).not.toContain('npm '); expect(workflow).not.toContain('schedule:'); expect(workflow).toContain('timeout-minutes: 40');
    const product = readFileSync('.github/workflows/loop-validation.yml', 'utf8'); expect(product).not.toContain('actions: write'); expect(product).not.toContain('secrets.'); expect(product).not.toContain('contents: write');
  });
});

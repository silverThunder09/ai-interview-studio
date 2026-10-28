import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { dispatchApprovedCloud } from '../../scripts/review/direct-cloud.mjs';
import { approvedDevelopmentBody, emptyLoopState, parseLoopState, preserveDirectCloud, type LoopState } from '../../scripts/review/loop-coordinator.mjs';

const repo = 'silverThunder09/ai-interview-studio';
const sha = (n: string) => n.repeat(40);
const key = 'a'.repeat(64);
const config = { schema: 1, repository: repo, enabled: true, cloud_transport: 'disabled', tasks: [{ id: 'work-a', pr: 80, goal: '승인된 합성 작업', approval: '사용자 승인', allowed_paths: ['src/a.ts'] }] };

function fixture() {
  const state = emptyLoopState(config);
  state.bootstrap = { main: sha('1'), key: 'b'.repeat(64), ready: true };
  const request = { schema: 2, repository: repo, pr_number: 80, request_key: key, head_sha: sha('2'), base_sha: sha('1'), requested_at: '2026-10-28T00:00:00.000Z', mode: 'repair', allowed_paths: ['src/a.ts'] };
  const body = approvedDevelopmentBody(request, config.tasks[0], {});
  Object.assign(state.tasks[0]!, { phase: 'development', branch: 'work/a', request, delivery: { phase: 'sending', hash: createHash('sha256').update(body).digest('hex'), body, id: null, attempted: false } });
  const store = {
    state, head: 1, loseIntent: false, loseReceipt: false,
    async load() { return { head: this.head, state: structuredClone(this.state) }; },
    async save(old: { head: number }, next: LoopState) {
      if (old.head !== this.head) throw new Error('loop_cas_conflict');
      this.state = structuredClone(next); this.head++;
      if (this.loseIntent && this.state.tasks[0]?.direct_cloud) { this.loseIntent = false; throw new Error('lost_checkpoint_response'); }
      if (this.loseReceipt && (this.state.tasks[0]?.direct_cloud as { phase?: string } | undefined)?.phase === 'sent') { this.loseReceipt = false; throw new Error('lost_receipt_response'); }
      return this.load();
    },
  };
  const api = { async request(_method: string, path: string): Promise<unknown> {
    if (path.startsWith('/issues/')) return [];
    if (path.startsWith('/pulls/80/files')) return [{ filename: 'src/a.ts', status: 'modified' }];
    if (path === '/pulls/80') return { state: 'open', merged: false, user: { login: 'silverThunder09' }, head: { sha: sha('2'), ref: 'work/a', repo: { full_name: repo, fork: false } }, base: { sha: sha('1'), ref: 'main', repo: { full_name: repo } } };
    if (path === '/branches/main') return { commit: { sha: sha('1') } };
    if (path === '/git/ref/heads/work/a') return { object: { sha: sha('2') } };
    throw new Error('unexpected_request');
  } };
  const launch = vi.fn(async () => ({ id: 'task_synthetic_1' }));
  const verifyHistory = vi.fn(async () => true);
  return { store, api, launch, verifyHistory, options: { api, store, config, taskId: 'work-a', environment: 'env_1', now: () => 1000000, launch, verifyHistory } };
}

describe('direct Cloud delivery journal', () => {
  it('persists intent before one launch, stores the returned task id and refuses a repeat', async () => {
    const f = fixture();
    f.launch.mockImplementation(async () => {
      expect(f.store.state.tasks[0]?.direct_cloud).toMatchObject({ phase: 'attempting', request_key: key });
      return { id: 'task_synthetic_1' };
    });
    await expect(dispatchApprovedCloud(f.options)).resolves.toEqual({ state: 'sent', task_id: 'task_synthetic_1' });
    expect(f.store.state.tasks[0]?.direct_cloud).toMatchObject({ phase: 'sent', task_id: 'task_synthetic_1' });
    expect(f.store.state.lease).toBeNull();
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('not_ready_for_direct_cloud');
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it('holds after an ambiguous Cloud response without a second launch', async () => {
    const f = fixture(); f.launch.mockRejectedValueOnce(new Error('response_lost'));
    await expect(dispatchApprovedCloud(f.options)).resolves.toEqual({ state: 'ambiguous_delivery' });
    expect(f.store.state.tasks[0]?.direct_cloud).toMatchObject({ phase: 'attempting', task_id: null });
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('not_ready_for_direct_cloud');
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it('does not launch when the durable intent write succeeds but its response is lost', async () => {
    const f = fixture(); f.store.loseIntent = true;
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('lost_checkpoint_response');
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('not_ready_for_direct_cloud');
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('allows only one worker to launch while an earlier submission is in progress', async () => {
    const f = fixture(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    f.launch.mockImplementation(async () => { started(); await gate; return { id: 'task_synthetic_1' }; });
    const first = dispatchApprovedCloud(f.options); await entered;
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('not_ready_for_direct_cloud');
    release(); await expect(first).resolves.toEqual({ state: 'sent', task_id: 'task_synthetic_1' });
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it('never resends when the receipt checkpoint succeeds but its response is lost', async () => {
    const f = fixture(); f.store.loseReceipt = true;
    await expect(dispatchApprovedCloud(f.options)).resolves.toEqual({ state: 'receipt_persistence_unknown' });
    expect(f.store.state.tasks[0]?.direct_cloud).toMatchObject({ phase: 'sent', task_id: 'task_synthetic_1' });
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('not_ready_for_direct_cloud');
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it('rejects attempts to erase a direct receipt or replace its task identity', async () => {
    const f = fixture(); await dispatchApprovedCloud(f.options);
    const saved = f.store.state.tasks[0]!;
    const altered = structuredClone(saved); delete altered.direct_cloud;
    expect(() => preserveDirectCloud(saved, altered)).toThrow('direct_cloud_history_changed');
    const replaced = structuredClone(saved);
    (replaced.direct_cloud as { task_id: string }).task_id = 'task_other';
    expect(() => preserveDirectCloud(saved, replaced)).toThrow('direct_cloud_history_changed');
    const broken = structuredClone(f.store.state);
    (broken.tasks[0]!.direct_cloud as { phase: string }).phase = 'unknown';
    expect(() => parseLoopState(broken, config)).toThrow('invalid_direct_cloud_journal');
  });
  it('does not send when the PR or main changes after the intent checkpoint', async () => {
    const f = fixture(); const original = f.api.request; let reads = 0;
    f.api.request = async (method, path) => path === '/branches/main' && ++reads === 3
      ? { commit: { sha: sha('3') } } : original(method, path);
    await expect(dispatchApprovedCloud(f.options)).resolves.toEqual({ state: 'preflight_changed' });
    expect(f.store.state.tasks[0]?.direct_cloud).toMatchObject({ phase: 'attempting' });
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('holds for unreconciled history, a stopped issue, or stale main without launching', async () => {
    const f = fixture(); f.verifyHistory.mockResolvedValue(false);
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('cloud_history_unreconciled');
    const stopped = fixture(); const original = stopped.api.request;
    stopped.api.request = async (method, path) => path.startsWith('/issues/35/labels') ? [{ name: 'agent-paused' }] : original(method, path);
    await expect(dispatchApprovedCloud(stopped.options)).rejects.toThrow('loop_control_paused');
    const stale = fixture(); const request = stale.api.request;
    stale.api.request = async (method, path) => path === '/branches/main' ? { commit: { sha: sha('3') } } : request(method, path);
    await expect(dispatchApprovedCloud(stale.options)).rejects.toThrow('stale_cloud_request');
    expect(f.launch).not.toHaveBeenCalled(); expect(stopped.launch).not.toHaveBeenCalled(); expect(stale.launch).not.toHaveBeenCalled();
  });
  it('rejects a changed prompt even if its stored hash was changed to match', async () => {
    const f = fixture(); const delivery = f.store.state.tasks[0]!.delivery as { body: string; hash: string };
    delivery.body = '승인되지 않은 요청'; delivery.hash = createHash('sha256').update(delivery.body).digest('hex');
    await expect(dispatchApprovedCloud(f.options)).rejects.toThrow('untrusted_cloud_body');
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('preserves completed task history and receipt while dispatching the next entry', async () => {
    const f = fixture();
    const earlier = { ...config.tasks[0]!, id: 'old-work', pr: 79 };
    const two = { ...config, tasks: [earlier, ...config.tasks] };
    const state = emptyLoopState(two); state.bootstrap = f.store.state.bootstrap!;
    Object.assign(state.tasks[0]!, { phase: 'completed', cycles: 2, merged: sha('4'), prior_receipt: { id: 987, outcome: 'completed' } });
    state.tasks[1] = structuredClone(f.store.state.tasks[0]!);
    const original = structuredClone(state.tasks[0]); f.store.state = state;
    await expect(dispatchApprovedCloud({ ...f.options, config: two })).resolves.toEqual({ state: 'sent', task_id: 'task_synthetic_1' });
    expect(f.store.state.tasks[0]).toEqual(original);
  });
});

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { dispatchApprovedReview } from '../../scripts/review/direct-review-dispatch.mjs';
import { buildDirectReviewRequest } from '../../scripts/review/direct-review-protocol.mjs';
import { emptyLoopState, parseLoopState, preserveDirectCloud, type LoopState } from '../../scripts/review/loop-coordinator.mjs';

const repository = 'silverThunder09/ai-interview-studio', sha = (n: string) => n.repeat(40), key = 'a'.repeat(64);
const config = { schema: 1, repository, enabled: true, cloud_transport: 'disabled', tasks: [{ id: 'work-a', pr: 80, goal: '승인된 합성 작업', approval: '사용자 승인', allowed_paths: ['src/a.ts'] }] };
function fixture() {
  const state = emptyLoopState(config); state.bootstrap = { main: sha('1'), key: 'b'.repeat(64), ready: true };
  const request = { schema: 2, repository, pr_number: 80, request_key: key, head_sha: sha('2'), base_sha: sha('1'), requested_at: '2026-10-28T00:00:00.000Z', mode: 'read-only', allowed_paths: [] };
  const body = buildDirectReviewRequest(request, config.tasks[0]!.allowed_paths);
  const validated_ci = ['checks', 'package', 'pr-policy'].map(context => ({ context, repository, pr_number: 80, head_sha: sha('2'), base_sha: sha('1'), checkout_sha: sha('3'), run_id: '123' }));
  Object.assign(state.tasks[0]!, { phase: 'review', branch: 'work/a', head: sha('2'), base: sha('1'), checkout: sha('3'), request, validated_ci,
    delivery: { phase: 'sending', hash: createHash('sha256').update(body).digest('hex'), body, id: null, attempted: false } });
  const store = { state, head: 1, loseIntent: false, loseReceipt: false,
    async load() { return { head: this.head, state: structuredClone(this.state) }; },
    async save(old: { head: number }, next: LoopState) {
      if (old.head !== this.head) throw new Error('loop_cas_conflict');
      parseLoopState(next, config); preserveDirectCloud(this.state.tasks[0]!, next.tasks[0]!);
      this.state = structuredClone(next); this.head++;
      if (this.loseIntent && this.state.tasks[0]?.direct_cloud) { this.loseIntent = false; throw new Error('lost_checkpoint_response'); }
      if (this.loseReceipt && (this.state.tasks[0]?.direct_cloud as { phase?: string } | undefined)?.phase === 'sent') { this.loseReceipt = false; throw new Error('lost_receipt_response'); }
      return this.load();
    } };
  const api = { async request(_method: string, path: string): Promise<unknown> {
    if (path.startsWith('/issues/')) return [];
    if (path.startsWith('/pulls/80/files')) return [{ filename: 'src/a.ts', status: 'modified' }];
    if (path === '/pulls/80') return { state: 'open', merged: false, draft: false, merge_commit_sha: sha('3'), user: { login: 'silverThunder09' }, head: { sha: sha('2'), ref: 'work/a', repo: { full_name: repository, fork: false } }, base: { sha: sha('1'), ref: 'main', repo: { full_name: repository } } };
    if (path === '/branches/main') return { commit: { sha: sha('1') } };
    if (path === '/git/ref/heads/work/a') return { object: { sha: sha('2') } };
    throw new Error('unexpected_request');
  } };
  const launch = vi.fn(async () => ({ id: 'task_synthetic_1' })), verifyHistory = vi.fn(async () => true), verifyCI = vi.fn(async () => true);
  return { store, api, launch, verifyHistory, verifyCI, options: { api, store, config, taskId: 'work-a', environment: 'env_1', now: () => 1000000, launch, verifyHistory, verifyCI } };
}

describe('direct Cloud review dispatch journal', () => {
  it('persists intent before one launch and cannot resend an acknowledged task', async () => {
    const f = fixture(); f.launch.mockImplementation(async () => { expect(f.store.state.tasks[0]?.direct_cloud).toMatchObject({ phase: 'attempting', request_key: key }); return { id: 'task_synthetic_1' }; });
    expect(await dispatchApprovedReview(f.options)).toEqual({ state: 'sent', task_id: 'task_synthetic_1' });
    expect(f.store.state.lease).toBeNull();
    await expect(dispatchApprovedReview(f.options)).rejects.toThrow('not_ready_for_direct_review'); expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it('holds after an ambiguous response, intent write or receipt write and never resends', async () => {
    const ambiguous = fixture(); ambiguous.launch.mockRejectedValueOnce(new Error('response_lost'));
    expect(await dispatchApprovedReview(ambiguous.options)).toEqual({ state: 'ambiguous_delivery' });
    await expect(dispatchApprovedReview(ambiguous.options)).rejects.toThrow('not_ready_for_direct_review'); expect(ambiguous.launch).toHaveBeenCalledTimes(1);
    const intent = fixture(); intent.store.loseIntent = true;
    await expect(dispatchApprovedReview(intent.options)).rejects.toThrow('lost_checkpoint_response');
    await expect(dispatchApprovedReview(intent.options)).rejects.toThrow('not_ready_for_direct_review'); expect(intent.launch).not.toHaveBeenCalled();
    const receipt = fixture(); receipt.store.loseReceipt = true;
    expect(await dispatchApprovedReview(receipt.options)).toEqual({ state: 'receipt_persistence_unknown' });
    await expect(dispatchApprovedReview(receipt.options)).rejects.toThrow('not_ready_for_direct_review'); expect(receipt.launch).toHaveBeenCalledTimes(1);
  });
  it('only sends once when two runners compete', async () => {
    const f = fixture(); let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    f.launch.mockImplementation(async () => { entered(); await waiting; return { id: 'task_synthetic_1' }; });
    const first = dispatchApprovedReview(f.options); await started;
    await expect(dispatchApprovedReview(f.options)).rejects.toThrow('not_ready_for_direct_review'); release();
    expect(await first).toEqual({ state: 'sent', task_id: 'task_synthetic_1' }); expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it('uses the ledger compare-and-swap to stop simultaneous first attempts', async () => {
    const f = fixture();
    await Promise.allSettled([dispatchApprovedReview(f.options), dispatchApprovedReview(f.options)]);
    expect(f.launch).toHaveBeenCalledTimes(1);
    expect(f.store.state.tasks[0]?.direct_cloud).toMatchObject({ phase: 'sent', task_id: 'task_synthetic_1' });
  });
  it('holds when history, CI, PR or main changes before launch', async () => {
    const history = fixture(); history.verifyHistory.mockResolvedValue(false);
    await expect(dispatchApprovedReview(history.options)).rejects.toThrow('cloud_history_unreconciled'); expect(history.launch).not.toHaveBeenCalled();
    const ci = fixture(); ci.verifyCI.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await dispatchApprovedReview(ci.options)).toEqual({ state: 'preflight_changed' }); expect(ci.launch).not.toHaveBeenCalled();
    const stale = fixture(), original = stale.api.request; let reads = 0;
    stale.api.request = async (method, path) => path === '/branches/main' && ++reads === 3 ? { commit: { sha: sha('4') } } : original(method, path);
    expect(await dispatchApprovedReview(stale.options)).toEqual({ state: 'preflight_changed' }); expect(stale.launch).not.toHaveBeenCalled();
  });
  it('rejects missing verifiers, manipulated prompts, stale CI and paused control', async () => {
    const f = fixture(); await expect(dispatchApprovedReview({ ...f.options, verifyCI: undefined })).rejects.toThrow('direct_review_disabled');
    const bad = fixture(), delivery = bad.store.state.tasks[0]!.delivery as { body: string; hash: string }; delivery.body = 'altered'; delivery.hash = createHash('sha256').update(delivery.body).digest('hex');
    await expect(dispatchApprovedReview(bad.options)).rejects.toThrow('untrusted_review_body');
    const old = fixture(); (old.store.state.tasks[0]!.validated_ci as { base_sha: string }[])[0]!.base_sha = sha('4');
    await expect(dispatchApprovedReview(old.options)).rejects.toThrow('unverified_review_ci');
    const stopped = fixture(), original = stopped.api.request;
    stopped.api.request = async (method, path) => path.startsWith('/issues/35/labels') ? [{ name: 'agent-paused' }] : original(method, path);
    await expect(dispatchApprovedReview(stopped.options)).rejects.toThrow('loop_control_paused');
    expect(f.launch).not.toHaveBeenCalled(); expect(bad.launch).not.toHaveBeenCalled(); expect(old.launch).not.toHaveBeenCalled(); expect(stopped.launch).not.toHaveBeenCalled();
  });
  it('uses the real history and CI verifiers by default and holds on missing evidence', async () => {
    const history = fixture();
    await expect(dispatchApprovedReview({ ...history.options, verifyHistory: undefined, list: async () => [] })).rejects.toThrow('cloud_history_unreconciled');
    expect(history.launch).not.toHaveBeenCalled();
    const ci = fixture();
    await expect(dispatchApprovedReview({ ...ci.options, verifyCI: undefined, policy: { required_checks: ['checks'] } })).rejects.toThrow('invalid_review_ci_policy');
    expect(ci.launch).not.toHaveBeenCalled();
  });
});

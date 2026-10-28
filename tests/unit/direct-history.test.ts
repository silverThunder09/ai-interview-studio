import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { installDirectInventory, createDirectHistoryVerifier } from '../../scripts/review/direct-history.mjs';
import { dispatchApprovedCloud } from '../../scripts/review/direct-cloud.mjs';
import { approvedDevelopmentBody, appendApprovedTasks, emptyLoopState, parseLoopState, type LoopState } from '../../scripts/review/loop-coordinator.mjs';

const repo = 'silverThunder09/ai-interview-studio', sha = (s: string) => s.repeat(40), key = 'a'.repeat(64);
const definition = (id: string, pr: number) => ({ id, pr, goal: '승인 작업', approval: '사용자 승인', allowed_paths: ['src/a.ts'] });
const config = { schema: 1, repository: repo, enabled: true, cloud_transport: 'disabled', tasks: [definition('old', 80)] };
const later = { ...config, tasks: [...config.tasks, definition('next', 81)] };
const historical = [{ id: 'task_old_a', status: 'ready', known_status: true, attempt_total: 1, updated_at: '2026-10-27T00:00:00Z' }, { id: 'task_old_b', status: 'error', known_status: true, attempt_total: 1, updated_at: '2026-10-27T00:00:00Z' }];

const baseline: typeof historical = [];

function fixture() {
  const state = emptyLoopState(config); state.bootstrap = { main: sha('1'), key: 'b'.repeat(64), ready: true };
  Object.assign(state.tasks[0]!, { phase: 'completed', cycles: 2, merged: sha('2'), retained: { receipt: 'existing' } });
  const store = {
    state, head: 1, writes: 0, loseReply: false, validationConfig: config,
    async load() { return { head: this.head, state: structuredClone(this.state) }; },
    async save(old: { head: number }, next: LoopState) {
      if (old.head !== this.head) throw new Error('loop_cas_conflict');
      parseLoopState(next, this.validationConfig); this.state = structuredClone(next); this.head++; this.writes++;
      if (this.loseReply) { this.loseReply = false; throw new Error('response_lost'); }
      return this.load();
    },
  };
  let comments: { body: string; created_at: string }[] = [];
  let labels: { name: string }[] = [];
  const api = { async request(_method: string, path: string): Promise<unknown> {
    if (path.startsWith('/issues/35/labels')) return labels;
    if (path.startsWith('/issues/81/comments')) return comments;
    if (path.startsWith('/issues/81/labels')) return [];
    if (path.startsWith('/pulls/81/files')) return [{ filename: 'src/a.ts', status: 'modified' }];
    if (path === '/pulls/81') return { state: 'open', merged: false, user: { login: 'silverThunder09' }, head: { sha: sha('3'), ref: 'work/next', repo: { full_name: repo, fork: false } }, base: { sha: sha('1'), ref: 'main', repo: { full_name: repo } } };
    if (path === '/branches/main') return { commit: { sha: sha('1') } };
    if (path === '/git/ref/heads/work/next') return { object: { sha: sha('3') } };
    throw new Error('unexpected_api');
  } };
  const list = vi.fn(async () => structuredClone(baseline));
  return { store, api, list, setComments: (x: typeof comments) => { comments = x; }, setLabels: (x: typeof labels) => { labels = x; }, options: { api, store, config, list } };
}
function nextState(state: LoopState) {
  const s = appendApprovedTasks(state, later);
  const request = { schema: 2, repository: repo, pr_number: 81, request_key: key, head_sha: sha('3'), base_sha: sha('1'), requested_at: '2026-10-28T00:00:00.000Z', mode: 'repair', allowed_paths: ['src/a.ts'] };
  const body = approvedDevelopmentBody(request, later.tasks[1], {});
  Object.assign(s.tasks[1]!, { phase: 'development', branch: 'work/next', request, delivery: { phase: 'sending', hash: createHash('sha256').update(body).digest('hex'), body, id: null, attempted: false } });
  return s;
}

describe('direct Cloud history inventory', () => {
  it('installs a stable terminal snapshot without changing the completed queue', async () => {
    const f = fixture(), original = structuredClone(f.store.state.tasks);
    await expect(installDirectInventory(f.options)).resolves.toEqual({ state: 'installed', count: 0 });
    expect(f.store.state.tasks).toEqual(original); expect(f.store.state.direct_inventory?.queue_ids).toEqual(['old']);
    expect(await installDirectInventory(f.options)).toEqual({ state: 'already_present' }); expect(f.store.writes).toBe(1);
  });
  it('recognizes an installed snapshot after a lost write response without repeating the write', async () => {
    const f = fixture(); f.store.loseReply = true;
    await expect(installDirectInventory(f.options)).rejects.toThrow('response_lost');
    expect(await installDirectInventory(f.options)).toEqual({ state: 'already_present' }); expect(f.store.writes).toBe(1);
  });
  it('refuses stable terminal history until each task is correlated with a consumed result', async () => {
    for (const entry of historical) {
      const f = fixture(); f.list.mockResolvedValue([entry]);
      await expect(installDirectInventory(f.options)).rejects.toThrow('cloud_history_unreconciled');
      expect(f.store.writes).toBe(0);
    }
  });
  it('refuses an existing nonempty inventory that lacks authenticated reconciliation', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    const state = nextState(f.store.state);
    const { id, status, attempt_total, updated_at } = historical[0]!;
    state.direct_inventory!.tasks = [{ id, status: status as 'ready', attempt_total, updated_at }];
    const verify = createDirectHistoryVerifier({ api: f.api, config: later, list: f.list });
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('cloud_history_unreconciled');
  });
  it('does not initialize with running work, different snapshots, paused labels or an unfinished queue', async () => {
    const a = fixture(); a.list.mockResolvedValue([{ ...historical[0]!, status: 'running' }]);
    await expect(installDirectInventory(a.options)).rejects.toThrow('unsettled_cloud_history');
    const b = fixture(); b.list.mockResolvedValueOnce(baseline).mockResolvedValueOnce(historical.slice(0, 1));
    await expect(installDirectInventory(b.options)).rejects.toThrow('cloud_history_changed');
    const c = fixture(); c.setLabels([{ name: 'agent-paused' }]);
    await expect(installDirectInventory(c.options)).rejects.toThrow('loop_control_paused');
    const d = fixture(); d.store.state.tasks[0]!.phase = 'queued';
    await expect(installDirectInventory(d.options)).rejects.toThrow('inventory_queue_not_idle');
    expect(a.store.writes + b.store.writes + c.store.writes + d.store.writes).toBe(0);
  });
  it('permits only a later queued request when all Cloud IDs are accounted for', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    const state = nextState(f.store.state), task = state.tasks[1]!;
    const verify = createDirectHistoryVerifier({ api: f.api, config: later, list: f.list });
    await expect(verify({ task, state })).resolves.toBe(true);
  });
  it('connects the real history verifier to the one-shot dispatcher without changing completed work', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    const state = nextState(f.store.state), old = structuredClone(state.tasks[0]);
    f.store.state = state; f.store.validationConfig = later;
    const verifyHistory = createDirectHistoryVerifier({ api: f.api, config: later, list: f.list });
    const launch = vi.fn(async () => ({ id: 'task_new' }));
    await expect(dispatchApprovedCloud({ api: f.api, store: f.store, config: later, taskId: 'next', environment: 'env_1', verifyHistory, launch, now: () => 1000000 })).resolves.toEqual({ state: 'sent', task_id: 'task_new' });
    expect(launch).toHaveBeenCalledTimes(1); expect(f.store.state.tasks[0]).toEqual(old);
  });
  it('does not trust an unverified prior direct completion to start a third task', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    const state = nextState(f.store.state); state.tasks[1]!.phase = 'completed';
    const three = { ...later, tasks: [...later.tasks, definition('third', 82)] };
    const expanded = appendApprovedTasks(state, three);
    const priorRequest = state.tasks[1]!.request as Record<string, unknown>;
    Object.assign(expanded.tasks[2]!, { phase: 'development', request: { ...priorRequest, pr_number: 82 }, delivery: structuredClone(state.tasks[1]!.delivery) });
    const verify = createDirectHistoryVerifier({ api: f.api, config: three, list: f.list });
    await expect(verify({ task: expanded.tasks[2], state: expanded })).rejects.toThrow('direct_history_unverified');
  });
  it('holds if an unknown or running Cloud task appears after inventory', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    const state = nextState(f.store.state), verify = createDirectHistoryVerifier({ api: f.api, config: later, list: f.list });
    f.list.mockResolvedValueOnce([...baseline, { id: 'task_new', status: 'ready', known_status: true, attempt_total: 1, updated_at: '2026-10-28T01:00:00Z' }]);
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('cloud_history_changed');
    f.list.mockResolvedValueOnce([{ ...historical[0]!, status: 'running' }]);
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('unsettled_cloud_history');
  });
  it('holds when an untracked Cloud task reports an attempt or changed result', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    const state = nextState(f.store.state), verify = createDirectHistoryVerifier({ api: f.api, config: later, list: f.list });
    f.list.mockResolvedValueOnce([{ ...historical[0]!, attempt_total: 2 }]);
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('cloud_history_changed');
    f.list.mockResolvedValueOnce([{ ...historical[0]!, updated_at: '2026-10-28T01:00:00Z' }]);
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('cloud_history_changed');
  });
  it('holds a same-key prior request or any later ambiguous Codex mention', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    const state = nextState(f.store.state), verify = createDirectHistoryVerifier({ api: f.api, config: later, list: f.list });
    f.setComments([{ body: `<!-- ais-development-request-v2:${key} -->`, created_at: '2026-10-27T00:00:00.000Z' }]);
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('ambiguous_prior_request');
    f.setComments([{ body: '@codex 이전 요청', created_at: '2026-10-28T00:00:01.000Z' }]);
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('ambiguous_prior_request');
  });
});

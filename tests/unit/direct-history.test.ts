import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { installDirectInventory, createDirectHistoryVerifier } from '../../scripts/review/direct-history.mjs';
import { dispatchApprovedCloud } from '../../scripts/review/direct-cloud.mjs';
import { runDirectTick } from '../../scripts/review/direct-tick.mjs';
import { runCapacityRunner } from '../../scripts/review/direct-capacity-runner.mjs';
import { approvedDevelopmentBody, appendApprovedTasks, emptyLoopState, parseLoopState, type LoopState } from '../../scripts/review/loop-coordinator.mjs';

const repo = 'silverThunder09/ai-interview-studio', sha = (s: string) => s.repeat(40), key = 'a'.repeat(64);
const definition = (id: string, pr: number) => ({ id, pr, goal: '승인 작업', approval: '사용자 승인', allowed_paths: ['src/a.ts'] });
const config = { schema: 1, repository: repo, enabled: true, cloud_transport: 'disabled', tasks: [definition('old', 80)] };
const later = { ...config, tasks: [...config.tasks, definition('next', 81)] };
const historical = [{ id: 'task_old_a', status: 'ready', known_status: true, attempt_total: 1, updated_at: '2026-10-27T00:00:00Z' }, { id: 'task_old_b', status: 'error', known_status: true, attempt_total: 1, updated_at: '2026-10-27T00:00:00Z' }];

const baseline: typeof historical = [];

function fixture() {
  const state = emptyLoopState(config); state.bootstrap = { main: sha('1'), key: 'b'.repeat(64), ready: true };
  Object.assign(state.tasks[0]!, { phase: 'completed', cycles: 2, merged: sha('1'), retained: { receipt: 'existing' } });
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
function nextState(state: LoopState, nextConfig = later) {
  const s = appendApprovedTasks(state, nextConfig);
  const request = { schema: 2, repository: repo, pr_number: 81, request_key: key, head_sha: sha('3'), base_sha: sha('1'), requested_at: '2026-10-28T00:00:00.000Z', mode: 'repair', allowed_paths: ['src/a.ts'] };
  const body = approvedDevelopmentBody(request, later.tasks[1], {});
  Object.assign(s.tasks[1]!, { phase: 'development', branch: 'work/next', request, delivery: { phase: 'sending', hash: createHash('sha256').update(body).digest('hex'), body, id: null, attempted: false } });
  return s;
}

const tickPolicy = { repository: repo, max_prs_per_run: 2, max_fix_cycles: 3, protected_paths: [], required_checks: ['checks', 'package', 'pr-policy'] };
const tickLimits = async () => ({ primary: { usedPercent: 20 }, secondary: { usedPercent: 30 }, rateLimitReachedType: null, rateLimitReachedTypeKnown: true });

describe('one-shot direct coordinator', () => {
  it('does nothing when all approved work is complete', async () => {
    const f = fixture(), launch = vi.fn();
    await expect(runDirectTick({ api: f.api, store: f.store, config, policy: tickPolicy, environment: 'env_1', cloud: { launch } })).resolves.toEqual({ state: 'idle' });
    expect(launch).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled(); expect(f.store.writes).toBe(0);
  });
  it('dispatches one prepared task using real history checks', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const launch = vi.fn(async () => ({ id: 'task_new' }));
    const options = { api: f.api, store: f.store, config: later, policy: tickPolicy, environment: 'env_1', now: () => 1000000, cloud: { list: f.list, limits: tickLimits, launch } };
    await expect(runDirectTick(options)).resolves.toEqual({ state: 'sent', task_id: 'task_new' });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(f.store.state.tasks[1]!.direct_cloud).toMatchObject({ phase: 'sent', task_id: 'task_new' });
  });
  it('holds before submission when prior work or official capacity is unknown', async () => {
    const f = fixture(), initial = nextState(f.store.state), launch = vi.fn(async () => ({ id: 'task_new' }));
    f.store.state = initial; f.store.validationConfig = later;
    const options = { api: f.api, store: f.store, config: later, policy: tickPolicy, environment: 'env_1', now: () => 1000000, cloud: { list: f.list, limits: tickLimits, launch } };
    await expect(runDirectTick(options)).resolves.toMatchObject({ state: 'history-hold' });
    f.store.state = fixture().store.state; f.store.validationConfig = config;
    await installDirectInventory(f.options); f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    await expect(runDirectTick({ ...options, cloud: { ...options.cloud, limits: async () => ({ primary: null, secondary: null, rateLimitReachedType: null, rateLimitReachedTypeKnown: true }) } })).resolves.toEqual({ state: 'limits-hold', reason: 'unknown' });
    await expect(runDirectTick({ ...options, cloud: { ...options.cloud, limits: async () => ({ primary: { usedPercent: 1 }, secondary: { usedPercent: 20 }, rateLimitReachedType: null, rateLimitReachedTypeKnown: false }) } })).resolves.toEqual({ state: 'limits-hold', reason: 'unknown' });
    await expect(runDirectTick({ ...options, cloud: { ...options.cloud, limits: async () => ({ primary: { usedPercent: 100 }, secondary: { usedPercent: 20 }, rateLimitReachedType: null, rateLimitReachedTypeKnown: true }) } })).resolves.toEqual({ state: 'limits-hold', reason: 'limited', request_key: key });
    expect(launch).not.toHaveBeenCalled(); expect(f.store.state.tasks[1]!.direct_cloud).toBeUndefined();
  });
  it('does not dispatch after main moves beyond the verified completed predecessor', async () => {
    const f = fixture(); f.store.state.tasks[0]!.merged = sha('2'); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const launch = vi.fn(async () => ({ id: 'task_new' }));
    await expect(runDirectTick({ api: f.api, store: f.store, config: later, policy: tickPolicy, environment: 'env_1', now: () => 1000000, cloud: { list: f.list, limits: tickLimits, launch } })).resolves.toEqual({ state: 'main-ci-hold' });
    expect(launch).not.toHaveBeenCalled();
  });
  it('rejects weakened CI policy or a stop label before dispatching', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const launch = vi.fn(async () => ({ id: 'task_new' }));
    const options = { api: f.api, store: f.store, config: later, policy: tickPolicy, environment: 'env_1', now: () => 1000000, cloud: { list: f.list, limits: tickLimits, launch } };
    await expect(runDirectTick({ ...options, policy: { ...tickPolicy, required_checks: ['checks', 'pr-policy'] } })).rejects.toThrow('direct_tick_disabled');
    f.setLabels([{ name: 'agent-paused' }]);
    await expect(runDirectTick(options)).rejects.toThrow('loop_control_paused');
    expect(launch).not.toHaveBeenCalled();
  });
  it('does not submit when the existing GitHub App writer is unavailable', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const launch = vi.fn(async () => ({ id: 'task_new' }));
    await expect(runDirectTick({ api: f.api, store: f.store, config: { ...later, pr_auth: 'github-app' }, policy: tickPolicy, environment: 'env_1', now: () => 1000000, cloud: { list: f.list, limits: tickLimits, launch } })).resolves.toEqual({ state: 'writer-hold', reason: 'unavailable' });
    expect(launch).not.toHaveBeenCalled();
  });
  it('keeps a sent task intact when the existing GitHub App writer is unavailable', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const task = f.store.state.tasks[1]!;
    Object.assign(task.delivery as object, { attempted: true });
    task.direct_cloud = { request_key: key, environment: 'env_1', branch: 'work/next', phase: 'sent', task_id: 'task_new' };
    const writes = f.store.writes; f.list.mockClear();
    await expect(runDirectTick({ api: f.api, store: f.store, config: { ...later, pr_auth: 'github-app' }, policy: tickPolicy, environment: 'env_1', now: () => 1000000, cloud: { list: f.list } })).resolves.toEqual({ state: 'writer-hold', reason: 'unavailable' });
    expect(f.list).not.toHaveBeenCalled(); expect(f.store.writes).toBe(writes);
    expect(f.store.state.tasks[1]).toMatchObject({ phase: 'development', direct_cloud: { phase: 'sent', task_id: 'task_new' } });
  });
  it('never reuses a writer whose credential validation failed', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const client = vi.fn().mockRejectedValueOnce(new Error('invalid_token')).mockResolvedValue({});
    const dispose = vi.fn(async () => {}), launch = vi.fn(async () => ({ id: 'task_new' }));
    const options = { api: f.api, store: f.store, config: { ...later, pr_auth: 'github-app' }, policy: tickPolicy, environment: 'env_1', now: () => 1000000, writer: { credentials: { client, dispose } }, cloud: { list: f.list, limits: tickLimits, launch } };
    await expect(runDirectTick(options)).resolves.toEqual({ state: 'writer-hold', reason: 'unavailable' });
    await expect(runDirectTick(options)).resolves.toEqual({ state: 'writer-hold', reason: 'unavailable' });
    expect(client).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalledTimes(1); expect(launch).not.toHaveBeenCalled();
  });
  it('does not resend an attempt with an unknown delivery outcome', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const task = f.store.state.tasks[1]!;
    Object.assign(task.delivery as object, { attempted: true });
    task.direct_cloud = { request_key: key, environment: 'env_1', branch: 'work/next', phase: 'attempting', task_id: null };
    const writes = f.store.writes, launch = vi.fn();
    await expect(runDirectTick({ api: f.api, store: f.store, config: later, policy: tickPolicy, environment: 'env_1', now: () => 1000000, cloud: { list: f.list, limits: tickLimits, launch } })).resolves.toEqual({ state: 'waiting-direct-cloud' });
    expect(launch).not.toHaveBeenCalled(); expect(f.store.writes).toBe(writes);
  });
  it('waits for official capacity and submits the same untouched request once', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const launch = vi.fn(async () => ({ id: 'task_new' }));
    const limits = vi.fn().mockResolvedValueOnce({ primary: { usedPercent: 100 }, secondary: { usedPercent: 20 }, rateLimitReachedType: null, rateLimitReachedTypeKnown: true }).mockImplementation(tickLimits);
    const wait = vi.fn(async () => {});
    const tick = async ({ expectedRequestKey }: { expectedRequestKey?: string }) => runDirectTick({ api: f.api, store: f.store, config: later, policy: tickPolicy, environment: 'env_1', expectedRequestKey, now: () => 1000000, cloud: { list: f.list, limits, launch } });
    await expect(runCapacityRunner({ token: 'synthetic', environment: 'env_1', tick, wait })).resolves.toEqual({ state: 'sent', task_id: 'task_new' });
    expect(wait).toHaveBeenCalledTimes(1); expect(launch).toHaveBeenCalledTimes(1);
  });
  it('holds if the waiting request was attempted before capacity returned', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const launch = vi.fn(async () => ({ id: 'task_new' }));
    const options = { api: f.api, store: f.store, config: later, policy: tickPolicy, environment: 'env_1', expectedRequestKey: key, now: () => 1000000, cloud: { list: f.list, limits: tickLimits, launch } };
    Object.assign(f.store.state.tasks[1]!.delivery as object, { attempted: true });
    await expect(runDirectTick(options)).resolves.toEqual({ state: 'resumption-hold' });
    expect(launch).not.toHaveBeenCalled();
  });
  it('refuses a different request even if it replaces the request before the dispatcher reloads', async () => {
    const f = fixture(); await installDirectInventory(f.options);
    f.store.state = nextState(f.store.state); f.store.validationConfig = later;
    const launch = vi.fn(async () => ({ id: 'task_new' })), writes = f.store.writes;
    await expect(dispatchApprovedCloud({ api: f.api, store: f.store, config: later, taskId: 'next', environment: 'env_1', expectedRequestKey: 'c'.repeat(64), launch })).rejects.toThrow('resumption_request_changed');
    expect(launch).not.toHaveBeenCalled(); expect(f.store.writes).toBe(writes);
  });
});

describe('direct Cloud history inventory', () => {
  it('records only the exact user-approved terminal snapshot without claiming the results were consumed', async () => {
    const f = fixture(), before = structuredClone(f.store.state.tasks);
    const saved = historical.map(({ id, status, attempt_total, updated_at }) => ({ id, status, attempt_total, updated_at }));
    const cutoff = { count: saved.length, fingerprint: createHash('sha256').update(JSON.stringify(saved)).digest('hex'), approval: '사용자가 이전 이력 제외 승인' };
    const approved = { ...config, direct_history_cutoff: cutoff }, nextConfig = { ...later, direct_history_cutoff: cutoff };
    f.store.validationConfig = approved; f.list.mockResolvedValue(historical);
    await expect(installDirectInventory({ api: f.api, store: f.store, config: approved, list: f.list })).resolves.toEqual({ state: 'installed', count: 2 });
    expect(f.store.state.tasks).toEqual(before);
    expect(f.store.state.direct_inventory).toMatchObject({ schema: 2, fingerprint: cutoff.fingerprint, tasks: saved });
    const state = nextState(f.store.state, nextConfig), verify = createDirectHistoryVerifier({ api: f.api, config: nextConfig, list: f.list });
    await expect(verify({ task: state.tasks[1], state })).resolves.toBe(true);
    f.list.mockResolvedValueOnce([...historical, { ...historical[0]!, id: 'task_other' }]);
    await expect(verify({ task: state.tasks[1], state })).rejects.toThrow('cloud_history_changed');
  });
  it('refuses a changed approved cutoff, running work, or a changed main without writing', async () => {
    const f = fixture(), cutoff = { count: 2, fingerprint: 'd'.repeat(64), approval: '사용자 승인' }, approved = { ...config, direct_history_cutoff: cutoff };
    f.store.validationConfig = approved; f.list.mockResolvedValue(historical);
    await expect(installDirectInventory({ api: f.api, store: f.store, config: approved, list: f.list })).rejects.toThrow('cloud_cutoff_mismatch');
    f.list.mockResolvedValue([{ ...historical[0]!, status: 'running' }]);
    await expect(installDirectInventory({ api: f.api, store: f.store, config: approved, list: f.list })).rejects.toThrow('unsettled_cloud_history');
    await expect(installDirectInventory({ api: f.api, store: f.store, config: approved, list: f.list, expectedMain: sha('2') })).rejects.toThrow('trusted_main_moved');
    expect(f.store.writes).toBe(0);
  });
  it('rejects a cutoff that was altered after it was recorded', async () => {
    const f = fixture(), saved = historical.map(({ id, status, attempt_total, updated_at }) => ({ id, status, attempt_total, updated_at }));
    const cutoff = { count: saved.length, fingerprint: createHash('sha256').update(JSON.stringify(saved)).digest('hex'), approval: '사용자 승인' };
    const approved = { ...config, direct_history_cutoff: cutoff };
    f.store.validationConfig = approved; f.list.mockResolvedValue(historical);
    await installDirectInventory({ api: f.api, store: f.store, config: approved, list: f.list });
    f.store.state.direct_inventory!.tasks[0]!.status = 'error';
    expect(() => parseLoopState(f.store.state, approved)).toThrow('invalid_direct_inventory');
  });
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

describe('verified direct history continuation', () => {
  function continuation() {
    const f = fixture(), baseState = fixture().store.state;
    baseState.direct_inventory = { schema: 1, queue_ids: ['old'], tasks: [] };
    const state = nextState(baseState), prior = state.tasks[1]!;
    const oldRequest = structuredClone(prior.request!) as Record<string, unknown>, oldDelivery = structuredClone(prior.delivery!) as Record<string, unknown>;
    oldDelivery.attempted = true;
    Object.assign(prior, { phase: 'completed', merged: sha('6'), head: sha('5'), direct_history: [{ request: oldRequest, delivery: oldDelivery,
      direct_cloud: { request_key: key, environment: 'env_1', branch: 'work/next', phase: 'sent', task_id: 'task_prior' },
      applied: { parent: sha('3'), sha: sha('4'), cloud_task_id: 'task_prior' } }] });
    const three = { ...later, tasks: [...later.tasks, definition('third', 82)] }, expanded = appendApprovedTasks(state, three);
    Object.assign(expanded.tasks[2]!, { phase: 'development', request: { ...oldRequest, pr_number: 82, request_key: 'c'.repeat(64) }, delivery: { ...oldDelivery, attempted: false } });
    const priorBlob = 'before\n', resultBlob = 'after\n';
    const blobHash = (v: string) => createHash('sha1').update(`blob ${Buffer.byteLength(v)}\0${v}`).digest('hex');
    const tree = (value: string) => ({ truncated: false, tree: [{ path: 'src/a.ts', type: 'blob', mode: '100644', sha: blobHash(value) }] });
    const patch = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-before\n+after\n';
    const list = vi.fn(async () => [{ id: 'task_prior', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 1, updated_at: '2026-10-28T01:00:00Z' }]);
    const diff = vi.fn(async () => patch);
    const api = { async request(method: string, path: string): Promise<unknown> {
      if (path === '/pulls/81') return { merged: true, merge_commit_sha: sha('6'), head: { sha: sha('5') }, base: { ref: 'main', repo: { full_name: repo } } };
      if (path === `/compare/${sha('4')}...${sha('5')}`) return { status: 'ahead', base_commit: { sha: sha('4') }, merge_base_commit: { sha: sha('4') } };
      if (path === `/git/commits/${sha('3')}`) return { sha: sha('3'), tree: { sha: sha('7') } };
      if (path === `/git/commits/${sha('4')}`) return { sha: sha('4'), tree: { sha: sha('8') }, parents: [{ sha: sha('3') }] };
      if (path === `/git/trees/${sha('7')}?recursive=1`) return tree(priorBlob);
      if (path === `/git/trees/${sha('8')}?recursive=1`) return tree(resultBlob);
      if (path === `/git/blobs/${blobHash(priorBlob)}`) return { encoding: 'base64', size: Buffer.byteLength(priorBlob), content: Buffer.from(priorBlob).toString('base64') };
      if (path.startsWith('/issues/82/comments')) return [];
      return f.api.request(method, path);
    } };
    const verify = createDirectHistoryVerifier({ api, config: three, list, diff });
    return { expanded, verify, list, diff, api };
  }
  it('allows a subsequent task only after the recorded Cloud diff matches its applied commit and merged PR', async () => {
    const f = continuation();
    await expect(f.verify({ task: f.expanded.tasks[2], state: f.expanded })).resolves.toBe(true);
    expect(f.list).toHaveBeenCalledTimes(2); expect(f.diff).toHaveBeenCalledWith('task_prior');
  });
  it('holds if the old diff changes or the Cloud task is not uniquely settled', async () => {
    const f = continuation(); f.diff.mockResolvedValueOnce('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-before\n+different\n');
    await expect(f.verify({ task: f.expanded.tasks[2], state: f.expanded })).rejects.toThrow('direct_history_unverified');
    f.list.mockResolvedValueOnce([{ id: 'task_prior', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 2, updated_at: '2026-10-28T01:00:00Z' }]);
    await expect(f.verify({ task: f.expanded.tasks[2], state: f.expanded })).rejects.toThrow('direct_history_unverified');
  });
  it('holds when a new task appears between the two snapshots', async () => {
    const f = continuation();
    f.list.mockResolvedValueOnce([{ id: 'task_prior', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 1, updated_at: '2026-10-28T01:00:00Z' }])
      .mockResolvedValueOnce([{ id: 'task_other', status: 'ready', known_status: true, environment_id: 'env_1', attempt_total: 1, updated_at: '2026-10-28T01:00:00Z' }]);
    await expect(f.verify({ task: f.expanded.tasks[2], state: f.expanded })).rejects.toThrow('cloud_history_changed');
  });
  it('rejects a conflicting Cloud environment and a PR that is not merged', async () => {
    const f = continuation();
    f.list.mockResolvedValueOnce([{ id: 'task_prior', status: 'ready', known_status: true, environment_id: 'other', attempt_total: 1, updated_at: '2026-10-28T01:00:00Z' }]);
    await expect(f.verify({ task: f.expanded.tasks[2], state: f.expanded })).rejects.toThrow('direct_history_unverified');
    const original = f.api.request;
    f.api.request = async (method, path) => path === '/pulls/81' ? { merged: false } : original(method, path);
    await expect(f.verify({ task: f.expanded.tasks[2], state: f.expanded })).rejects.toThrow('direct_history_unverified');
  });
  it('rejects a result commit that is absent from the reviewed head history', async () => {
    const f = continuation(), original = f.api.request;
    f.api.request = async (method, path) => path.startsWith('/compare/') ? { status: 'diverged', base_commit: { sha: sha('4') }, merge_base_commit: { sha: sha('3') } } : original(method, path);
    await expect(f.verify({ task: f.expanded.tasks[2], state: f.expanded })).rejects.toThrow('direct_history_unverified');
  });
});

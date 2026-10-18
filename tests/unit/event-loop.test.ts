import { describe, expect, it } from 'vitest';
import policy from '../../.github/review-policy.json';
import { advanceTask, planWakeup, type Context, type TaskState, type WakeEvent, type WorkerResult } from '../../scripts/review/event-loop';

const state = (): TaskState => ({ taskId: 'synthetic-task', repository: policy.repository, author: 'silverThunder09',
  baseRef: 'main', fork: false, head: 'a'.repeat(40), base: 'b'.repeat(40), revision: 0,
  phase: 'queued', fixCycles: 0, wakeKeys: [] });
const context = (s: TaskState): Context => ({ expectedRevision: s.revision, scopeApproved: true,
  protectedChange: false, protectedApproved: false, blocked: false, prsThisRun: 0 });
const event = (): WakeEvent => ({ repository: policy.repository, taskId: 'synthetic-task', kind: 'ci_finished', key: 'run:10:attempt:1' });
const result = (s: TaskState, kind: WorkerResult['kind']): WorkerResult => ({ taskId: s.taskId,
  revision: s.revision, head: s.head, base: s.base, kind });

describe('offline event loop planner', () => {
  it('only completes after implementation, CI, review, merge, main CI and records acknowledgements', () => {
    let s = state();
    const phases = ['implementing', 'waiting_ci', 'reviewing', 'merge_ready', 'waiting_main_ci', 'recording', 'completed'];
    const kinds: WorkerResult['kind'][] = ['started', 'implemented', 'ci_verified', 'review_verified', 'merge_verified', 'main_ci_verified', 'record_verified'];
    kinds.forEach((kind, i) => { s = advanceTask(s, result(s, kind), context(s), policy).state; expect(s.phase).toBe(phases[i]); });
    expect(planWakeup(s, event(), context(s), policy).reason).toBe('terminal');
  });
  it('public CI events cannot attest success or advance a task', () => {
    const s = { ...state(), phase: 'waiting_ci' as const };
    const spoofed = Object.assign(event(), { success: true, scopeApproved: true, kindOfResult: 'record_verified' });
    const decision = planWakeup(s, spoofed, context(s), policy);
    expect(decision.action).toBe('inspect'); expect(decision.state.phase).toBe('waiting_ci');
    expect(s.wakeKeys).toEqual([]); expect(s.revision).toBe(0);
  });
  it('deduplicates semantic run identities while accepting a new attempt', () => {
    const first = planWakeup(state(), event(), context(state()), policy).state;
    expect(planWakeup(first, event(), context(first), policy).reason).toBe('duplicate_event');
    expect(planWakeup(first, { ...event(), key: 'run:10:attempt:2' }, context(first), policy).action).toBe('inspect');
  });
  it('rejects another repo/task and unsupported event without changing state', () => {
    const s = state();
    for (const e of [{ ...event(), repository: 'other/repo' }, { ...event(), taskId: 'other' },
      { ...event(), kind: 'issue_comment' } as unknown as WakeEvent]) {
      expect(planWakeup(s, e, context(s), policy).state).toBe(s);
    }
  });
  it.each(['fork', 'author', 'baseRef', 'repository'] as const)('pauses out-of-policy %s', key => {
    const s = state(); Object.assign(s, { [key]: key === 'fork' ? true : 'other' });
    expect(advanceTask(s, result(s, 'started'), context(s), policy).action).toBe('pause');
  });
  it.each(['approval', 'protected', 'blocked', 'pr limit'] as const)('pauses for %s', cause => {
    const s = state(), c = context(s);
    if (cause === 'approval') c.scopeApproved = false;
    if (cause === 'protected') c.protectedChange = true;
    if (cause === 'blocked') c.blocked = true;
    if (cause === 'pr limit') c.prsThisRun = policy.max_prs_per_run + 1;
    expect(advanceTask(s, result(s, 'started'), c, policy).action).toBe('pause');
  });
  it('rejects stale worker completion and concurrent stale state revision', () => {
    const s = state(), r = result(s, 'started');
    expect(advanceTask(s, { ...r, revision: 1 }, context(s), policy).reason).toBe('revision_conflict');
    expect(advanceTask(s, r, { ...context(s), expectedRevision: 1 }, policy).state).toBe(s);
  });
  it.each(['head', 'base'] as const)('invalidates merge readiness when %s changes', key => {
    const s = { ...state(), phase: 'merge_ready' as const };
    expect(advanceTask(s, { ...result(s, 'merge_verified'), [key]: 'c'.repeat(40) }, context(s), policy).reason).toBe('revision_changed');
  });
  it('cannot skip CI/review or complete after merge without main CI and record verification', () => {
    for (const phase of ['queued', 'waiting_ci', 'waiting_main_ci'] as const) {
      const s = { ...state(), phase };
      expect(advanceTask(s, result(s, 'record_verified'), context(s), policy).reason).toBe('out_of_order');
    }
  });
  it('pauses at the third failed inspection and never resumes from a public event', () => {
    let s: TaskState = { ...state(), phase: 'reviewing' };
    for (let n = 0; n < policy.max_fix_cycles; n++) {
      s = advanceTask(s, result(s, 'fix_required'), context(s), policy).state;
      if (s.phase !== 'paused') s = { ...s, phase: 'reviewing' };
    }
    expect(s.phase).toBe('paused'); expect(s.fixCycles).toBe(3);
    expect(planWakeup(s, event(), context(s), policy).action).toBe('none');
  });
  it('does not mutate a terminal result when later context is blocked', () => {
    const s = { ...state(), phase: 'completed' as const };
    expect(planWakeup(s, event(), { ...context(s), blocked: true }, policy).state).toBe(s);
    expect(advanceTask(s, result(s, 'blocked'), context(s), policy).state).toBe(s);
  });
  it('refuses a corrupted active checkpoint already at its failure limit', () => {
    const s = { ...state(), fixCycles: policy.max_fix_cycles };
    expect(advanceTask(s, result(s, 'started'), context(s), policy).reason).toBe('limit_reached');
  });
  it('preserves replay protection by pausing rather than evicting a full ledger', () => {
    const s = { ...state(), wakeKeys: Array.from({ length: 256 }, (_, i) => `run:${i}`) };
    expect(planWakeup(s, event(), context(s), policy).reason).toBe('ledger_full');
  });
});

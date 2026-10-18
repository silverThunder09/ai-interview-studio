/** Offline planning only. No webhook server, queue, credentials, AI or GitHub writes. */
export type Phase = 'queued' | 'implementing' | 'waiting_ci' | 'reviewing' | 'merge_ready'
  | 'waiting_main_ci' | 'recording' | 'completed' | 'paused';

export interface LoopPolicy {
  repository: string;
  base_branch: string;
  allowed_authors: string[];
  max_fix_cycles: number;
  max_prs_per_run: number;
}

export interface TaskState {
  taskId: string;
  repository: string;
  author: string;
  baseRef: string;
  fork: boolean;
  head: string;
  base: string;
  revision: number;
  phase: Phase;
  fixCycles: number;
  wakeKeys: string[];
}

/** These values must come from a trusted adapter's fresh queries, never event text. */
export interface Context {
  expectedRevision: number;
  scopeApproved: boolean;
  protectedChange: boolean;
  protectedApproved: boolean;
  blocked: boolean;
  prsThisRun: number;
}

export interface WakeEvent {
  repository: string;
  taskId: string;
  kind: 'task_requested' | 'pr_changed' | 'ci_finished' | 'review_submitted' | 'main_ci_finished';
  /** Semantic identity: e.g. workflow/run/attempt, review/id, PR/head/base. */
  key: string;
}

/** Private worker acknowledgements, not public GitHub event payloads. */
export interface WorkerResult {
  taskId: string;
  revision: number;
  head: string;
  base: string;
  kind: 'started' | 'implemented' | 'ci_verified' | 'review_verified' | 'merge_verified'
    | 'main_ci_verified' | 'record_verified' | 'fix_required' | 'blocked';
}

export interface Decision {
  state: TaskState;
  action: 'none' | 'inspect' | 'pause' | 'continue';
  reason: string;
}

const SHA = /^[0-9a-f]{40}$/;
const PHASES: Phase[] = ['queued', 'implementing', 'waiting_ci', 'reviewing', 'merge_ready',
  'waiting_main_ci', 'recording', 'completed', 'paused'];
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;

function guard(state: TaskState, context: Context, policy: LoopPolicy): string | undefined {
  if (state.repository !== policy.repository || state.baseRef !== policy.base_branch
    || !policy.allowed_authors.includes(state.author) || state.fork !== false) return 'outside_policy';
  if (!state.taskId || !SHA.test(state.head) || !SHA.test(state.base)
    || !integer(state.revision) || !integer(state.fixCycles) || !PHASES.includes(state.phase)
    || !integer(context.prsThisRun) || !integer(policy.max_fix_cycles)
    || !integer(policy.max_prs_per_run) || policy.max_prs_per_run < 1
    || !Array.isArray(state.wakeKeys) || state.wakeKeys.some(k => typeof k !== 'string' || !k)) return 'invalid_state';
  if (context.expectedRevision !== state.revision) return 'revision_conflict';
  if (context.scopeApproved !== true || context.blocked !== false
    || (context.protectedChange !== false && context.protectedApproved !== true)) return 'needs_user';
  // Existing PR work can continue at the per-run limit; creation must check before writing.
  if (context.prsThisRun > policy.max_prs_per_run || state.fixCycles >= policy.max_fix_cycles) return 'limit_reached';
  return undefined;
}

function unchanged(state: TaskState, reason: string): Decision {
  return { state, action: 'none', reason };
}

function denied(state: TaskState, reason: string): Decision {
  if (reason === 'revision_conflict') return unchanged(state, reason);
  if (state.phase === 'paused') return unchanged(state, reason);
  return { state: { ...state, phase: 'paused', revision: state.revision + 1 }, action: 'pause', reason };
}

/** Public events only request inspection. They can never attest CI, approval or completion. */
export function planWakeup(state: TaskState, event: WakeEvent, context: Context, policy: LoopPolicy): Decision {
  if (event.repository !== state.repository || event.taskId !== state.taskId) return unchanged(state, 'unrelated_event');
  if (state.phase === 'completed' || state.phase === 'paused') return unchanged(state, 'terminal');
  const error = guard(state, context, policy);
  if (error) return denied(state, error);
  if (!['task_requested', 'pr_changed', 'ci_finished', 'review_submitted', 'main_ci_finished'].includes(event.kind)
    || typeof event.key !== 'string' || !event.key || event.key.length > 256) return unchanged(state, 'unsupported_event');
  if (state.wakeKeys.includes(event.key)) return unchanged(state, 'duplicate_event');
  // Do not evict old identities and silently allow their replay. Future persistence must compact safely.
  if (state.wakeKeys.length >= 256) return denied(state, 'ledger_full');
  return { state: { ...state, revision: state.revision + 1, wakeKeys: [...state.wakeKeys, event.key] },
    action: 'inspect', reason: event.kind };
}

const NEXT: Partial<Record<WorkerResult['kind'], { from: Phase; to: Phase }>> = {
  started: { from: 'queued', to: 'implementing' },
  implemented: { from: 'implementing', to: 'waiting_ci' },
  ci_verified: { from: 'waiting_ci', to: 'reviewing' },
  review_verified: { from: 'reviewing', to: 'merge_ready' },
  merge_verified: { from: 'merge_ready', to: 'waiting_main_ci' },
  main_ci_verified: { from: 'waiting_main_ci', to: 'recording' },
  record_verified: { from: 'recording', to: 'completed' },
};

export function advanceTask(state: TaskState, result: WorkerResult, context: Context, policy: LoopPolicy): Decision {
  if (result.taskId !== state.taskId) return unchanged(state, 'unrelated_result');
  if (state.phase === 'completed' || state.phase === 'paused') return unchanged(state, 'terminal');
  const error = guard(state, context, policy);
  if (error) return denied(state, error);
  if (result.revision !== state.revision) return unchanged(state, 'revision_conflict');
  if (!SHA.test(result.head) || !SHA.test(result.base)) return denied(state, 'invalid_revision');
  // A changed head/base invalidates every old review, CI and merge-ready acknowledgement.
  // After merge, main advances independently; the adapter must reconcile rather than retry implementation.
  if (result.head !== state.head || result.base !== state.base) return denied(state, 'revision_changed');
  if (result.kind === 'blocked') return denied(state, 'worker_blocked');
  if (result.kind === 'fix_required') {
    if (!['waiting_ci', 'reviewing'].includes(state.phase)) return unchanged(state, 'out_of_order');
    const fixCycles = state.fixCycles + 1;
    if (fixCycles >= policy.max_fix_cycles) return denied({ ...state, fixCycles }, 'fix_limit');
    return { state: { ...state, phase: 'implementing', fixCycles, revision: state.revision + 1 },
      action: 'continue', reason: 'repair' };
  }
  const next = NEXT[result.kind];
  if (!next || next.from !== state.phase) return unchanged(state, 'out_of_order');
  return { state: { ...state, phase: next.to, revision: state.revision + 1 },
    action: next.to === 'completed' || next.to === 'waiting_ci' || next.to === 'waiting_main_ci' ? 'none' : 'continue',
    reason: next.to };
}

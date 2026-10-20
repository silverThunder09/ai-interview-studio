/** Inactive v2 storage boundary. Callers supply authenticated tools; no credentials or automatic dispatch. */
const REPO = 'silverThunder09/ai-interview-studio';
export const V2_BRANCH = 'automation/development-v2';
export const V2_PATH = '.automation/development-v2.json';
const HASH = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/;
type Phase = 'prepared' | 'sending' | 'dispatched' | 'reported';
export interface OutboxIdentity { key: string; pr: number; head: string; base: string; body_hash: string }
export interface Outbox extends OutboxIdentity { phase: Phase; comment_id: number | null; receipt_id: number | null }
export interface Journal {
  schema: 2; repository: string; revision: number; epoch: string;
  lease: { owner: string; until: number } | null; outbox: Outbox[];
}
function ensure(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
function obj(value: unknown): Record<string, unknown> {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'invalid_journal_object'); return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, names: string[]) {
  ensure(Object.keys(value).length === names.length && names.every(n => Object.hasOwn(value, n)), 'invalid_journal_fields');
}
function natural(value: unknown, min = 0): value is number { return Number.isSafeInteger(value) && Number(value) >= min; }
function hash(value: unknown): value is string { return typeof value === 'string' && HASH.test(value); }
function sha(value: unknown): value is string { return typeof value === 'string' && SHA.test(value); }
function identity(value: unknown): OutboxIdentity {
  const v = obj(value);
  ensure(hash(v.key) && hash(v.body_hash) && sha(v.head) && sha(v.base) && natural(v.pr, 1), 'invalid_outbox_identity');
  return v as unknown as OutboxIdentity;
}
export function parseJournal(value: unknown): Journal {
  const v = obj(value); exact(v, ['schema', 'repository', 'revision', 'epoch', 'lease', 'outbox']);
  ensure(v.schema === 2 && v.repository === REPO && natural(v.revision) && hash(v.epoch), 'invalid_journal_identity');
  if (v.lease !== null) { const l = obj(v.lease); exact(l, ['owner', 'until']); ensure(hash(l.owner) && natural(l.until, 1), 'invalid_lease'); }
  ensure(Array.isArray(v.outbox) && v.outbox.length <= 256, 'invalid_outbox');
  const keys = new Set(), comments = new Set(), receipts = new Set();
  for (const item of v.outbox) {
    const b = obj(item); exact(b, ['key', 'pr', 'head', 'base', 'body_hash', 'phase', 'comment_id', 'receipt_id']); identity(b);
    ensure(!keys.has(b.key), 'duplicate_outbox_key'); keys.add(b.key);
    ensure(['prepared', 'sending', 'dispatched', 'reported'].includes(String(b.phase)), 'invalid_phase');
    ensure(['prepared', 'sending'].includes(String(b.phase)) ? b.comment_id === null : natural(b.comment_id, 1), 'invalid_send_receipt');
    ensure(b.phase === 'reported' ? natural(b.receipt_id, 1) : b.receipt_id === null, 'invalid_result_receipt');
    if (b.comment_id !== null) { ensure(!comments.has(b.comment_id), 'duplicate_send_receipt'); comments.add(b.comment_id); }
    if (b.receipt_id !== null) { ensure(!receipts.has(b.receipt_id), 'duplicate_result_receipt'); receipts.add(b.receipt_id); }
  }
  // No terminal/next-head decision exists here. A reported result still blocks a new request.
  ensure(v.outbox.length <= 1, 'unfinished_development_request');
  return value as Journal;
}
export function emptyJournal(epoch: string): Journal {
  return parseJournal({ schema: 2, repository: REPO, revision: 0, epoch, lease: null, outbox: [] });
}
function next(value: Journal): Journal { const copy = structuredClone(parseJournal(value)); copy.revision++; return copy; }
function owns(value: Journal, owner: string, now: number) {
  parseJournal(value); ensure(hash(owner) && natural(now) && value.lease?.owner === owner && value.lease.until > now, 'lease_not_owned');
}
export function acquireV2Lease(value: Journal, owner: string, now: number, duration = 600_000): Journal {
  parseJournal(value); ensure(hash(owner) && natural(now) && natural(duration, 1) && duration <= 600_000 && natural(now + duration), 'invalid_lease');
  ensure(!value.lease || value.lease.until <= now || value.lease.owner === owner, 'lease_busy');
  const state = next(value); state.lease = { owner, until: now + duration }; return state;
}
export function prepareV2Request(value: Journal, request: OutboxIdentity, owner: string, now: number): Journal {
  owns(value, owner, now); exact(obj(request), ['key', 'pr', 'head', 'base', 'body_hash']); identity(request);
  const prior = value.outbox.find(b => b.key === request.key);
  if (prior) { ensure(['pr', 'head', 'base', 'body_hash'].every(k => obj(prior)[k] === obj(request)[k]), 'outbox_key_reused'); return value; }
  ensure(value.outbox.length === 0, 'unfinished_development_request');
  const state = next(value); state.outbox.push({ ...request, phase: 'prepared', comment_id: null, receipt_id: null }); return state;
}
export function claimV2Send(value: Journal, key: string, owner: string, now: number): Journal {
  owns(value, owner, now); const state = next(value), box = state.outbox.find(b => b.key === key);
  ensure(box?.phase === 'prepared', 'send_already_claimed_or_missing'); box.phase = 'sending'; return state;
}
export function acknowledgeV2Send(value: Journal, key: string, commentId: number, owner: string, now: number): Journal {
  owns(value, owner, now); ensure(natural(commentId, 1), 'invalid_send_receipt');
  const box = value.outbox.find(b => b.key === key); ensure(box, 'outbox_missing');
  if (box.phase === 'dispatched' || box.phase === 'reported') { ensure(box.comment_id === commentId, 'different_send_receipt'); return value; }
  ensure(box.phase === 'sending', 'send_not_claimed'); const state = next(value); state.outbox[0]!.phase = 'dispatched'; state.outbox[0]!.comment_id = commentId; return state;
}
/** Only after connected-controller validates the full official report; this is storage, never approval. */
export function recordV2Receipt(value: Journal, request: OutboxIdentity, receiptId: number, owner: string, now: number): Journal {
  owns(value, owner, now); identity(request); ensure(natural(receiptId, 1), 'invalid_result_receipt');
  const box = value.outbox.find(b => b.key === request.key);
  ensure(box && ['pr', 'head', 'base', 'body_hash'].every(k => obj(box)[k] === obj(request)[k]), 'wrong_receipt_identity');
  if (box.phase === 'reported') { ensure(box.receipt_id === receiptId, 'different_result_receipt'); return value; }
  ensure(box.phase === 'dispatched', 'request_not_dispatched'); const state = next(value); state.outbox[0]!.phase = 'reported'; state.outbox[0]!.receipt_id = receiptId; return state;
}

/** Maps to connected GitHub ref/tree/commit tools. No token, arbitrary URL or user-supplied repository. */
export interface JournalTransport {
  readRef(repository: string, branch: string): Promise<string>;
  readCommit(repository: string, sha: string): Promise<{ tree_sha: string }>;
  readState(repository: string, path: string, ref: string): Promise<{ mode: string; content: string }>;
  createTree(repository: string, baseTree: string, file: { path: string; mode: '100644'; content: string }): Promise<string>;
  createCommit(repository: string, parent: string, tree: string): Promise<string>;
  updateRef(repository: string, branch: string, expected: string, next: string, force: false): Promise<void>;
}
export interface JournalSnapshot { head: string; tree: string; state: Journal }
export class V2JournalStore {
  readonly transport: JournalTransport;
  constructor(transport: JournalTransport) { this.transport = transport; }
  async load(): Promise<JournalSnapshot> {
    const head = await this.transport.readRef(REPO, V2_BRANCH); ensure(sha(head), 'invalid_journal_ref');
    const commit = await this.transport.readCommit(REPO, head); ensure(sha(commit.tree_sha), 'invalid_journal_tree');
    const file = await this.transport.readState(REPO, V2_PATH, head);
    ensure(file.mode === '100644' && Buffer.byteLength(file.content, 'utf8') <= 128 * 1024, 'invalid_journal_file');
    // Missing branch/file is an error: never silently initialize or reset state.
    return { head, tree: commit.tree_sha, state: parseJournal(JSON.parse(file.content)) };
  }
  async save(previous: JournalSnapshot, value: Journal): Promise<JournalSnapshot> {
    parseJournal(previous.state); parseJournal(value); ensure(sha(previous.head) && sha(previous.tree), 'invalid_snapshot');
    const current = await this.load();
    ensure(current.head === previous.head && current.tree === previous.tree && JSON.stringify(current.state) === JSON.stringify(previous.state), 'journal_cas_conflict');
    if (JSON.stringify(value) === JSON.stringify(previous.state)) return previous;
    ensure(value.epoch === previous.state.epoch && value.revision === previous.state.revision + 1, 'invalid_journal_revision');
    for (const box of value.outbox) if (!previous.state.outbox.some(old => old.key === box.key)) ensure(box.phase === 'prepared', 'new_request_not_prepared');
    for (const old of previous.state.outbox) {
      const b = value.outbox.find(b => b.key === old.key);
      ensure(b && ['pr', 'head', 'base', 'body_hash'].every(k => obj(b)[k] === obj(old)[k]), 'journal_history_changed');
      const phases = ['prepared', 'sending', 'dispatched', 'reported'];
      ensure(phases.indexOf(b.phase) >= phases.indexOf(old.phase) && phases.indexOf(b.phase) <= phases.indexOf(old.phase) + 1 && (old.comment_id === null || b.comment_id === old.comment_id) && (old.receipt_id === null || b.receipt_id === old.receipt_id), 'journal_history_changed');
    }
    const tree = await this.transport.createTree(REPO, previous.tree, { path: V2_PATH, mode: '100644', content: JSON.stringify(value) }); ensure(sha(tree), 'invalid_created_tree');
    const head = await this.transport.createCommit(REPO, previous.head, tree); ensure(sha(head), 'invalid_created_commit');
    // Exact parent + expected ref + force=false: a losing sibling writer fails, never overwrites.
    await this.transport.updateRef(REPO, V2_BRANCH, previous.head, head, false);
    return { head, tree, state: value };
  }
}

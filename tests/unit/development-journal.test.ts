import { describe, expect, it } from 'vitest';
import { acquireV2Lease, acknowledgeV2Send, claimV2Send, emptyJournal, parseJournal, prepareV2Request, recordV2Receipt, V2_BRANCH, V2_PATH, V2JournalStore, type JournalTransport, type OutboxIdentity } from '../../scripts/review/development-journal';

const owner = 'a'.repeat(64), other = 'b'.repeat(64), epoch = 'e'.repeat(64);
const request: OutboxIdentity = { key: 'c'.repeat(64), pr: 55, head: '1'.repeat(40), base: '2'.repeat(40), body_hash: 'd'.repeat(64) };
const leased = () => acquireV2Lease(emptyJournal(epoch), owner, 100, 1000);
const prepared = () => prepareV2Request(leased(), request, owner, 101);
const sending = () => claimV2Send(prepared(), request.key, owner, 102);
const dispatched = () => acknowledgeV2Send(sending(), request.key, 1001, owner, 103);

class MemoryTransport implements JournalTransport {
  head = '1'.repeat(40); tree = '2'.repeat(40); content = JSON.stringify(emptyJournal(epoch)); mode = '100644';
  writes = 0; failRead = false; race = false; counter = 3;
  files = new Map<string, string>(); commits = new Map<string, { parent: string; tree: string }>();
  scope(repo: string) { expect(repo).toBe('silverThunder09/ai-interview-studio'); }
  async readRef(repo: string, branch: string) { this.scope(repo); expect(branch).toBe(V2_BRANCH); if (this.failRead) throw new Error('HTTP 404'); return this.head; }
  async readCommit(repo: string, head: string) { this.scope(repo); expect(head).toBe(this.head); return { tree_sha: this.tree }; }
  async readState(repo: string, path: string, ref: string) { this.scope(repo); expect(path).toBe(V2_PATH); expect(ref).toBe(this.head); return { mode: this.mode, content: this.content }; }
  async createTree(repo: string, base: string, file: { path: string; mode: '100644'; content: string }) {
    this.scope(repo); expect(base).toBe(this.tree); expect(file.path).toBe(V2_PATH); expect(file.mode).toBe('100644');
    this.writes++; const sha = (++this.counter).toString(16).padStart(40, '0'); this.files.set(sha, file.content); return sha;
  }
  async createCommit(repo: string, parent: string, tree: string) {
    this.scope(repo); this.writes++; const sha = (++this.counter).toString(16).padStart(40, '0'); this.commits.set(sha, { parent, tree }); return sha;
  }
  async updateRef(repo: string, branch: string, expected: string, next: string, force: false) {
    this.scope(repo); expect(branch).toBe(V2_BRANCH); expect(force).toBe(false); this.writes++;
    if (this.race) this.head = 'f'.repeat(40);
    if (this.head !== expected) throw new Error('CAS rejected');
    const commit = this.commits.get(next)!; expect(commit.parent).toBe(expected);
    this.head = next; this.tree = commit.tree; this.content = this.files.get(this.tree)!;
  }
}

describe('inactive v2 lease and outbox', () => {
  it('claims a send once and persists separate request/result receipts without granting next work', () => {
    const done = recordV2Receipt(dispatched(), request, 2001, owner, 104);
    expect(done.outbox[0]).toMatchObject({ phase: 'reported', comment_id: 1001, receipt_id: 2001 });
    expect(() => prepareV2Request(done, { ...request, key: other, head: '3'.repeat(40) }, owner, 105)).toThrow('unfinished_development_request');
    expect(() => claimV2Send(done, request.key, owner, 105)).toThrow('send_already_claimed');
    expect(recordV2Receipt(done, request, 2001, owner, 105)).toBe(done);
    expect(acknowledgeV2Send(done, request.key, 1001, owner, 105)).toBe(done);
  });
  it('keeps an identical prepared request idempotent and rejects key/body/checkout reuse', () => {
    const state = prepared(); expect(prepareV2Request(state, request, owner, 102)).toBe(state);
    for (const field of ['body_hash', 'head', 'base', 'pr']) {
      const changed = { ...request, [field]: field === 'pr' ? 56 : field === 'body_hash' ? other : '3'.repeat(40) };
      expect(() => prepareV2Request(state, changed, owner, 102)).toThrow('outbox_key_reused');
    }
  });
  it('does not resend an uncertain sending record after a lease expires or another owner takes over', () => {
    const state = acquireV2Lease(sending(), other, 1200, 100);
    expect(() => claimV2Send(state, request.key, other, 1201)).toThrow('send_already_claimed');
    expect(() => claimV2Send(state, request.key, owner, 1201)).toThrow('lease_not_owned');
  });
  it('rejects a competing live owner, expired lease and excessive lease duration', () => {
    expect(() => acquireV2Lease(leased(), other, 101)).toThrow('lease_busy');
    expect(() => prepareV2Request(leased(), request, owner, 1100)).toThrow('lease_not_owned');
    expect(() => acquireV2Lease(emptyJournal(epoch), owner, 100, 600_001)).toThrow('invalid_lease');
  });
  it('requires a send claim before acknowledgment and a matching dispatched request before a result', () => {
    expect(() => acknowledgeV2Send(prepared(), request.key, 1001, owner, 102)).toThrow('send_not_claimed');
    expect(() => recordV2Receipt(sending(), request, 2001, owner, 103)).toThrow('request_not_dispatched');
    expect(() => recordV2Receipt(dispatched(), { ...request, head: '3'.repeat(40) }, 2001, owner, 104)).toThrow('wrong_receipt_identity');
    expect(() => acknowledgeV2Send(dispatched(), request.key, 1002, owner, 104)).toThrow('different_send_receipt');
    const done = recordV2Receipt(dispatched(), request, 2001, owner, 104);
    expect(() => recordV2Receipt(done, request, 2002, owner, 105)).toThrow('different_result_receipt');
  });
  it.each([
    { ...emptyJournal(epoch), schema: 1 }, { ...emptyJournal(epoch), repository: 'other/repo' },
    { ...emptyJournal(epoch), revision: -1 }, { ...emptyJournal(epoch), enabled: true },
    { ...prepared(), outbox: [{ ...prepared().outbox[0], phase: 'completed' }] },
    { ...prepared(), outbox: [{ ...prepared().outbox[0], comment_id: 3 }] },
    { ...prepared(), outbox: [...prepared().outbox, ...prepared().outbox] },
  ])('rejects malformed state, hidden activation and manufactured terminal state', value => expect(() => parseJournal(value)).toThrow());
});

describe('connected v2 journal persistence', () => {
  it('preserves the current tree/parent and uses expected ref plus force=false', async () => {
    const api = new MemoryTransport(), store = new V2JournalStore(api), before = await store.load();
    const after = await store.save(before, acquireV2Lease(before.state, owner, 100));
    expect(after.head).not.toBe(before.head); expect((await store.load()).state).toEqual(after.state);
    expect(api.writes).toBe(3);
    expect(await store.save(after, after.state)).toBe(after); expect(api.writes).toBe(3);
  });
  it('rejects stale state before writing objects', async () => {
    const api = new MemoryTransport(), store = new V2JournalStore(api), before = await store.load();
    api.head = '3'.repeat(40);
    await expect(store.save(before, acquireV2Lease(before.state, owner, 100))).rejects.toThrow('journal_cas_conflict');
    expect(api.writes).toBe(0);
    await expect(store.save(before, before.state)).rejects.toThrow('journal_cas_conflict');
  });
  it('fails a concurrent sibling update without retry or forced ref write', async () => {
    const api = new MemoryTransport(), store = new V2JournalStore(api), before = await store.load(); api.race = true;
    await expect(store.save(before, acquireV2Lease(before.state, owner, 100))).rejects.toThrow('CAS rejected');
    expect(api.head).toBe('f'.repeat(40)); expect(JSON.parse(api.content).revision).toBe(0);
  });
  it('never initializes/reset a missing branch and rejects symlinks or oversized state', async () => {
    const api = new MemoryTransport(), store = new V2JournalStore(api); api.failRead = true;
    await expect(store.load()).rejects.toThrow('HTTP 404'); expect(api.writes).toBe(0);
    api.failRead = false; api.mode = '120000'; await expect(store.load()).rejects.toThrow('invalid_journal_file');
    api.mode = '100644'; api.content = 'x'.repeat(131_073); await expect(store.load()).rejects.toThrow('invalid_journal_file');
  });
  it('cannot manufacture an already-sent/result request in an empty journal', async () => {
    const api = new MemoryTransport(), store = new V2JournalStore(api), before = await store.load();
    const value = { ...dispatched(), revision: 1 };
    await expect(store.save(before, value)).rejects.toThrow('new_request_not_prepared'); expect(api.writes).toBe(0);
  });
  it('rejects epoch/revision changes, deletion of old requests and receipt rollback', async () => {
    const api = new MemoryTransport(); api.content = JSON.stringify(dispatched()); const store = new V2JournalStore(api), before = await store.load();
    for (const value of [
      { ...before.state, revision: 999 }, { ...before.state, epoch: other, revision: before.state.revision + 1 },
      { ...before.state, revision: before.state.revision + 1, outbox: [] },
      { ...before.state, revision: before.state.revision + 1, outbox: [{ ...before.state.outbox[0]!, phase: 'sending' as const, comment_id: null }] },
    ]) await expect(store.save(before, value)).rejects.toThrow();
    expect(api.writes).toBe(0);
  });
});

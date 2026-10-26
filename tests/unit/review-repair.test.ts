import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { GitHub } from '../../scripts/review/event-worker';
import { startReviewRepair, finishReviewRepair, buildRepairReviewAddition } from '../../scripts/review/review-repair.mjs';

const head = '1'.repeat(40), base = '2'.repeat(40), fixed = '3'.repeat(40), path = 'tests/smoke/gemini.spec.ts';
type Issue = { number: number; body: string; state: string };
function fixture(id = 21) {
  const finding = { id, path, line: 80, severity: 'P1', body: 'Restore the removed failure scenarios.\n<!-- codex-code-review-finding:v1 -->', url: `https://github.com/silverThunder09/ai-interview-studio/pull/95#discussion_r${id}` };
  const report = { head_sha: head, base_sha: base, receipt_id: 11, summary_id: 10, findings: [finding] };
  const task: Record<string, unknown> & { head: string; cycles: number; repairs?: Record<string, unknown>[]; repair_findings?: unknown } = { id: 'approved', pr: 95, head, base, phase: 'review', cycles: 0, request: { request_key: 'a'.repeat(64) }, delivery: { id: 9 }, review: null };
  const issues: Issue[] = [], writes: string[] = [];
  const thread = { id: 'thread21', isResolved: false, isOutdated: true, comments: { nodes: [{ url: finding.url, body: finding.body, author: { login: 'chatgpt-codex-connector', __typename: 'Bot' } }], pageInfo: { hasNextPage: false } } };
  const threadList = [thread];
  let changed = true, race = false;
  const parents = new Map<string, string>();
  const api = {
    request: async (method: string, url: string, data?: Record<string, unknown>): Promise<unknown> => {
      if (method !== 'GET') writes.push(method + ' ' + url);
      if (url.startsWith('/issues?')) return issues;
      if (method === 'POST' && url === '/issues') { const issue = { number: 100 + issues.length, body: String(data!.body), state: 'open' }; issues.push(issue); return issue; }
      if (url.startsWith('/compare/')) throw new Error('comparison API must not be used');
      if (url.startsWith('/git/commits/')) { const sha=url.split('/').pop()!; return { sha, parents:[{sha:parents.get(sha)??head}] }; }
      if (url.startsWith('/commits/')) { const sha=url.split('/').pop()!; return { sha,parents:[{sha:parents.get(sha)??head}],files:changed?[{filename:path,status:'modified'}]:[] }; }
      if (method === 'GET' && url.startsWith('/issues/')) return issues.find(i => url === `/issues/${i.number}`);
      if (method === 'PATCH' && url.startsWith('/issues/')) { issues.find(i => url === `/issues/${i.number}`)!.state = String(data!.state); return null; }
      if (method === 'POST' && url.endsWith('/comments')) return { id: 50 };
      throw Error('unexpected_api');
    },
    graphql: async (query: string) => {
      if (query.startsWith('query')) return { data: { repository: { pullRequest: { reviewThreads: { nodes: threadList, pageInfo: { hasNextPage: false } } } } } };
      writes.push(query);
      if (query.includes('unresolveReviewThread')) { thread.isResolved = false; return {}; }
      thread.isResolved = true;
      if (race) thread.comments.nodes.push({ url: 'human-comment', body: 'human comment', author: { login: 'human', __typename: 'User' } });
      return { data: { resolveReviewThread: { thread: { isResolved: true } } } };
    },
  };
  const update = async (fn: (t: typeof task) => void) => { fn(task); };
  const start = (reviews: unknown[] = []) => startReviewRepair({ api, task, definition: { allowed_paths: [path] }, report, reviews, policy: { max_fix_cycles: 3 }, update });
  const prepareFixed = () => { task.head = fixed; task.applied = { parent: head, sha: fixed }; task.validated_ci = [{}, {}, {}]; };
  const recheck = () => {
    task.request = { request_key: 'b'.repeat(64), mode: 'read-only', head_sha: task.head, base_sha: base };
    const body = 'fresh exact-head review request' + buildRepairReviewAddition(task, task.request as Record<string, unknown>);
    task.delivery = { phase: 'sent', id: 99, body, hash: createHash('sha256').update(body).digest('hex') };
  };
  const finish = () => finishReviewRepair({ api, task, review: { head_sha: fixed, base_sha: base, findings: [] }, update });
  return { task, api, parents, issues, writes, report, thread, threadList, start, finish, prepareFixed, recheck, unchanged: () => { changed = false; }, humanRace: () => { race = true; } };
}
describe('bounded official AI finding repair', () => {
  it('creates a deduplicated issue, preserves the ended request, and queues one repair in the same task', async () => {
    const f = fixture(); await f.start();
    expect(f.task).toMatchObject({ phase: 'queued', cycles: 1, request: null, repair_findings: [{ id: 21, issue: 100 }] });
    expect(f.task.repairs).toMatchObject([{ request: { request_key: 'a'.repeat(64) }, head }]); expect(f.issues).toHaveLength(1);
    f.task.phase = 'review'; await f.start(); expect(f.issues).toHaveLength(1); expect(f.task.cycles).toBe(2);
  });
  it('stops at the existing three-cycle cap or an unapproved file without writes', async () => {
    const f = fixture(); f.task.cycles = 3; await expect(f.start()).rejects.toThrow('repair_limit'); expect(f.writes).toEqual([]);
    f.task.cycles = 0; f.report.findings[0]!.path = '.github/workflows/ci.yml'; await expect(f.start()).rejects.toThrow('unapproved_repair_finding'); expect(f.writes).toEqual([]);
  });
  it('never clears a human change request with a comment and keeps overlarge/P0 findings on hold', async () => {
    const f = fixture();
    await expect(f.start([{ id: 1, user: { login: 'human' }, state: 'CHANGES_REQUESTED' }, { id: 2, user: { login: 'human' }, state: 'COMMENTED' }])).rejects.toThrow('human_changes_block_repair'); expect(f.writes).toEqual([]);
    f.report.findings[0]!.severity = 'P0'; await expect(f.start()).rejects.toThrow('unapproved_repair_finding');
    f.report.findings[0]!.severity = 'P1'; f.report.findings[0]!.body = 'x'.repeat(17000); await expect(f.start()).rejects.toThrow('repair_report_limit'); expect(f.writes).toEqual([]);
  });
  it('does not close issues or resolve a thread before the changed file, new CI and exact-head review are verified', async () => {
    const f = fixture(); await f.start(); await expect(f.finish()).rejects.toThrow('unverified_repair');
    f.prepareFixed(); f.unchanged(); await expect(f.finish()).rejects.toThrow('repair_file_not_changed');
    expect(f.issues[0]!.state).toBe('open'); expect(f.thread.isResolved).toBe(false);
  });
  it('resolves only the proven obsolete bot thread and closes its issue after the verified repair', async () => {
    const f = fixture(); await f.start(); f.prepareFixed(); await f.finish();
    expect(f.thread.isResolved).toBe(true); expect(f.issues[0]!.state).toBe('closed'); expect(f.task.repair_findings).toBeNull(); expect(f.task.repairs![0]).toHaveProperty('verified_head', fixed);
    const count = f.writes.length; await f.finish(); expect(f.writes).toHaveLength(count);
  });
  it('matches the actual 64-bit REST comment ID through its URL without depending on GraphQL Int databaseId', async () => {
    const f = fixture(4369904494); await f.start(); f.prepareFixed(); await f.finish();
    expect(f.thread.isResolved).toBe(true); expect(f.issues[0]!.state).toBe('closed');
  });
  it('uses the real GitHub transport path guard and makes only SHA-addressed commit requests', async () => {
    const f=fixture();await f.start();f.prepareFixed();const original=f.api.request.bind(f.api),paths:string[]=[];
    vi.stubGlobal('fetch',async(url:string,input:RequestInit)=>{const p=new URL(url).pathname.replace('/repos/silverThunder09/ai-interview-studio','');paths.push(p);return new Response(JSON.stringify(await original(input.method!,p,input.body?JSON.parse(String(input.body)):undefined)));});
    const github=new GitHub('synthetic-never-real');f.api.request=github.request.bind(github);
    try{await f.finish();expect(paths).toContain(`/commits/${fixed}`);expect(paths.every(p=>!p.includes('..'))).toBe(true);expect(f.issues[0]!.state).toBe('closed');}finally{vi.unstubAllGlobals();}
  });
  it('reproduces compare rejection before any network call without weakening the existing guard', async () => {
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    try{await expect(new GitHub('synthetic').request('GET',`/compare/${head}...${fixed}`)).rejects.toThrow('Invalid API path');expect(fetcher).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
  });
  it('proves a recorded repair after a normal main merge and preserves older repair commits', async () => {
    const f=fixture();await f.start();f.prepareFixed();const merged='4'.repeat(40);f.task.head=merged;f.parents.set(merged,fixed);
    await finishReviewRepair({api:f.api,task:f.task,review:{head_sha:merged,base_sha:base,findings:[]},update:async(fn:(t:typeof f.task)=>void)=>fn(f.task)});
    expect(f.thread.isResolved).toBe(true);expect(f.issues[0]!.state).toBe('closed');
  });
  it('does not close issues for an unrelated head or a moved apply parent', async () => {
    const f=fixture();await f.start();f.prepareFixed();const unrelated='4'.repeat(40);f.task.head=unrelated;f.parents.set(unrelated,head);
    await expect(finishReviewRepair({api:f.api,task:f.task,review:{head_sha:unrelated,base_sha:base,findings:[]},update:async()=>{}})).rejects.toThrow('repair_ancestry_unproven');expect(f.issues[0]!.state).toBe('open');
    f.task.head=fixed;f.task.applied={parent:base,sha:fixed};await expect(f.finish()).rejects.toThrow('repair_file_not_changed');expect(f.thread.isResolved).toBe(false);
  });
  it('verifies each repair commit across multiple cycles rather than guessing from the latest patch', async () => {
    const f=fixture();await f.start();f.prepareFixed();f.task.repairs![0]!.applied={sha:fixed,parent:head};
    f.report.head_sha=fixed;f.report.findings[0]!.id=22;f.report.findings[0]!.body='Second distinct failure';await f.start();
    const next='4'.repeat(40);f.parents.set(next,fixed);f.task.head=next;f.task.applied={sha:next,parent:fixed};f.task.repairs![1]!.applied={sha:next,parent:fixed};f.task.validated_ci=[{},{},{}];
    await finishReviewRepair({api:f.api,task:f.task,review:{head_sha:next,base_sha:base,findings:[]},update:async(fn:(t:typeof f.task)=>void)=>fn(f.task)});
    expect(f.issues.map(i=>i.state)).toEqual(['closed','closed']);expect(f.task.repairs!.every(r=>r.verified_head===next)).toBe(true);
  });
  it('refuses ambiguous old multi-cycle histories without individual apply journals', async () => {
    const f=fixture();await f.start();f.task.phase='review';await f.start();f.prepareFixed();
    await expect(f.finish()).rejects.toThrow('missing_repair_commit');expect(f.issues[0]!.state).toBe('open');expect(f.thread.isResolved).toBe(false);
  });
  it.each(['human', 'current', 'truncated'])('keeps a %s thread unresolved', async kind => {
    const f = fixture(); await f.start(); f.prepareFixed();
    if (kind === 'human') f.thread.comments.nodes.push({ url: 'human-comment', body: 'human', author: { login: 'human', __typename: 'User' } });
    if (kind === 'current') f.thread.isOutdated = false; if (kind === 'truncated') f.thread.comments.pageInfo.hasNextPage = true;
    await expect(f.finish()).rejects.toThrow('human_or_current_thread_blocks_repair'); expect(f.thread.isResolved).toBe(false); expect(f.issues[0]!.state).toBe('open');
  });
  it('restores unresolved when a human comment arrives during the resolution race', async () => {
    const f = fixture(); await f.start(); f.prepareFixed(); f.humanRace();
    await expect(f.finish()).rejects.toThrow('repair_thread_changed'); expect(f.thread.isResolved).toBe(false); expect(f.issues[0]!.state).toBe('open');
  });
  it('resolves a historical bot finding still attached to current lines only after an explicit new-head recheck', async () => {
    const f = fixture(); await f.start(); f.prepareFixed(); f.thread.isOutdated = false; f.recheck();
    expect(JSON.parse((f.task.delivery as { body: string }).body.split('\n').at(-1)!)[0]).toMatchObject(f.report.findings[0]!);
    await f.finish(); expect(f.thread.isResolved).toBe(true); expect(f.issues[0]!.state).toBe('closed');
  });
  it.each(['head', 'base', 'mode', 'key', 'hash', 'unsent', 'receipt', 'finding', 'same-head', 'extra-bot', 'spoofed-user', 'truncated', 'unbound-marker'])(
    'keeps a current thread blocked when explicit recheck evidence is invalid: %s', async kind => {
      const f = fixture(); await f.start(); f.prepareFixed(); f.thread.isOutdated = false; f.recheck();
      const request = f.task.request as Record<string, unknown>, delivery = f.task.delivery as Record<string, unknown>;
      if (kind === 'head') request.head_sha = head;
      if (kind === 'base') request.base_sha = head;
      if (kind === 'mode') request.mode = 'code-edit';
      if (kind === 'key') request.request_key = 'c'.repeat(64);
      if (kind === 'hash') delivery.hash = '0'.repeat(64);
      if (kind === 'unsent') delivery.phase = 'sending';
      if (kind === 'receipt') delivery.id = null;
      if (kind === 'finding') f.thread.comments.nodes[0]!.body += '\nnew unresolved detail';
      if (kind === 'same-head') { f.task.repairs![0]!.head = fixed; f.recheck(); }
      if (kind === 'extra-bot') f.thread.comments.nodes.push({ ...f.thread.comments.nodes[0]!, url: 'untracked-bot-comment' });
      if (kind === 'spoofed-user') f.thread.comments.nodes[0]!.author.__typename = 'User';
      if (kind === 'truncated') f.thread.comments.pageInfo.hasNextPage = true;
      if (kind === 'unbound-marker') { delivery.body = 'unrelated review\n<!-- ais-repair-recheck -->'; delivery.hash = createHash('sha256').update(String(delivery.body)).digest('hex'); }
      const before = f.writes.length;
      await expect(f.finish()).rejects.toThrow('human_or_current_thread_blocks_repair');
      expect(f.thread.isResolved).toBe(false); expect(f.issues[0]!.state).toBe('open'); expect(f.writes).toHaveLength(before);
    });
  it('restores an explicitly rechecked current thread when a human comment races with resolve', async () => {
    const f = fixture(); await f.start(); f.prepareFixed(); f.thread.isOutdated = false; f.recheck(); f.humanRace();
    await expect(f.finish()).rejects.toThrow('repair_thread_changed');
    expect(f.thread.isResolved).toBe(false); expect(f.issues[0]!.state).toBe('open');
  });
  it('does not spend another review request on already verified repairs and bounds recheck data', async () => {
    const f = fixture(); expect(buildRepairReviewAddition(f.task, { request_key: 'b'.repeat(64) })).toBe('');
    await f.start(); f.task.repairs![0]!.verified_head = fixed;
    expect(buildRepairReviewAddition(f.task, { request_key: 'b'.repeat(64) })).toBe('');
    delete f.task.repairs![0]!.verified_head; (f.task.repairs![0]!.issues as { body: string }[])[0]!.body = 'x'.repeat(49 * 1024);
    expect(() => f.recheck()).toThrow('repair_recheck_limit');
  });
  it('preflights every tracked thread before resolving an earlier eligible one', async () => {
    const f = fixture(); await f.start(); f.prepareFixed();
    const other = { ...f.report.findings[0]!, id: 22, url: f.report.findings[0]!.url + '-other' };
    (f.task.repairs![0]!.issues as unknown[]).push(other);
    f.threadList.push({ ...f.thread, id: 'thread22', isOutdated: false, comments: { nodes: [{ ...f.thread.comments.nodes[0]!, url: other.url }], pageInfo: { hasNextPage: false } } });
    const before = f.writes.length;
    await expect(f.finish()).rejects.toThrow('human_or_current_thread_blocks_repair');
    expect(f.threadList.every(t => !t.isResolved)).toBe(true); expect(f.writes).toHaveLength(before);
  });
  it.each(['ci', 'finding', 'head'])('does not resolve a rechecked thread with invalid final verification: %s', async kind => {
    const f = fixture(); await f.start(); f.prepareFixed(); f.thread.isOutdated = false; f.recheck();
    if (kind === 'ci') f.task.validated_ci = [{}, {}];
    const before = f.writes.length;
    await expect(finishReviewRepair({ api: f.api, task: f.task, review: { head_sha: kind === 'head' ? head : fixed, base_sha: base, findings: kind === 'finding' ? ['still broken'] : [] }, update: async () => {} })).rejects.toThrow('unverified_repair');
    expect(f.thread.isResolved).toBe(false); expect(f.writes).toHaveLength(before);
  });
});

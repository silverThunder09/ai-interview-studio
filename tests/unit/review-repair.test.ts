import { describe, expect, it } from 'vitest';
import { startReviewRepair, finishReviewRepair } from '../../scripts/review/review-repair.mjs';

const head = '1'.repeat(40), base = '2'.repeat(40), fixed = '3'.repeat(40), path = 'tests/smoke/gemini.spec.ts';
type Issue = { number: number; body: string; state: string };
function fixture(id = 21) {
  const finding = { id, path, line: 80, severity: 'P1', body: 'Restore the removed failure scenarios.\n<!-- codex-code-review-finding:v1 -->', url: `https://github.com/silverThunder09/ai-interview-studio/pull/95#discussion_r${id}` };
  const report = { head_sha: head, base_sha: base, receipt_id: 11, summary_id: 10, findings: [finding] };
  const task: Record<string, unknown> & { head: string; cycles: number; repairs?: Record<string, unknown>[]; repair_findings?: unknown } = { id: 'approved', pr: 95, head, base, phase: 'review', cycles: 0, request: { request_key: 'a'.repeat(64) }, delivery: { id: 9 }, review: null };
  const issues: Issue[] = [], writes: string[] = [];
  const thread = { id: 'thread21', isResolved: false, isOutdated: true, comments: { nodes: [{ url: finding.url, body: finding.body, author: { login: 'chatgpt-codex-connector', __typename: 'Bot' } }], pageInfo: { hasNextPage: false } } };
  let changed = true, race = false;
  const api = {
    request: async (method: string, url: string, data?: Record<string, unknown>) => {
      if (method !== 'GET') writes.push(method + ' ' + url);
      if (url.startsWith('/issues?')) return issues;
      if (method === 'POST' && url === '/issues') { const issue = { number: 100 + issues.length, body: String(data!.body), state: 'open' }; issues.push(issue); return issue; }
      if (url.startsWith('/compare/')) return { files: changed ? [{ filename: path, status: 'modified' }] : [] };
      if (method === 'GET' && url.startsWith('/issues/')) return issues.find(i => url === `/issues/${i.number}`);
      if (method === 'PATCH' && url.startsWith('/issues/')) { issues.find(i => url === `/issues/${i.number}`)!.state = String(data!.state); return null; }
      if (method === 'POST' && url.endsWith('/comments')) return { id: 50 };
      throw Error('unexpected_api');
    },
    graphql: async (query: string) => {
      if (query.startsWith('query')) return { data: { repository: { pullRequest: { reviewThreads: { nodes: [thread], pageInfo: { hasNextPage: false } } } } } };
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
  const finish = () => finishReviewRepair({ api, task, review: { head_sha: fixed, base_sha: base, findings: [] }, update });
  return { task, issues, writes, report, thread, start, finish, prepareFixed, unchanged: () => { changed = false; }, humanRace: () => { race = true; } };
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
});

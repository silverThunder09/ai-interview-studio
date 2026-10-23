import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gatherMergeEvidence, acceptsLoopWakeup, isCurrentMergeCheckout, emptyLoopState, parseLoopConfig, parseLoopState, parseReviewResult, buildReviewRequest, renderLoopReview, renderLoopPRBody, runLoop, LoopStore, type LoopState } from '../../scripts/review/loop-coordinator.mjs';
import { readFileSync } from 'node:fs';
import { GitHub } from '../../scripts/review/event-worker';

const repository = 'silverThunder09/ai-interview-studio', head = '1'.repeat(40), base = '2'.repeat(40), checkout = '3'.repeat(40), merged = '4'.repeat(40);
const config = { schema: 1, repository, enabled: true, tasks: [56, 57].map((pr, i) => ({ id: `probe-${i}`, pr, goal: '합성 실패 경계 검증 테스트를 추가합니다.', approval: '사용자가 승인한 검증 범위', allowed_paths: ['tests/unit/probe.test.ts'] })) };
const policy = JSON.parse(readFileSync('.github/review-policy.json', 'utf8'));
const blob = createHash('sha1').update('blob 5\0test\n').digest('hex');
function reviewRequest(pr = 56) { return { schema: 2, repository, pr_number: pr, request_key: 'a'.repeat(64), head_sha: head, base_sha: base, requested_at: '2026-10-20T10:00:00.000Z', mode: 'read-only', allowed_paths: [] }; }
function resultComment(request: ReturnType<typeof reviewRequest>, review: boolean, id: number) {
  const report = review ? { schema: 1, repository, pr_number: request.pr_number, request_key: request.request_key, head_sha: request.head_sha, base_sha: request.base_sha, findings: [] } : { schema: 2, kind: 'development-result', repository, pr_number: request.pr_number, request_key: request.request_key, checkout_sha: request.head_sha, requested_base_sha: request.base_sha, outcome: 'succeeded', tests: [{ command: 'npm run check', exit_code: 0 }], change: { kind: 'none' }, blocker: null };
  return { id, user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' }, html_url: `https://github.com/${repository}/pull/${request.pr_number}#issuecomment-${id}`, created_at: request.requested_at, body: `<!-- ${review ? 'ais-code-review-result' : 'ais-development-result-v2'}:${request.request_key} -->\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n\n [View task →](https://chatgpt.com/s/cd_${'b'.repeat(32)} )`.replace(' )', ')') };
}
function nativeResultComments() {
  const state = { code_review: { commit_sha: head, has_any_findings: false, has_unresolved_findings: false, status: 'completed' }, security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null } };
  const comment = (id: number, body: string) => ({ id, user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' }, html_url: `https://github.com/${repository}/pull/56#issuecomment-${id}`, created_at: '2026-10-20T10:00:01Z', updated_at: '2026-10-20T10:00:03Z', body });
  return [comment(11, `<!-- codex-review-receipt:v1 -->\n\n**Reviewed commit:** \`${head.slice(0, 10)}\``), comment(12, `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->\n| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-20T10:00:02Z">done</relative-time> |`)];
}
class MemoryStore {
  state: LoopState; revision = 0;
  constructor() { this.state = emptyLoopState(config); this.state.bootstrap = { main: base, key: 'c'.repeat(64), ready: true }; }
  async load() { return { head: String(this.revision), state: structuredClone(this.state) }; }
  async save(old: { head: string }, value: LoopState) { expect(old.head).toBe(String(this.revision)); parseLoopState(value, config); this.state = structuredClone(value); this.revision++; return this.load(); }
}
class FixtureAPI {
  main = base; currentHead = head; sends: { pr: number; body: string }[] = []; dispatches: number[] = []; wakeups: number[] = []; merges: number[] = []; reads: string[] = []; storedComments = new Map<number, ReturnType<typeof resultComment>[]>();
  mergedPRs = new Map<number, string>(); updatedBodies = new Map<number, string>(); failSend = false; now = () => Date.parse('2026-10-20T10:00:00.000Z'); store = new MemoryStore(); ciDone = false; mainDone = false;
  pr(pr: number) { return { number: pr, node_id: `PR_${pr}`, state: this.mergedPRs.has(pr) ? 'closed' : 'open', merged: this.mergedPRs.has(pr), draft: false, body: this.updatedBodies.get(pr) ?? ['변경 목적', '범위와 제외', '연결 이슈', '검증', '위험과 보안', '리뷰 결과', '머지 조건'].map(n => `## ${n}\n초기 미검증 안내`).join('\n\n'), head: { sha: this.currentHead, ref: `probe-${pr}`, repo: { full_name: repository, fork: false } }, base: { sha: this.main, ref: 'main', repo: { full_name: repository } }, user: { login: 'silverThunder09' }, mergeable: true, mergeable_state: 'clean', merge_commit_sha: this.mergedPRs.get(pr) ?? checkout, labels: [] }; }
  async request(method: string, path: string, value?: unknown): Promise<unknown> {
    this.reads.push(method + ' ' + path); const body = value as Record<string, unknown> | undefined;
    if (path === '/branches/main') return { commit: { sha: this.main } };
    const n = Number(path.match(/\/(?:pulls|issues)\/(\d+)/)?.[1]);
    if (method === 'GET' && /^\/pulls\/\d+$/.test(path)) return this.pr(n);
    if (method === 'PATCH' && /^\/pulls\/\d+$/.test(path)) { this.updatedBodies.set(n, String(body?.body)); return this.pr(n); }
    if (path.startsWith('/issues?state=open')) return [];
    if (path.includes('/labels?') || path.includes('/reviews?') || path.startsWith('/issues/35/comments?')) return [];
    if (path.includes('/files?')) return [{ filename: 'tests/unit/probe.test.ts', status: 'modified' }];
    if (method === 'GET' && /^\/pulls\/\d+\/comments\?/.test(path)) return [];
    if (method === 'GET' && path.includes('/comments?')) return this.storedComments.get(n) ?? [];
    if (method === 'POST' && path === '/merges') return null;
    if (method === 'GET' && path.startsWith('/git/ref/heads/probe-')) return { object: { sha: this.currentHead } };
    if (path === `/git/commits/${checkout}`) return { sha: checkout, parents: [{ sha: this.main }, { sha: this.currentHead }] };
    if (path === `/git/commits/${head}`) return { tree: { sha: '5'.repeat(40) } };
    if (path.includes('/git/trees/')) return { truncated: false, tree: [{ path: 'tests/unit/probe.test.ts', mode: '100644', type: 'blob', sha: blob }] };
    if (path.includes('/git/blobs/')) return { encoding: 'base64', size: 5, content: Buffer.from('test\n').toString('base64') };
    if (method === 'POST' && path === '/actions/workflows/loop-validation.yml/dispatches') { this.dispatches.push(Number((body?.inputs as Record<string, unknown>).pr)); return null; }
    if (method === 'POST' && path === '/actions/workflows/loop-completion.yml/dispatches') { expect(body?.ref).toBe('main'); const inputs = body?.inputs as Record<string, unknown>; if (inputs.pr === '0') { expect(inputs.head).toBe(inputs.checkout); expect(inputs.base).toBe(inputs.checkout); } this.wakeups.push(Number(inputs.pr)); return null; }
    if (method === 'POST' && path.includes('/comments')) return { id: 900, body: body?.body };
    if (method === 'POST' && path.includes('/reviews')) return { id: 901 };
    if (method === 'PUT' && path.endsWith('/merge')) { expect(body?.sha).toBe(head); expect(body?.merge_method).toBe('squash'); this.merges.push(n); this.main = merged; this.mergedPRs.set(n, merged); return { merged: true, sha: merged }; }
    if (path.includes('/check-runs?')) return { check_runs: this.ciDone ? ['checks', 'package', 'pr-policy'].map((name, i) => ({ id: i + 1, name, status: 'completed', conclusion: 'success', head_sha: head, app: { slug: 'github-actions' }, details_url: `https://github.com/${repository}/actions/runs/${100 + i}/job/${300 + i}` })) : [] };
    if (/^\/actions\/runs\/\d+$/.test(path)) return { id: Number(path.split('/').pop()), run_attempt: 1, status: 'completed', conclusion: 'success', event: 'pull_request', head_sha: head, repository: { full_name: repository } };
    throw new Error('unexpected_fixture_api');
  }
  async graphql() { return { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } }; }
  async pagesObject(path: string) { const id = Number(path.match(/runs\/(\d+)/)?.[1]), i = id - 100; return [{ id: 300 + i, run_id: id, run_attempt: 1, name: ['checks', 'package', 'pr-policy'][i], status: 'completed', conclusion: 'success', steps: [{ name: 'Record tested head and base', status: 'completed', conclusion: 'success', started_at: '2026-10-20T10:00:01Z', completed_at: '2026-10-20T10:00:02Z' }] }]; }
  async jobLog(id: number) { const i = id - 300, active = this.store.state.tasks.find(t => ['ci', 'merge'].includes(t.phase))!, proof = { repository, context: ['checks', 'package', 'pr-policy'][i], run_id: String(100 + i), pr_number: active.pr, head_sha: head, base_sha: this.main, checkout_sha: checkout }; return ['##[group]Run node scripts/review/ci-evidence.mjs', 'node scripts/review/ci-evidence.mjs', '##[endgroup]', `AIS_CI_EVIDENCE ${JSON.stringify(proof)}`].map(l => '2026-10-20T10:00:01.500Z ' + l).join('\n'); }
  sender = { request: async (method: string, path: string, value: { body: string }) => {
    expect(method).toBe('POST'); const pr = Number(path.match(/issues\/(\d+)/)?.[1]); this.sends.push({ pr, body: value.body });
    if (this.failSend) throw new Error('response_lost');
    return { id: 1000 + this.sends.length, user: { login: 'silverThunder09', type: 'User' }, body: value.body };
  } };
  options() { return { api: this, sender: this.sender, store: this.store, config, policy, now: this.now, verifyMain: async () => this.mainDone, verifyMerge: async (_api: unknown, _definition: unknown, task: Record<string, unknown>) => {
    const pr = this.pr(Number(task.pr)); return { pr, reviews: [], checks: ['checks', 'package', 'pr-policy'].map((name, i) => ({ id: i + 1, name, status: 'completed', conclusion: 'success', head_sha: head, app: { slug: 'github-actions' }, details_url: `https://github.com/${repository}/actions/runs/${100 + i}/job/${300 + i}` })), evidence: ['checks', 'package', 'pr-policy'].map((context, i) => ({ repository, context, run_id: String(100 + i), pr_number: task.pr, head_sha: head, base_sha: this.main, checkout_sha: checkout })), review: { source: 'current-run', head_sha: head, base_sha: this.main, outstanding_findings: 0, unresolved_threads: 0, open_review_issues: 0, change_requests: 0, changed_paths: ['tests/unit/probe.test.ts'] }, authorization: { scope_approved: true, protected_change_explicitly_approved: false } };
  } }; }
  respond(review: boolean) { const task = this.store.state.tasks.find(t => t.phase === (review ? 'review' : 'development'))!; if (task.pr === null) throw new Error('PR must be prepared'); const request = task.request as ReturnType<typeof reviewRequest>; const list = this.storedComments.get(task.pr) ?? []; list.push(resultComment(request, review, 2000 + list.length)); this.storedComments.set(task.pr, list); }
}
describe('workflow completion wake-up', () => {
  const event = { repository: { full_name: repository }, workflow_run: { id: 39531052934, name: 'Approved loop ' + 'c'.repeat(64), path: '.github/workflows/loop-validation.yml', head_repository: { full_name: repository }, head_sha: base, status: 'completed' } };
  it('accepts the actual dynamic CI name using its stable workflow path', () => {
    expect(acceptsLoopWakeup(event)).toBe(true);
    expect(acceptsLoopWakeup({ ...event, workflow_run: { ...event.workflow_run, name: 'Review wake-up', path: '.github/workflows/review-wakeup.yml' } })).toBe(true);
    expect(acceptsLoopWakeup({ ...event, workflow_run: { ...event.workflow_run, name: 'PR policy', path: '.github/workflows/pr-policy.yml' } })).toBe(true);
  });
  it('rejects name spoofing, another repository, pending runs and self wake-ups', () => {
    for (const run of [
      { ...event.workflow_run, name: 'Loop validation', path: '.github/workflows/unrelated.yml' },
      { ...event.workflow_run, path: '.github/workflows/approved-loop.yml' },
      { ...event.workflow_run, status: 'in_progress' },
      { ...event.workflow_run, head_repository: { full_name: 'untrusted/fork' } },
      { ...event.workflow_run, head_sha: 'invalid' },
    ]) expect(acceptsLoopWakeup({ ...event, workflow_run: run })).toBe(false);
    expect(acceptsLoopWakeup({ ...event, repository: { full_name: 'untrusted/fork' } })).toBe(false);
    expect(acceptsLoopWakeup(null)).toBe(false);
  });
});
describe('approved task/config boundary', () => {
  it('requires an explicit main-owned task list and rejects protected/escaping/duplicate/legacy tasks', () => {
    expect(parseLoopConfig(config).enabled).toBe(true);
    for (const path of ['../x', '.github/ci.yml', 'AGENTS.md', 'harness/mvp.md', 'scripts/review/policy.mjs', '/tmp/x', 'src/AGENTS.md', 'package.json']) expect(() => parseLoopConfig({ ...config, tasks: [{ ...config.tasks[0], allowed_paths: [path] }] })).toThrow();
    expect(() => parseLoopConfig({ ...config, tasks: [config.tasks[0], config.tasks[0]] })).toThrow();
    expect(() => parseLoopConfig({ ...config, tasks: [{ ...config.tasks[0], pr: 52 }] })).toThrow();
  });
  it('rejects overlapping tasks and changes to the approved manifest', () => {
    const state = emptyLoopState(config); state.tasks[0]!.phase = 'development'; state.tasks[1]!.phase = 'review'; expect(() => parseLoopState(state, config)).toThrow('overlapping_tasks');
    expect(() => parseLoopState(emptyLoopState(config), { ...config, tasks: [config.tasks[0]] })).toThrow();
  });
  it('does not access credentials/state or APIs when disabled', async () => {
    expect(await runLoop({ config: { ...config, enabled: false } })).toEqual({ state: 'disabled', changes: 0 });
  });
});
describe('AI review identity and actual review envelope', () => {
  it('binds the exact head/base/key, official author and task link without granting APPROVE', () => {
    const r = reviewRequest(), c = resultComment(r, true, 10); expect(buildReviewRequest(r)).toContain('AI'); expect(parseReviewResult(c, r).findings).toEqual([]);
    for (const wrong of [{ ...c, user: { login: 'silverThunder09', type: 'User' } }, { ...c, body: c.body.replace(head, merged) }, { ...c, html_url: c.html_url.replace('/56#', '/57#') }, { ...c, body: c.body + '\nextra' }, { ...c, created_at: '2025-01-01T00:00:00Z' }, { ...c, body: c.body.replace('"schema":1', '"schema":1,"schema":1') }]) expect(() => parseReviewResult(wrong, r)).toThrow();
  });
  it('accepts formatting whitespace while rejecting unknown fields and lookalike review actions', () => {
    const r = reviewRequest(), c = resultComment(r, true, 10), json = c.body.match(/```json\n([\s\S]+)\n```/)![1]!;
    expect(parseReviewResult({ ...c, body: c.body.replace(json, JSON.stringify(JSON.parse(json), null, 2)) }, r).findings).toEqual([]);
    expect(() => parseReviewResult({ ...c, body: c.body.replace('"findings":[]', '"findings":[],"action":"APPROVED"') }, r)).toThrow();
  });
});
describe('automatic PR validation records', () => {
  it('keeps findings visible, hides only evidence and never presents review as merge approval', () => {
    const task = { pr: 56, head, base, checkout, validated_ci: ['checks', 'package', 'pr-policy'].map((context, i) => ({ repository, pr_number: 56, context, head_sha: head, base_sha: base, checkout_sha: checkout, run_id: String(100 + i) })) };
    const review = { head_sha: head, base_sha: base, findings: ['재시작하면 품질 선택이 초기화됩니다. 앱 종료 후 다시 켜서 재현하며 선택 값을 보존해야 합니다.'], task_url: 'https://github.com/example' };
    const body = renderLoopReview(task, review, '앱을 다시 켜도 3D 품질 선택을 유지합니다.');
    expect(body.indexOf(review.findings[0]!)).toBeLessThan(body.indexOf('<details>'));
    expect(body).toContain('보류 — 위 문제를 수정');
    expect(body.indexOf(head)).toBeGreaterThan(body.indexOf('<details>'));
    expect(renderLoopReview(task, { ...review, findings: [] })).toContain('최종 확인 대기');
    expect(() => renderLoopReview({ ...task, validated_ci: [] }, review)).toThrow('missing_pr_record_evidence');
    expect(() => renderLoopReview(task, { ...review, head_sha: merged })).toThrow('stale_pr_record_evidence');
  });
  it('preserves scope and security sections and refuses missing/stale evidence', () => {
    const f = new FixtureAPI(), original = f.pr(56).body;
    const task = { pr: 56, head, base, checkout, validated_ci: ['checks', 'package', 'pr-policy'].map((context, i) => ({ repository, pr_number: 56, context, head_sha: head, base_sha: base, checkout_sha: checkout, run_id: String(100 + i) })) };
    const review = { head_sha: head, base_sha: base, findings: [], task_url: `https://chatgpt.com/s/cd_${'b'.repeat(32)}` };
    const body = renderLoopPRBody(original, task, review);
    expect(body).toContain('## 범위와 제외\n초기 미검증 안내'); expect(body).toContain('## 위험과 보안\n초기 미검증 안내'); expect(body).toContain('독립적인 사람의 승인이 아닙니다'); expect(body).toContain('/actions/runs/102');
    expect(renderLoopPRBody(body, task, review)).toBe(body);
    expect(() => renderLoopPRBody(original, { ...task, validated_ci: [] }, review)).toThrow();
    expect(() => renderLoopPRBody(original, { ...task, head: merged }, review)).toThrow('stale_pr_record');
    expect(() => renderLoopPRBody('## 검증\n주장만 있는 본문', task, review)).toThrow();
  });
});
describe('event-driven A → merge/main CI → B', () => {
  it('binds merge checkout identity to exactly base/head parents in that order', () => {
    const pr = { head: { sha: head }, base: { sha: base }, merge_commit_sha: checkout }, commit = { sha: checkout, parents: [{ sha: base }, { sha: head }] };
    expect(isCurrentMergeCheckout(pr, base, commit)).toBe(true);
    for (const wrong of [null, { ...commit, sha: head }, { ...commit, parents: [{ sha: head }, { sha: base }] }, { ...commit, parents: [{ sha: base }] }, { ...commit, parents: [...commit.parents, { sha: merged }] }, { ...commit, parents: [{ sha: base }, { sha: merged }] }]) expect(isCurrentMergeCheckout(pr, base, wrong)).toBe(false);
    expect(isCurrentMergeCheckout({ ...pr, base: { sha: merged } }, base, commit)).toBe(false);
  });
  it('waits for merge checkout parents to catch up before starting CI once', async () => {
    const f = new FixtureAPI(), original = f.request.bind(f), stale = '7'.repeat(40); let reads = 0, sleeps = 0; const sent: unknown[] = [];
    Object.assign(f.store.state.tasks[0]!, { phase: 'ci', head, base, branch: 'probe-56', operation: null });
    f.request = async (method, path, value) => {
      if (method === 'GET' && path === '/pulls/56') return { ...f.pr(56), merge_commit_sha: reads++ < 3 ? stale : checkout };
      if (path === `/git/commits/${stale}`) return { sha: stale, parents: [{ sha: base }, { sha: '8'.repeat(40) }] };
      if (method === 'POST' && path === '/actions/workflows/loop-validation.yml/dispatches') sent.push(value);
      return original(method, path, value);
    };
    expect((await runLoop({ ...f.options(), sleep: async () => { sleeps++; } })).state).toBe('waiting-ci');
    expect(sleeps).toBeGreaterThan(0); expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ inputs: { checkout, head, base } }); expect(f.store.state.tasks[0]!.checkout).toBe(checkout); expect(f.wakeups).toEqual([56]);
  });
  it('never dispatches CI for a merge checkout whose parents remain stale', async () => {
    const f = new FixtureAPI(), original = f.request.bind(f), stale = '7'.repeat(40); let sleeps = 0;
    Object.assign(f.store.state.tasks[0]!, { phase: 'ci', head, base, branch: 'probe-56', operation: null });
    f.request = async (method, path, value) => {
      if (method === 'GET' && path === '/pulls/56') return { ...f.pr(56), merge_commit_sha: stale };
      if (path === `/git/commits/${stale}`) return { sha: stale, parents: [{ sha: base }, { sha: '8'.repeat(40) }] };
      return original(method, path, value);
    };
    await expect(runLoop({ ...f.options(), sleep: async () => { sleeps++; } })).rejects.toThrow('merge_checkout_pending');
    expect(sleeps).toBe(5); expect(f.dispatches).toHaveLength(0); expect(f.wakeups).toHaveLength(0); expect(f.sends).toHaveLength(0); expect(f.store.state.tasks[0]!.operation).toBeNull();
  });
  it.each(['main', 'ref', 'label'])('rejects concurrent %s changes while waiting for CI checkout', async change => {
    const f = new FixtureAPI(), original = f.request.bind(f), stale = '7'.repeat(40); let changed = false;
    Object.assign(f.store.state.tasks[0]!, { phase: 'ci', head, base, branch: 'probe-56', operation: null });
    f.request = async (method, path, value) => {
      if (method === 'GET' && path === '/pulls/56') return { ...f.pr(56), merge_commit_sha: stale };
      if (path === `/git/commits/${stale}`) { changed = true; if (change === 'main') f.main = merged; if (change === 'ref') f.currentHead = merged; return { sha: stale, parents: [{ sha: base }, { sha: merged }] }; }
      if (changed && change === 'label' && path.startsWith('/issues/56/labels?')) return [{ name: 'needs-user' }];
      return original(method, path, value);
    };
    await expect(runLoop({ ...f.options(), sleep: async () => {} })).rejects.toThrow(change === 'label' ? 'blocking_label' : 'stale_ci_snapshot');
    expect(f.dispatches).toHaveLength(0); expect(f.wakeups).toHaveLength(0); expect(f.sends).toHaveLength(0);
  });
  it.each([false, true])('waits for delayed PR snapshots after a normal merge (204=%s) without another POST', async noContent => {
    const f = new FixtureAPI(), original = f.request.bind(f), updated = '7'.repeat(40); let merged = false, staleReads = 0, posts = 0;
    f.request = async (method, path, value) => {
      if (method === 'POST' && path === '/merges') { posts++; merged = true; f.currentHead = updated; return noContent ? null : { sha: updated }; }
      if (merged && method === 'GET' && path === '/pulls/56' && staleReads++ < 2) return { ...f.pr(56), head: { ...f.pr(56).head, sha: head } };
      return original(method, path, value);
    };
    expect((await runLoop({ ...f.options(), sleep: async () => {} })).state).toBe('waiting-cloud');
    expect(posts).toBe(1); expect(f.sends).toHaveLength(1); expect(f.store.state.tasks[0]!.request).toMatchObject({ head_sha: updated, base_sha: base });
    expect(f.sends[0]!.body).toContain(updated);
  });
  it('bounds stale snapshot reads without preparing or sending an old request', async () => {
    const f = new FixtureAPI(), original = f.request.bind(f); let merged = false, posts = 0, waits = 0;
    f.request = async (method, path, value) => {
      if (method === 'POST' && path === '/merges') { posts++; merged = true; f.currentHead = '7'.repeat(40); return { sha: f.currentHead }; }
      if (merged && method === 'GET' && path === '/pulls/56') return { ...f.pr(56), head: { ...f.pr(56).head, sha: head } };
      return original(method, path, value);
    };
    await expect(runLoop({ ...f.options(), sleep: async () => { waits++; } })).rejects.toThrow('pr_sync_pending');
    expect(posts).toBe(1); expect(waits).toBe(5); expect(f.sends).toHaveLength(0); expect(f.store.state.tasks[0]!.request).toBeNull();
  });
  it.each(['main', 'ref', 'label'])('stops on a concurrent %s change before preparing a request', async change => {
    const f = new FixtureAPI(), original = f.request.bind(f); let merged = false;
    f.request = async (method, path, value) => {
      if (method === 'POST' && path === '/merges') { merged = true; f.currentHead = '7'.repeat(40); if (change === 'main') f.main = '8'.repeat(40); return { sha: f.currentHead }; }
      if (merged && change === 'ref' && path.startsWith('/git/ref/heads/')) return { object: { sha: '8'.repeat(40) } };
      if (merged && change === 'label' && path.startsWith('/issues/56/labels?')) return [{ name: 'needs-user' }];
      return original(method, path, value);
    };
    await expect(runLoop({ ...f.options(), sleep: async () => {} })).rejects.toThrow({ main: 'sync_main_changed', ref: 'sync_branch_changed', label: 'blocking_label' }[change]);
    expect(f.sends).toHaveLength(0); expect(f.store.state.tasks[0]!.request).toBeNull();
  });
  it('waits at every real external boundary and starts B once only after verified main CI', async () => {
    const f = new FixtureAPI(); expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends.map(s => s.pr)).toEqual([56]);
    await runLoop(f.options()); expect(f.sends).toHaveLength(1);
    f.respond(false); expect((await runLoop(f.options())).state).toBe('waiting-ci'); expect(f.dispatches).toEqual([56]);
    await runLoop(f.options()); expect(f.dispatches).toEqual([56]); expect(f.sends).toHaveLength(1);
    expect(f.wakeups).toEqual([56]);
    f.ciDone = true; expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends).toHaveLength(2);
    f.respond(true); expect((await runLoop(f.options())).state).toBe('waiting-main-ci'); expect(f.merges).toEqual([56]); expect(f.dispatches).toEqual([56, 0]); expect(f.sends.map(s => s.pr)).toEqual([56, 56]);
    expect(f.updatedBodies.get(56)).toContain('실제 merge checkout=' + checkout); expect(f.updatedBodies.get(56)).toContain('검토 결과 원본: https://chatgpt.com/s/cd_'); expect(f.reads.filter(x => x === 'PATCH /pulls/56')).toHaveLength(1);
    await runLoop(f.options()); expect(f.merges).toEqual([56]); expect(f.dispatches).toEqual([56, 0]);
    expect(f.wakeups).toEqual([56, 0]);
    f.mainDone = true; expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends.map(s => s.pr)).toEqual([56, 56, 57]);
    await runLoop(f.options()); expect(f.sends.map(s => s.pr)).toEqual([56, 56, 57]); expect(f.store.state.tasks[0]!.phase).toBe('completed');
  });
  it('waits for the PR policy rerun caused by the review-body edit without pausing or requesting another Cloud task', async () => {
    const f = new FixtureAPI(), options = { ...f.options(), verifyMerge: gatherMergeEvidence };
    await runLoop(options); f.respond(false); await runLoop(options); f.ciDone = true; await runLoop(options); f.respond(true);
    let pending = true, edited = false; const original = f.request.bind(f);
    f.request = async (method, path, value) => {
      if (method === 'PATCH' && path === '/pulls/56') edited = true;
      const result = await original(method, path, value);
      if (edited && pending && path.includes('/check-runs?')) {
        const checks = result as { check_runs: { name: string }[] };
        return { check_runs: checks.check_runs.map(c => c.name === 'pr-policy' ? { ...c, status: 'in_progress', conclusion: null } : c) };
      }
      return result;
    };
    for (let i = 0; i < 2; i++) {
      expect((await runLoop(options)).state).toBe('waiting-ci');
      expect(f.store.state.tasks[0]!.phase).toBe('merge'); expect(f.store.state.tasks[0]!.reason).toBeNull(); expect(f.merges).toHaveLength(0); expect(f.sends).toHaveLength(2);
    }
    pending = false;
    expect((await runLoop(options)).state).toBe('waiting-main-ci');
    expect(f.merges).toEqual([56]); expect(f.sends).toHaveLength(2);
  });
  it('continues once from official native review receipts and still waits for main CI before B', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true; await runLoop(f.options());
    f.storedComments.set(56, nativeResultComments().map(c => ({ ...c, body: c.body.replaceAll('"has_any_findings":false', '"has_any_findings":null').replaceAll('"has_unresolved_findings":false', '"has_unresolved_findings":null') })));
    const original = f.request.bind(f), posted: unknown[] = [];
    f.request = async (method, path, value) => { if (method === 'POST' && path === '/pulls/56/reviews') posted.push(value); return original(method, path, value); };
    expect((await runLoop(f.options())).state).toBe('waiting-main-ci');
    expect(posted).toHaveLength(1); expect(posted[0]).toMatchObject({ event: 'COMMENT', commit_id: head });
    expect(f.updatedBodies.get(56)).toContain('검토 결과 원본: https://github.com/');
    await runLoop(f.options()); expect(posted).toHaveLength(1); expect(f.merges).toEqual([56]); expect(f.sends.map(x => x.pr)).toEqual([56, 56]);
    f.mainDone = true; await runLoop(f.options()); expect(f.store.state.tasks[0]!.phase).toBe('completed'); expect(f.sends.map(x => x.pr)).toEqual([56, 56, 57]);
  });
  it('updates its old review wording instead of reposting or editing another reviewer', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true; await runLoop(f.options()); f.respond(true);
    const task = f.store.state.tasks[0]!, request = task.request as ReturnType<typeof reviewRequest>;
    const marker = `<!-- ais-loop-review:${request.request_key} -->`;
    const original = f.request.bind(f), writes: { method: string; path: string }[] = [];
    let ownBody = '예전 설명\n' + marker;
    f.request = async (method, path, value) => {
      if (method === 'GET' && path.startsWith('/pulls/56/reviews?')) return [
        { id: 900, body: ownBody, commit_id: head, state: 'COMMENTED', user: { login: 'github-actions[bot]' } },
        { id: 901, body: '사람 리뷰\n' + marker, commit_id: head, state: 'CHANGES_REQUESTED', user: { login: 'person' } },
      ];
      if (method === 'PUT' && path === '/pulls/56/reviews/900') { writes.push({ method, path }); ownBody = (value as { body: string }).body; return { id: 900 }; }
      if (method === 'POST' && path === '/pulls/56/reviews') writes.push({ method, path });
      return original(method, path, value);
    };
    await expect(runLoop({ ...f.options(), verifyMerge: gatherMergeEvidence })).rejects.toThrow('merge_policy_denied');
    expect(writes).toEqual([{ method: 'PUT', path: '/pulls/56/reviews/900' }]);
    expect(ownBody).toContain('### 변경 내용');
    expect(ownBody).toContain('독립적인 사람의 승인이 아닙니다');
    expect(f.merges).toHaveLength(0);
  });
  it.each(['custom', 'native-false', 'native-null'])('uses the real merge evidence collector for %s and starts B only after main CI', async kind => {
    const f = new FixtureAPI(), options = { ...f.options(), verifyMerge: gatherMergeEvidence };
    await runLoop(options); f.respond(false); await runLoop(options); f.ciDone = true; await runLoop(options);
    if (kind === 'custom') f.respond(true);
    else f.storedComments.set(56, nativeResultComments().map(c => ({ ...c, body: kind === 'native-null' ? c.body.replaceAll('"has_any_findings":false', '"has_any_findings":null').replaceAll('"has_unresolved_findings":false', '"has_unresolved_findings":null') : c.body })));
    expect((await runLoop(options)).state).toBe('waiting-main-ci');
    expect(f.merges).toEqual([56]); expect(f.sends.map(x => x.pr)).toEqual([56, 56]);
    await runLoop(options); expect(f.merges).toEqual([56]);
    f.mainDone = true; await runLoop(options); expect(f.store.state.tasks[0]!.phase).toBe('completed'); expect(f.sends.map(x => x.pr)).toEqual([56, 56, 57]);
  });
  it.each(['findings', 'human-request'])('revalidates native review and raw human decisions at the final merge read: %s', async changed => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true; await runLoop(f.options());
    f.storedComments.set(56, nativeResultComments().map(c => ({ ...c, body: c.body.replaceAll('"has_any_findings":false', '"has_any_findings":null').replaceAll('"has_unresolved_findings":false', '"has_unresolved_findings":null') })));
    let reads = 0; const original = f.request.bind(f);
    f.request = async (method, path, value) => changed === 'human-request' && reads === 2 && path.startsWith('/pulls/56/reviews?') ? [{ id: 20, state: 'CHANGES_REQUESTED', user: { login: 'person', type: 'User' } }] : original(method, path, value);
    const verifyMerge = async (...args: unknown[]) => {
      reads++;
      if (changed === 'findings' && reads === 2) f.storedComments.set(56, nativeResultComments().map(c => ({ ...c, body: c.body.replaceAll('"has_any_findings":false', '"has_any_findings":true') })));
      return gatherMergeEvidence(...args);
    };
    await expect(runLoop({ ...f.options(), verifyMerge })).rejects.toThrow(changed === 'findings' ? 'native_review_has_findings' : 'merge_policy_changed');
    expect(reads).toBe(2); expect(f.merges).toHaveLength(0); expect(f.store.state.tasks[1]!.phase).toBe('queued');
  });
  it('reads every REST review-comment page before accepting null native finding metadata', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true; await runLoop(f.options());
    f.storedComments.set(56, nativeResultComments().map(c => ({ ...c, body: c.body.replaceAll('"has_any_findings":false', '"has_any_findings":null').replaceAll('"has_unresolved_findings":false', '"has_unresolved_findings":null') })));
    const original = f.request.bind(f); let secondPage = false;
    f.request = async (method, path, value) => {
      if (path.startsWith('/pulls/56/comments?')) {
        if (path.endsWith('page=1')) return Array.from({ length: 100 }, (_, i) => ({ id: i + 1, user: { login: 'person', type: 'User' } }));
        secondPage = true; return [{ id: 101, user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' } }];
      }
      return original(method, path, value);
    };
    await expect(runLoop(f.options())).rejects.toThrow('native_review_has_findings');
    expect(secondPage).toBe(true); expect(f.merges).toHaveLength(0); expect(f.store.state.tasks[1]!.phase).toBe('queued');
  });
  it('never treats native code review as completion of a Cloud development request', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.storedComments.set(56, nativeResultComments());
    expect((await runLoop(f.options())).state).toBe('waiting-cloud');
    expect(f.store.state.tasks[0]!.phase).toBe('development'); expect(f.store.state.tasks[1]!.phase).toBe('queued');
    expect(f.merges).toHaveLength(0); expect(f.dispatches).toHaveLength(0); expect(f.sends).toHaveLength(1);
  });
  it('does not resend uncertain requests after restart or start another task', async () => {
    const f = new FixtureAPI(); f.failSend = true; await expect(runLoop(f.options())).rejects.toThrow('response_lost');
    expect(f.sends).toHaveLength(1); expect(f.store.state.tasks[0]!.phase).toBe('paused'); expect(f.store.state.tasks[1]!.phase).toBe('queued');
    f.failSend = false; expect((await runLoop(f.options())).state).toBe('paused'); expect(f.sends).toHaveLength(1);
  });
  it('syncs main through a valid merge path without bypassing the repo client path guard', async () => {
    const f = new FixtureAPI();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const prefix = `https://api.github.com/repos/${repository}`;
      expect(url.startsWith(prefix + '/')).toBe(true);
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      const result = await f.request(init.method!, url.slice(prefix.length), body);
      return new Response(result === null ? null : JSON.stringify(result), { status: result === null ? 204 : 200 });
    });
    try {
      expect((await runLoop({ ...f.options(), api: new GitHub('synthetic-test-token') })).state).toBe('waiting-cloud');
      expect(f.reads).toContain('POST /merges'); expect(f.sends).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not merge or advance after CI failure/stale proof', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true;
    f.jobLog = async () => 'untrusted PR_BODY AIS_CI_EVIDENCE {}'; await expect(runLoop(f.options())).rejects.toThrow(); expect(f.merges).toHaveLength(0); expect(f.sends).toHaveLength(1); expect(f.store.state.tasks[1]!.phase).toBe('queued');
  });
  it('preserves a live lease and never overlaps a competing run', async () => {
    const f = new FixtureAPI(); f.store.state.lease = { owner: 'c'.repeat(64), until: f.now() + 10000 }; expect((await runLoop(f.options())).state).toBe('leased'); expect(f.sends).toHaveLength(0);
  });
  it('checks activation main before sending the first task and dispatches that CI once', async () => {
    const f = new FixtureAPI(); delete f.store.state.bootstrap;
    expect((await runLoop(f.options())).state).toBe('waiting-bootstrap-ci'); expect(f.dispatches).toEqual([0]); expect(f.sends).toHaveLength(0);
    expect((await runLoop(f.options())).state).toBe('waiting-bootstrap-ci'); expect(f.dispatches).toEqual([0]);
    f.mainDone = true; expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends.map(s => s.pr)).toEqual([56]);
  });
  it('never starts development if activation main CI fails', async () => {
    const f = new FixtureAPI(); delete f.store.state.bootstrap; await runLoop(f.options());
    await expect(runLoop({ ...f.options(), verifyMain: async () => { throw new Error('main_ci_failed'); } })).rejects.toThrow('main_ci_failed'); expect(f.sends).toHaveLength(0);
  });
  it('preserves an earlier bootstrap key and tests an advanced main exactly once before sending', async () => {
    const f = new FixtureAPI(); delete f.store.state.bootstrap;
    await runLoop(f.options()); const original = structuredClone(f.store.state.bootstrap!);
    f.main = merged;
    expect((await runLoop(f.options())).state).toBe('waiting-bootstrap-ci'); expect(f.dispatches).toEqual([0, 0]);
    expect(f.store.state.bootstrap).toMatchObject({ main: original.main, key: original.key, ready: false, checks: [{ main: merged, ready: false }] });
    await runLoop(f.options()); expect(f.dispatches).toEqual([0, 0]); expect(f.sends).toHaveLength(0);
    f.mainDone = true; expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends).toHaveLength(1);
    expect(f.store.state.bootstrap!.checks![0]!.ready).toBe(true); expect(f.store.state.tasks[0]!.base).toBe(merged); expect(f.store.state.tasks[1]!.phase).toBe('queued');
  });
  it('stops after three bootstrap attempts when main keeps moving', async () => {
    const f = new FixtureAPI(); delete f.store.state.bootstrap; await runLoop(f.options());
    for (const main of [merged, '5'.repeat(40)]) { f.main = main; await runLoop(f.options()); }
    f.main = '6'.repeat(40); await expect(runLoop(f.options())).rejects.toThrow('bootstrap_retry_limit');
    expect(f.dispatches).toEqual([0, 0, 0]); expect(f.sends).toHaveLength(0); expect(f.store.state.bootstrap!.checks).toHaveLength(2);
  });
  it('passes original blocking human reviews to the existing policy and denies merge', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true; await runLoop(f.options()); f.respond(true);
    const options = f.options(), normal = options.verifyMerge;
    await expect(runLoop({ ...options, verifyMerge: async (...args: Parameters<typeof normal>) => ({ ...await normal(...args), reviews: [{ id: 1, user: { login: 'human' }, state: 'CHANGES_REQUESTED' }, { id: 2, user: { login: 'human' }, state: 'COMMENTED' }] }) })).rejects.toThrow('merge_policy_denied'); expect(f.merges).toHaveLength(0); expect(f.sends).toHaveLength(2);
  });
  it('rechecks human decisions immediately before merging and stops when they change', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true; await runLoop(f.options()); f.respond(true);
    const options = f.options(), normal = options.verifyMerge; let calls = 0;
    await expect(runLoop({ ...options, verifyMerge: async (...args: Parameters<typeof normal>) => { const input = await normal(...args); calls++; return { ...input, reviews: calls === 1 ? [] : [{ id: 10, user: { login: 'human' }, state: 'CHANGES_REQUESTED' }] }; } })).rejects.toThrow('merge_policy_changed');
    expect(f.merges).toHaveLength(0);
  });
  it('does not advance after a main regression or an unexpected external main change', async () => {
    const f = new FixtureAPI(); await runLoop(f.options()); f.respond(false); await runLoop(f.options()); f.ciDone = true; await runLoop(f.options()); f.respond(true); await runLoop(f.options());
    await expect(runLoop({ ...f.options(), verifyMain: async () => { throw new Error('main_ci_failed'); } })).rejects.toThrow('main_ci_failed');
    expect(f.sends.every(s => s.pr === 56)).toBe(true); expect(f.store.state.tasks[1]!.phase).toBe('queued');
  });
});
describe('durable store fail-closed boundary', () => {
  it('does not auto-initialize a missing state branch or swallow an HTTP rejection', async () => {
    const operations: string[] = [], api = { async request(method: string) { operations.push(method); throw new Error('HTTP 404'); } };
    await expect(new LoopStore(api, config).load()).rejects.toThrow('HTTP 404'); expect(operations).toEqual(['GET']);
  });
  it('rejects a stale writer before any state commit and preserves completed history', async () => {
    const api = { async request() { throw new Error('unexpected_write'); } }, store = new LoopStore(api, config), state = emptyLoopState(config);
    store.load = async () => ({ head: '9'.repeat(40), tree: '8'.repeat(40), state });
    await expect(store.save({ head, tree: base, state }, { ...state, revision: 1 })).rejects.toThrow('loop_cas_conflict');
    state.tasks[0]!.phase = 'completed'; const next = structuredClone(state); next.revision++; next.tasks[0]!.phase = 'queued'; store.load = async () => ({ head, tree: base, state });
    await expect(store.save({ head, tree: base, state }, next)).rejects.toThrow('completed_history_changed');
  });
  it('rejects bootstrap checkpoint removal, identity changes and verified-result rollback before writes', async () => {
    const api = { async request() { throw new Error('unexpected_write'); } }, store = new LoopStore(api, config), state = emptyLoopState(config);
    state.bootstrap = { main: base, key: 'c'.repeat(64), ready: false, checks: [{ main: merged, key: 'd'.repeat(64), ready: true }] };
    store.load = async () => ({ head, tree: base, state });
    for (const checks of [[], [{ ...state.bootstrap.checks![0]!, key: 'e'.repeat(64) }], [{ ...state.bootstrap.checks![0]!, ready: false }]]) {
      const next = structuredClone(state); next.revision++; next.bootstrap!.checks = checks;
      await expect(store.save({ head, tree: base, state }, next)).rejects.toThrow('bootstrap_history_changed');
    }
  });
});
describe('workflow privilege and storage boundaries', () => {
  it('runs the coordinator from main only, uses existing comment credentials only for requests and has no timer', () => {
    const workflow = readFileSync('.github/workflows/approved-loop.yml', 'utf8');
    expect(workflow).toContain('ref: main'); expect(workflow).toContain('persist-credentials: false'); expect(workflow).not.toContain('schedule:'); expect(workflow).not.toContain('npm ci');
    const validation = readFileSync('.github/workflows/loop-validation.yml', 'utf8'); expect(validation).toContain('contents: read'); expect(validation).not.toContain('secrets.'); expect(validation).not.toContain('contents: write'); expect(validation).toContain('npm run test:smoke'); expect(validation).toContain('SMOKE_EXECUTABLE'); expect(validation).toContain('retention-days: 1'); expect(validation).not.toContain('Upload Windows download');
  });
});

describe('승인된 연속 실행 검증', () => {
  it('첫 작업의 needs-user 라벨은 Codex 발신과 다음 작업을 막는다', async () => {
    const f = new FixtureAPI(), original = f.request.bind(f);
    f.request = async (method, path, value) => path.startsWith('/issues/56/labels?')
      ? [{ name: 'needs-user' }]
      : original(method, path, value);

    await expect(runLoop(f.options())).rejects.toThrow('blocking_label');
    expect(f.sends).toHaveLength(0); expect(f.merges).toHaveLength(0); expect(f.store.state.tasks[1]!.phase).toBe('queued');
  });
});

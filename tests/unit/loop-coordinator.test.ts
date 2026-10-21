import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { emptyLoopState, parseLoopConfig, parseLoopState, parseReviewResult, buildReviewRequest, renderLoopPRBody, runLoop, LoopStore, type LoopState } from '../../scripts/review/loop-coordinator.mjs';
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
class MemoryStore {
  state: LoopState; revision = 0;
  constructor() { this.state = emptyLoopState(config); this.state.bootstrap = { main: base, key: 'c'.repeat(64), ready: true }; }
  async load() { return { head: String(this.revision), state: structuredClone(this.state) }; }
  async save(old: { head: string }, value: LoopState) { expect(old.head).toBe(String(this.revision)); parseLoopState(value, config); this.state = structuredClone(value); this.revision++; return this.load(); }
}
class FixtureAPI {
  main = base; sends: { pr: number; body: string }[] = []; dispatches: number[] = []; merges: number[] = []; reads: string[] = []; storedComments = new Map<number, ReturnType<typeof resultComment>[]>();
  mergedPRs = new Map<number, string>(); updatedBodies = new Map<number, string>(); failSend = false; now = () => Date.parse('2026-10-20T10:00:00.000Z'); store = new MemoryStore(); ciDone = false; mainDone = false;
  pr(pr: number) { return { number: pr, node_id: `PR_${pr}`, state: this.mergedPRs.has(pr) ? 'closed' : 'open', merged: this.mergedPRs.has(pr), draft: false, body: this.updatedBodies.get(pr) ?? ['변경 목적', '범위와 제외', '연결 이슈', '검증', '위험과 보안', '리뷰 결과', '머지 조건'].map(n => `## ${n}\n초기 미검증 안내`).join('\n\n'), head: { sha: head, ref: `probe-${pr}`, repo: { full_name: repository, fork: false } }, base: { sha: this.main, ref: 'main', repo: { full_name: repository } }, user: { login: 'silverThunder09' }, mergeable: true, mergeable_state: 'clean', merge_commit_sha: this.mergedPRs.get(pr) ?? checkout, labels: [] }; }
  async request(method: string, path: string, value?: unknown): Promise<unknown> {
    this.reads.push(method + ' ' + path); const body = value as Record<string, unknown> | undefined;
    if (path === '/branches/main') return { commit: { sha: this.main } };
    const n = Number(path.match(/\/(?:pulls|issues)\/(\d+)/)?.[1]);
    if (method === 'GET' && /^\/pulls\/\d+$/.test(path)) return this.pr(n);
    if (method === 'PATCH' && /^\/pulls\/\d+$/.test(path)) { this.updatedBodies.set(n, String(body?.body)); return this.pr(n); }
    if (path.includes('/labels?') || path.includes('/reviews?') || path.startsWith('/issues/35/comments?')) return [];
    if (path.includes('/files?')) return [{ filename: 'tests/unit/probe.test.ts', status: 'modified' }];
    if (method === 'GET' && path.includes('/comments?')) return this.storedComments.get(n) ?? [];
    if (method === 'POST' && path === '/merges') return null;
    if (path === `/git/commits/${head}`) return { tree: { sha: '5'.repeat(40) } };
    if (path.includes('/git/trees/')) return { truncated: false, tree: [{ path: 'tests/unit/probe.test.ts', mode: '100644', type: 'blob', sha: blob }] };
    if (path.includes('/git/blobs/')) return { encoding: 'base64', size: 5, content: Buffer.from('test\n').toString('base64') };
    if (method === 'POST' && path === '/actions/workflows/loop-validation.yml/dispatches') { this.dispatches.push(Number((body?.inputs as Record<string, unknown>).pr)); return null; }
    if (method === 'POST' && path.includes('/comments')) return { id: 900, body: body?.body };
    if (method === 'POST' && path.includes('/reviews')) return { id: 901 };
    if (method === 'PUT' && path.endsWith('/merge')) { expect(body?.sha).toBe(head); expect(body?.merge_method).toBe('squash'); this.merges.push(n); this.main = merged; this.mergedPRs.set(n, merged); return { merged: true, sha: merged }; }
    if (path.includes('/check-runs?')) return { check_runs: this.ciDone ? ['checks', 'package', 'pr-policy'].map((name, i) => ({ id: i + 1, name, status: 'completed', conclusion: 'success', head_sha: head, app: { slug: 'github-actions' }, details_url: `https://github.com/${repository}/actions/runs/${100 + i}/job/${300 + i}` })) : [] };
    if (/^\/actions\/runs\/\d+$/.test(path)) return { id: Number(path.split('/').pop()), run_attempt: 1, status: 'completed', conclusion: 'success', event: 'pull_request', head_sha: head, repository: { full_name: repository } };
    throw new Error('unexpected_fixture_api');
  }
  async pagesObject(path: string) { const id = Number(path.match(/runs\/(\d+)/)?.[1]), i = id - 100; return [{ id: 300 + i, run_id: id, run_attempt: 1, name: ['checks', 'package', 'pr-policy'][i], status: 'completed', conclusion: 'success', steps: [{ name: 'Record tested head and base', status: 'completed', conclusion: 'success', started_at: '2026-10-20T10:00:01Z', completed_at: '2026-10-20T10:00:02Z' }] }]; }
  async jobLog(id: number) { const i = id - 300, active = this.store.state.tasks.find(t => t.phase === 'ci')!, proof = { repository, context: ['checks', 'package', 'pr-policy'][i], run_id: String(100 + i), pr_number: active.pr, head_sha: head, base_sha: this.main, checkout_sha: checkout }; return ['##[group]Run node scripts/review/ci-evidence.mjs', 'node scripts/review/ci-evidence.mjs', '##[endgroup]', `AIS_CI_EVIDENCE ${JSON.stringify(proof)}`].map(l => '2026-10-20T10:00:01.500Z ' + l).join('\n'); }
  sender = { request: async (method: string, path: string, value: { body: string }) => {
    expect(method).toBe('POST'); const pr = Number(path.match(/issues\/(\d+)/)?.[1]); this.sends.push({ pr, body: value.body });
    if (this.failSend) throw new Error('response_lost');
    return { id: 1000 + this.sends.length, user: { login: 'silverThunder09', type: 'User' }, body: value.body };
  } };
  options() { return { api: this, sender: this.sender, store: this.store, config, policy, now: this.now, verifyMain: async () => this.mainDone, verifyMerge: async (_api: unknown, _definition: unknown, task: Record<string, unknown>) => {
    const pr = this.pr(Number(task.pr)); return { pr, reviews: [], checks: ['checks', 'package', 'pr-policy'].map((name, i) => ({ id: i + 1, name, status: 'completed', conclusion: 'success', head_sha: head, app: { slug: 'github-actions' }, details_url: `https://github.com/${repository}/actions/runs/${100 + i}/job/${300 + i}` })), evidence: ['checks', 'package', 'pr-policy'].map((context, i) => ({ repository, context, run_id: String(100 + i), pr_number: task.pr, head_sha: head, base_sha: this.main, checkout_sha: checkout })), review: { source: 'current-run', head_sha: head, base_sha: this.main, outstanding_findings: 0, unresolved_threads: 0, open_review_issues: 0, change_requests: 0, changed_paths: ['tests/unit/probe.test.ts'] }, authorization: { scope_approved: true, protected_change_explicitly_approved: false } };
  } }; }
  respond(review: boolean) { const task = this.store.state.tasks.find(t => t.phase === (review ? 'review' : 'development'))!; const request = task.request as ReturnType<typeof reviewRequest>; const list = this.storedComments.get(task.pr) ?? []; list.push(resultComment(request, review, 2000 + list.length)); this.storedComments.set(task.pr, list); }
}
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
  it('waits at every real external boundary and starts B once only after verified main CI', async () => {
    const f = new FixtureAPI(); expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends.map(s => s.pr)).toEqual([56]);
    await runLoop(f.options()); expect(f.sends).toHaveLength(1);
    f.respond(false); expect((await runLoop(f.options())).state).toBe('waiting-ci'); expect(f.dispatches).toEqual([56]);
    await runLoop(f.options()); expect(f.dispatches).toEqual([56]); expect(f.sends).toHaveLength(1);
    f.ciDone = true; expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends).toHaveLength(2);
    f.respond(true); expect((await runLoop(f.options())).state).toBe('waiting-main-ci'); expect(f.merges).toEqual([56]); expect(f.dispatches).toEqual([56, 0]); expect(f.sends.map(s => s.pr)).toEqual([56, 56]);
    expect(f.updatedBodies.get(56)).toContain('실제 merge checkout=' + checkout); expect(f.updatedBodies.get(56)).toContain('실제 검토 작업: https://chatgpt.com/s/cd_'); expect(f.reads.filter(x => x === 'PATCH /pulls/56')).toHaveLength(1);
    await runLoop(f.options()); expect(f.merges).toEqual([56]); expect(f.dispatches).toEqual([56, 0]);
    f.mainDone = true; expect((await runLoop(f.options())).state).toBe('waiting-cloud'); expect(f.sends.map(s => s.pr)).toEqual([56, 56, 57]);
    await runLoop(f.options()); expect(f.sends.map(s => s.pr)).toEqual([56, 56, 57]); expect(f.store.state.tasks[0]!.phase).toBe('completed');
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
});
describe('workflow privilege and storage boundaries', () => {
  it('runs the coordinator from main only, uses existing comment credentials only for requests and has no timer', () => {
    const workflow = readFileSync('.github/workflows/approved-loop.yml', 'utf8');
    expect(workflow).toContain('ref: main'); expect(workflow).toContain('persist-credentials: false'); expect(workflow).not.toContain('schedule:'); expect(workflow).not.toContain('npm ci');
    const validation = readFileSync('.github/workflows/loop-validation.yml', 'utf8'); expect(validation).toContain('contents: read'); expect(validation).not.toContain('secrets.'); expect(validation).not.toContain('contents: write'); expect(validation).toContain('npm run test:smoke'); expect(validation).toContain('SMOKE_EXECUTABLE'); expect(validation).toContain('retention-days: 1'); expect(validation).not.toContain('Upload Windows download');
  });
});

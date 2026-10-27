import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { APIError } from '../../scripts/review/event-worker';
import { emptyLoopState, parseLoopConfig, parseLoopState, runLoop, type LoopState, type LoopTask } from '../../scripts/review/loop-coordinator.mjs';
import { plannedSeed, preparePlannedPR } from '../../scripts/review/loop-planner.mjs';
import { isPendingWakeup } from '../../scripts/review/loop-waiter.mjs';
import { ProductWriter } from '../../scripts/review/pr-writer.mjs';

const repository = 'silverThunder09/ai-interview-studio', base = 'a'.repeat(40), seed = 'b'.repeat(40), tree = 'c'.repeat(40);
const spec = 'approved product spec\n';
const definition = { id: 'avatar-quality', pr: null, title: '3D 렌더링 품질 보존', goal: '승인된 3D 설정만 보존한다.', approval: '현재 채팅의 Phase 1 승인',
  spec: { path: 'harness/specs/gemini-local-interview.md', sha256: createHash('sha256').update(spec).digest('hex') },
  acceptance: ['기존 모델·면접 기록 보존', '실제 check·관련 smoke 성공'], allowed_paths: ['src/renderer/src/avatar/AvatarPanel.tsx'] };
const config = { schema: 1, repository, enabled: true, cloud_transport: 'legacy-comment', tasks: [definition, { ...definition, id: 'avatar-zoom', title: '키보드 시점 확대·축소' }] };
const policy = { repository, max_prs_per_run: 2, max_fix_cycles: 3, protected_paths: ['.github/', 'harness/', 'scripts/review/', 'AGENTS.md'] };
const file = (text: string) => ({ type: 'file', size: Buffer.byteLength(text), encoding: 'base64', content: Buffer.from(text).toString('base64') });
type PR = { number: number; state: string; draft: boolean; merged: boolean; title: string; body: string; user: { login: string }; head: { ref: string; sha: string; repo: { full_name: string; fork: boolean } }; base: { ref: string; sha: string; repo: { full_name: string } } };
class API {
  writes: { method: string; path: string; value: unknown }[] = []; reads: string[] = [];
  main = base; branch: string | null = null; pr: PR | null = null; spec = spec; seedText = plannedSeed(definition);
  losePRReply = false; loseBranchReply = false; failRefRead = false; sends = 0;
  async request(method: string, path: string, value?: unknown): Promise<unknown> {
    if (method !== 'GET') this.writes.push({ method, path, value }); else this.reads.push(path);
    if (path === '/branches/main') return { commit: { sha: this.main } };
    if (path.startsWith('/contents/harness/specs/')) return file(this.spec);
    if (path.startsWith('/contents/.automation/requests/')) { if (path.endsWith(`ref=${base}`)) throw new APIError(404); return file(this.seedText); }
    if (method === 'GET' && path.startsWith('/git/commits/')) return { tree: { sha: tree }, parents: path.endsWith(seed) ? [{ sha: base }] : [] };
    if (method === 'POST' && path === '/git/trees') { expect(value).toMatchObject({ base_tree: tree, tree: [{ path: '.automation/requests/avatar-quality.md', mode: '100644' }] }); return { sha: tree }; }
    if (method === 'POST' && path === '/git/commits') { expect(value).toMatchObject({ parents: [base], tree }); return { sha: seed }; }
    if (method === 'GET' && path.startsWith('/git/ref/heads/work/')) {
      if (this.failRefRead) throw new APIError(403);
      if (this.branch === null) throw new APIError(404); return { object: { sha: this.branch } };
    }
    if (method === 'POST' && path === '/git/refs') { this.branch = (value as { sha: string }).sha; if (this.loseBranchReply) throw new Error('lost_reply'); return { object: { sha: this.branch } }; }
    if (method === 'GET' && path.startsWith('/pulls?')) return this.pr ? [{ number: this.pr.number }] : [];
    if (path === '/pulls/80') return this.pr;
    if (method === 'POST' && path === '/pulls') {
      const input = value as { title: string; body: string; draft: boolean; head: string; base: string };
      this.pr = { number: 80, state: 'open', merged: false, draft: input.draft, title: input.title, body: input.body, user: { login: 'silverThunder09' },
        head: { ref: input.head, sha: seed, repo: { full_name: repository, fork: false } }, base: { ref: input.base, sha: base, repo: { full_name: repository } } };
      if (this.losePRReply) throw new Error('lost_reply'); return { number: 80 };
    }
    if (/\/files\?/.test(path)) return [{ filename: '.automation/requests/avatar-quality.md', status: 'added' }];
    if (/\/labels\?|\/comments\?/.test(path)) return [];
    if (path === '/merges') return null;
    if (method === 'POST' && /^\/actions\/workflows\/(loop-validation|loop-completion)\.yml\/dispatches$/.test(path)) { expect(value).toMatchObject({ ref: 'main', inputs: { pr: '0', head: base, base, checkout: base } }); return null; }
    if (method === 'POST' && path === '/issues/80/comments') { this.sends++; return { id: 900, user: { login: 'silverThunder09', type: 'User' }, body: (value as { body: string }).body }; }
    throw new Error(`unexpected_fixture_api: ${method} ${path}`);
  }
}
class Store {
  state: LoopState; revision = 0;
  constructor(private readonly configValue: unknown = config) { this.state = emptyLoopState(configValue); this.state.bootstrap = { main: base, key: 'd'.repeat(64), ready: true }; this.state.tasks[0]!.planning_ci = { main: base, key: 'e'.repeat(64) }; }
  async load() { return { head: String(this.revision), state: structuredClone(this.state) }; }
  async save(old: { head: string }, state: LoopState) { expect(old.head).toBe(String(this.revision)); parseLoopState(state, this.configValue); this.state = structuredClone(state); this.revision++; return this.load(); }
}
function preparation(api: API) {
  const task = emptyLoopState(config).tasks[0]!;
  const options = { api, sender: api, task, definition, update: async (fn: (t: LoopTask) => void) => { fn(task); } };
  return { task, options };
}

describe('approved goal → next PR preparation', () => {
  it('uses the App only for seed objects/ref, keeps Draft creation with the user sender and recovers without duplicates', async () => {
    const api = new API(), { options } = preparation(api), appWrites: string[] = [], senderWrites: string[] = [];
    const credentials = { client: async () => ({ request: async (method: string, path: string, body: unknown) => { appWrites.push(path); return api.request(method, path, body); } }) };
    const writer = new ProductWriter({ api, credentials, config });
    const sender = { request: async (method: string, path: string, body: unknown) => { senderWrites.push(path); return api.request(method, path, body); } };
    const request = { ...options, writer, sender };
    expect(await preparePlannedPR(request)).toMatchObject({ number: 80 });
    expect(appWrites).toEqual(['/git/trees', '/git/commits', '/git/refs']); expect(senderWrites).toEqual(['/pulls']);
    await preparePlannedPR(request); expect(appWrites).toHaveLength(3); expect(senderWrites).toHaveLength(1);
    expect(api.pr!.user.login).toBe('silverThunder09');
  });
  it('accepts unbound approved tasks but rejects absent approval, AC, spec hash and protected paths', () => {
    expect(parseLoopConfig(config).tasks).toHaveLength(2);
    for (const change of [{ approval: '' }, { acceptance: [] }, { spec: { ...definition.spec, sha256: 'bad' } }, { title: 'bad\ntitle' }, { allowed_paths: ['.github/workflows/x.yml'] }]) {
      expect(() => parseLoopConfig({ ...config, tasks: [{ ...definition, ...change }] })).toThrow();
    }
    const state = emptyLoopState(config); state.tasks[0]!.phase = 'development';
    expect(() => parseLoopState(state, config)).toThrow('missing_prepared_pr');
    state.tasks.forEach(t => { t.phase = 'queued'; t.pr = 80; });
    expect(() => parseLoopState(state, config)).toThrow('duplicate_bound_pr');
  });
  it('creates a main-parent seed commit and a Draft PR with the allowed author, without dispatching CI or merging', async () => {
    const api = new API(), { options, task } = preparation(api);
    expect(await preparePlannedPR(options)).toMatchObject({ number: 80 });
    expect(task.preparation).toMatchObject({ base, commit: seed, branch_attempted: true, pr_attempted: true });
    expect(api.writes.map(w => w.path)).toEqual(['/git/trees', '/git/commits', '/git/refs', '/pulls']);
    expect(api.pr).toMatchObject({ draft: true, user: { login: 'silverThunder09' } });
    expect(api.pr!.body).toContain('아직 실행하지 않았습니다');
  });
  it('recovers an accepted PR whose response was lost without creating a second PR or branch', async () => {
    const api = new API(), { options } = preparation(api); api.losePRReply = true;
    await expect(preparePlannedPR(options)).rejects.toThrow('lost_reply');
    const count = api.writes.length;
    expect(await preparePlannedPR(options)).toMatchObject({ number: 80 });
    expect(api.writes).toHaveLength(count);
  });
  it('recovers a branch response loss, and refuses to re-send an ambiguous PR create with no receipt', async () => {
    const api = new API(), { options, task } = preparation(api); api.loseBranchReply = true;
    await expect(preparePlannedPR(options)).rejects.toThrow('lost_reply');
    api.loseBranchReply = false; await preparePlannedPR(options);
    expect(api.writes.filter(w => w.path === '/git/refs')).toHaveLength(1);
    api.pr = null; const count = api.writes.length;
    expect(task.preparation).toMatchObject({ pr_attempted: true });
    await expect(preparePlannedPR(options)).rejects.toThrow('ambiguous_planned_pr');
    expect(api.writes).toHaveLength(count);
  });
  it('treats failed reads, changed spec and occupied branches as blockers rather than absence', async () => {
    for (const kind of ['read', 'spec', 'branch']) {
      const api = new API(), { options } = preparation(api);
      if (kind === 'read') api.failRefRead = true;
      if (kind === 'spec') api.spec += 'unapproved change';
      if (kind === 'branch') api.branch = seed;
      await expect(preparePlannedPR(options)).rejects.toThrow(); expect(api.writes).toHaveLength(0);
    }
  });
  it('refuses a moved main, moved branch, modified seed, closed PR or wrong author during recovery', async () => {
    for (const kind of ['main', 'branch', 'seed', 'closed', 'author']) {
      const api = new API(), { options } = preparation(api); await preparePlannedPR(options);
      if (kind === 'main') api.main = 'e'.repeat(40);
      if (kind === 'branch') api.branch = 'e'.repeat(40);
      if (kind === 'seed') api.seedText += 'tampered';
      if (kind === 'closed') api.pr!.state = 'closed';
      if (kind === 'author') api.pr!.user.login = 'github-actions[bot]';
      const count = api.writes.length; await expect(preparePlannedPR(options)).rejects.toThrow(); expect(api.writes).toHaveLength(count);
    }
  });
  it('creates the real next task and sends one Cloud request; re-entry waits without duplicates or the second task', async () => {
    const api = new API(), store = new Store();
    const options = { api, sender: api, store, config, policy, verifyMain: async () => true };
    expect(await runLoop(options)).toMatchObject({ state: 'waiting-cloud' });
    expect(store.state.tasks.map(t => [t.pr, t.phase])).toEqual([[80, 'development'], [null, 'queued']]);
    expect(api.sends).toBe(1); expect(api.writes.filter(w => w.path === '/pulls')).toHaveLength(1);
    const count = api.writes.length;
    expect(await runLoop(options)).toMatchObject({ state: 'waiting-cloud' });
    expect(api.sends).toBe(1); expect(api.writes).toHaveLength(count);
  });
  it('validates a newly installed main before creating any product PR and wakes only the matching pending task', async () => {
    const api = new API(), store = new Store(); delete store.state.tasks[0]!.planning_ci;
    let success = false;
    const options = { api, sender: api, store, config, policy, verifyMain: async () => success };
    expect(await runLoop(options)).toMatchObject({ state: 'waiting-planning-ci' });
    expect(api.writes.map(w => w.path)).toEqual(['/actions/workflows/loop-validation.yml/dispatches', '/actions/workflows/loop-completion.yml/dispatches']);
    const ci = store.state.tasks[0]!.planning_ci as { main: string; key: string };
    const input = { pr: '0', head: base, base, checkout: base, key: ci.key };
    expect(isPendingWakeup(store.state, input)).toBe(true);
    expect(isPendingWakeup(store.state, { ...input, key: '0'.repeat(64) })).toBe(false);
    expect(await runLoop(options)).toMatchObject({ state: 'waiting-planning-ci' });
    expect(api.writes).toHaveLength(2); expect(api.pr).toBeNull();
    success = true;
    expect(await runLoop(options)).toMatchObject({ state: 'waiting-cloud' });
    expect(isPendingWakeup(store.state, input)).toBe(false); expect(api.sends).toBe(1);
  });
  it('never reuses an installation CI result after main has moved', async () => {
    const api = new API(), store = new Store(); api.main = 'f'.repeat(40);
    const original = api.request.bind(api);
    api.request = async (method, path, value) => path.startsWith('/issues/35/comments') ? [] : original(method, path, value);
    await expect(runLoop({ api, sender: api, store, config, policy, verifyMain: async () => true })).rejects.toThrow('planned_main_changed');
    expect(api.writes).toHaveLength(0); expect(store.state.tasks[0]!.phase).toBe('paused'); expect(store.state.tasks[1]!.pr).toBeNull();
  });
  it('never prepares the next task when the first is paused or another lease owns the state', async () => {
    for (const kind of ['paused', 'leased']) {
      const api = new API(), store = new Store();
      if (kind === 'paused') { store.state.tasks[0]!.phase = 'paused'; store.state.tasks[0]!.reason = 'needs-user'; }
      else store.state.lease = { owner: 'e'.repeat(64), until: Date.now() + 60_000 };
      expect(await runLoop({ api, sender: api, store, config, policy })).toMatchObject({ state: kind });
      expect(api.writes).toHaveLength(0); expect(store.state.tasks[1]!.pr).toBeNull();
    }
  });
  it('honors the global stop on every page and resumes the unchanged queue only after the hold is removed', async () => {
    for (const label of ['agent-paused', 'needs-user']) {
      const api = new API(), store = new Store(), original = api.request.bind(api); let held = true;
      const before = structuredClone(store.state.tasks);
      api.request = async (method, path, value) => {
        if (path.startsWith('/issues/35/labels?')) return new URL('https://api.github.com' + path).searchParams.get('page') === '1' ? Array.from({ length: 100 }, () => ({ name: 'ordinary' })) : held ? [{ name: label }] : [];
        return original(method, path, value);
      };
      const options = { api, sender: api, store, config, policy, verifyMain: async () => true };
      expect(await runLoop(options)).toMatchObject({ state: 'stopped' });
      expect(store.state.tasks).toEqual(before); expect(store.state.lease).toBeNull(); expect(api.writes).toHaveLength(0);
      held = false;
      expect(await runLoop(options)).toMatchObject({ state: 'waiting-cloud' }); expect(api.sends).toBe(1);
    }
  });
  it('does not mark a seed-only PR as implemented when Cloud reports tests but returns no product patch', async () => {
    const api = new API(), store = new Store();
    const options = { api, sender: api, store, config, policy, verifyMain: async () => true };
    await runLoop(options);
    const r = store.state.tasks[0]!.request as { request_key: string; head_sha: string; base_sha: string; requested_at: string };
    const report = { schema: 2, kind: 'development-result', repository, pr_number: 80, request_key: r.request_key, checkout_sha: r.head_sha, requested_base_sha: r.base_sha,
      outcome: 'succeeded', tests: [{ command: 'npm run check', exit_code: 0 }], change: { kind: 'none' }, blocker: null };
    const comment = { id: 902, user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' }, html_url: `https://github.com/${repository}/pull/80#issuecomment-902`, created_at: r.requested_at,
      body: `<!-- ais-development-result-v2:${r.request_key} -->\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n\n [View task →](https://chatgpt.com/s/cd_${'f'.repeat(32)})` };
    const original = api.request.bind(api);
    api.request = async (method, path, value) => {
      if (path.startsWith('/issues/80/comments?')) return [comment];
      if (method === 'POST' && path === '/issues/35/comments') return { id: 903 };
      return original(method, path, value);
    };
    const count = api.writes.length;
    await expect(runLoop(options)).rejects.toThrow('planned_task_not_implemented');
    expect(api.writes).toHaveLength(count); expect(store.state.tasks[0]!.phase).toBe('paused'); expect(store.state.tasks[1]!.pr).toBeNull();
  });
  it('waits for the preceding merged main to pass validation, then prepares and dispatches the next task in the same run', async () => {
    const queue = { ...config, tasks: [{ ...definition, id: 'preceding', pr: 79 }, definition] };
    const api = new API(), original = api.request.bind(api), store = new Store(queue);
    Object.assign(store.state.tasks[0]!, { phase: 'main-ci', merged: base, operation: { key: 'f'.repeat(64) } });
    api.request = async (method, path, value) => {
      if (path === '/pulls/79') return { number: 79, merged: true, merge_commit_sha: base, head: { sha: seed, repo: { full_name: repository, fork: false } }, base: { ref: 'main', repo: { full_name: repository } }, user: { login: 'silverThunder09' } };
      if (/^\/pulls\/79\/files\?/.test(path)) return [{ filename: definition.allowed_paths[0], status: 'modified' }];
      return original(method, path, value);
    };
    let validated = false;
    const options = { api, sender: api, store, config: queue, policy, verifyMain: async () => validated };
    expect(await runLoop(options)).toMatchObject({ state: 'waiting-main-ci' });
    expect(api.writes).toHaveLength(0); expect(store.state.tasks[1]!.pr).toBeNull();
    validated = true;
    expect(await runLoop(options)).toMatchObject({ state: 'waiting-cloud' });
    expect(store.state.tasks.map(t => [t.pr, t.phase])).toEqual([[79, 'completed'], [80, 'development']]);
    expect(api.sends).toBe(1);
  });
  it('records the next approval boundary once when the approved plan ends, without asking Cloud to invent more work', async () => {
    const queue = { ...config, next_decision: 'Phase 2의 전송 범위 승인 필요' }, store = new Store(queue), api = new API();
    store.state.tasks.forEach((t, i) => { t.pr = 80 + i; t.phase = 'completed'; });
    const notices: unknown[] = [], original = api.request.bind(api);
    api.request = async (method, path, value) => {
      if (method === 'POST' && path === '/issues/35/comments') { notices.push(value); return { id: 901 }; }
      if (path.startsWith('/issues/35/comments?')) return notices.map((n, i) => ({ id: 901 + i, user: { login: 'github-actions[bot]' }, body: (n as { body: string }).body }));
      return original(method, path, value);
    };
    for (let i = 0; i < 2; i++) expect(await runLoop({ api, sender: api, store, config: queue, policy })).toMatchObject({ state: 'needs-user' });
    expect(notices).toHaveLength(1); expect(api.writes).toHaveLength(0); expect(api.sends).toBe(0);
  });
});

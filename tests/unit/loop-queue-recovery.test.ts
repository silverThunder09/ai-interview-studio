import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appendApprovedTasks, emptyLoopState, LoopStore, parseLoopState, type LoopState } from '../../scripts/review/loop-coordinator.mjs';

const repository = 'silverThunder09/ai-interview-studio';
const definition = (id: string, pr: number) => ({ id, pr, goal: '검증된 큐 확장의 응답 유실·경합 복구', approval: '현재 채팅에서 승인된 자동화 계속 실행', allowed_paths: ['tests/unit/loop-queue-recovery.test.ts'] });
const previous = { schema: 1, repository, enabled: true, tasks: [definition('previous', 58)] };
const config = { ...previous, tasks: [...previous.tasks, definition('recovery', 75)] };
const sha = (digit: string) => digit.repeat(40);

function completed() {
  const state = emptyLoopState(previous);
  state.revision = 9;
  state.bootstrap = { main: sha('1'), key: 'a'.repeat(64), ready: true };
  Object.assign(state.tasks[0]!, {
    phase: 'completed',
    cycles: 2,
    merged: sha('2'),
    delivery: { phase: 'sent', hash: createHash('sha256').update('completed receipt').digest('hex'), body: 'completed receipt', id: 75 },
  });
  return state;
}

class GitHubFixture {
  state: LoopState = completed();
  head = sha('3');
  readonly calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  losePatchResponse = false;
  moveRefBeforePatch = false;
  failGetPath: string | null = null;

  async request(method: string, path: string, body: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, path, body });
    if (method === 'GET' && this.failGetPath && path.startsWith(this.failGetPath)) throw new Error('synthetic_get_failure');
    if (method === 'GET' && path.includes('/git/ref/heads/')) {
      if (this.moveRefBeforePatch && this.calls.filter(call => call.method === 'GET' && call.path.includes('/git/ref/heads/')).length === 3) this.head = sha('8');
      return { object: { sha: this.head } };
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) return { tree: { sha: sha('4') } };
    if (method === 'GET' && path.startsWith('/git/trees/')) return { truncated: false, tree: [{ path: '.automation/approved-loop.json', mode: '100644', type: 'blob', sha: sha('5') }] };
    if (method === 'GET' && path.startsWith('/git/blobs/')) {
      const content = JSON.stringify(this.state);
      return { encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') };
    }
    if (method === 'POST' && path === '/git/trees') return { sha: sha('6') };
    if (method === 'POST' && path === '/git/commits') return { sha: sha('7') };
    if (method === 'PATCH' && path.includes('/git/refs/heads/')) {
      const tree = this.calls.find(call => call.method === 'POST' && call.path === '/git/trees')!.body.tree as { content: string }[];
      this.state = JSON.parse(tree[0]!.content) as LoopState;
      this.head = String(body.sha);
      if (this.losePatchResponse) { this.losePatchResponse = false; throw new Error('synthetic_response_lost'); }
      return { object: { sha: this.head } };
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }
}

describe('queue recovery without replay', () => {
  it('keeps a persisted checkpoint intact when it is read again', () => {
    const persisted = completed();
    const received = JSON.parse(JSON.stringify(persisted));
    expect(parseLoopState(received, previous)).toEqual(persisted);
  });

  it('recognizes a committed extension after the PATCH response is lost and does not replay writes', async () => {
    const api = new GitHubFixture();
    const original = structuredClone(api.state);
    api.losePatchResponse = true;
    const store = new LoopStore(api, config);

    await expect(store.appendApprovedTasks()).rejects.toThrow('synthetic_response_lost');
    expect(api.state.tasks[0]).toEqual(original.tasks[0]);
    expect(api.state.tasks[0]!.cycles).toBe(2);
    expect(api.state.tasks[0]!.delivery).toEqual(original.tasks[0]!.delivery);
    expect(api.state.bootstrap).toEqual(original.bootstrap);
    expect(api.state.tasks[1]).toEqual(emptyLoopState(config).tasks[1]);

    const writesBeforeRetry = api.calls.filter(call => call.method === 'POST' || call.method === 'PATCH').length;
    expect(await store.appendApprovedTasks()).toBe(false);
    expect(api.calls.filter(call => call.method === 'POST' || call.method === 'PATCH')).toHaveLength(writesBeforeRetry);
  });

  it('rejects a ref that changes after tree and commit creation without PATCHing it', async () => {
    const api = new GitHubFixture();
    api.moveRefBeforePatch = true;

    await expect(new LoopStore(api, config).appendApprovedTasks()).rejects.toThrow('loop_cas_conflict');
    expect(api.calls.filter(call => call.method === 'POST').map(call => call.path)).toEqual(['/git/trees', '/git/commits']);
    expect(api.calls.filter(call => call.method === 'PATCH')).toHaveLength(0);
    expect(api.state).toEqual(completed());
  });

  it.each(['/git/ref/heads/', '/git/blobs/'])('propagates a failed state GET at %s without initialization or Cloud sends', async failGetPath => {
    const api = new GitHubFixture();
    api.failGetPath = failGetPath;

    await expect(new LoopStore(api, config).appendApprovedTasks()).rejects.toThrow('synthetic_get_failure');
    expect(api.calls.filter(call => call.method === 'POST' || call.method === 'PATCH')).toHaveLength(0);
  });

  it('uses the pure queue extension contract for the recovered state', () => {
    const old = completed();
    const next = appendApprovedTasks(old, config);
    expect(next.tasks[0]).toEqual(old.tasks[0]);
    expect(next.bootstrap).toEqual(old.bootstrap);
  });
});

it('preserves a synthetic journal above 512KiB across load and the next checkpoint', async () => {
  const api = new GitHubFixture();
  Object.assign(api.state, { retained_history: '보존'.repeat(90_000) });
  const store = new LoopStore(api, previous), old = await store.load();
  expect(Buffer.byteLength(JSON.stringify(old.state))).toBeGreaterThan(512 * 1024);
  const next = { ...structuredClone(old.state), revision: old.state.revision + 1 };
  const saved = await store.save(old, next);
  expect(saved).toMatchObject({ state: next });
  expect(api.calls.find(c => c.method === 'POST' && c.path === '/git/trees')?.body).toMatchObject({ tree: [{ content: JSON.stringify(next) }] });
});
it('rejects oversized remote journals before decoding or writing', async () => {
  const api = new GitHubFixture(), request = api.request.bind(api);
  api.request = async (method, path, body = {}) => method === 'GET' && path.startsWith('/git/blobs/')
    ? { encoding: 'base64', size: 1024 * 1024 + 1, content: Buffer.from('{}').toString('base64') }
    : request(method, path, body);
  await expect(new LoopStore(api, previous).load()).rejects.toThrow('invalid_state_blob');
  expect(api.calls.some(c => c.method !== 'GET')).toBe(false);
});
it('rejects a checkpoint crossing the UTF8 limit before any remote tree or ref write', async () => {
  const api = new GitHubFixture(), store = new LoopStore(api, previous), old = await store.load();
  const next = Object.assign(structuredClone(old.state), { revision: old.state.revision + 1, retained_history: '가'.repeat(360_000) });
  await expect(store.save(old, next)).rejects.toThrow('state_size_limit');
  expect(api.calls.some(c => c.method !== 'GET')).toBe(false);
});
it('refuses to erase a direct Cloud attempt in the real GitHub checkpoint path', async () => {
  const api = new GitHubFixture(), state = emptyLoopState(previous);
  state.bootstrap = { main: sha('1'), key: 'b'.repeat(64), ready: true };
  const body = '기존 요청';
  Object.assign(state.tasks[0]!, {
    phase: 'development', branch: 'work/test',
    request: { pr_number: 58, request_key: 'a'.repeat(64), head_sha: sha('2'), base_sha: sha('1') },
    delivery: { phase: 'sending', hash: createHash('sha256').update(body).digest('hex'), body, id: null, attempted: true },
    direct_cloud: { request_key: 'a'.repeat(64), environment: 'env_1', branch: 'work/test', phase: 'attempting', task_id: null },
  });
  api.state = state;
  const store = new LoopStore(api, previous), old = await store.load();
  const next = structuredClone(old.state); next.revision++;
  delete next.tasks[0]!.direct_cloud;
  await expect(store.save(old, next)).rejects.toThrow('direct_cloud_history_changed');
  expect(api.calls.some(c => c.method !== 'GET')).toBe(false);
});

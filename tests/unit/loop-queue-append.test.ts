import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendApprovedTasks, emptyLoopState, LoopStore, parseLoopState, type LoopState } from '../../scripts/review/loop-coordinator.mjs';

const repository = 'silverThunder09/ai-interview-studio';
const definition = (id: string, pr: number) => ({ id, pr, goal: '승인된 합성 실패 경계 검사', approval: '현재 채팅의 승인된 자동화 계속 실행 요청', allowed_paths: ['tests/unit/loop-queue-append.test.ts'] });
const before = { schema: 1, repository, enabled: true, tasks: [definition('previous', 58)] };
const after = { ...before, tasks: [...before.tasks, definition('next', 75)] };
const sha = (n: string) => n.repeat(40);
function completed() {
  const state = emptyLoopState(before); state.revision = 12;
  state.bootstrap = { main: sha('1'), key: 'a'.repeat(64), ready: true };
  Object.assign(state.tasks[0]!, { phase: 'completed', cycles: 2, merged: sha('2'), delivery: { phase: 'sent', hash: createHash('sha256').update('old receipt').digest('hex'), body: 'old receipt', id: 123 } });
  return state;
}
class StateAPI {
  state: LoopState = completed(); head = sha('3'); readonly writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  async request(method: string, path: string, body: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'GET' && path.includes('/git/ref/heads/')) return { object: { sha: this.head } };
    if (method === 'GET' && path.startsWith('/git/commits/')) return { tree: { sha: sha('4') } };
    if (method === 'GET' && path.startsWith('/git/trees/')) return { truncated: false, tree: [{ path: '.automation/approved-loop.json', mode: '100644', type: 'blob', sha: sha('5') }] };
    if (method === 'GET' && path.startsWith('/git/blobs/')) { const content = JSON.stringify(this.state); return { encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') }; }
    this.writes.push({ method, path, body });
    if (method === 'POST' && path === '/git/trees') return { sha: sha('6') };
    if (method === 'POST' && path === '/git/commits') return { sha: sha('7') };
    if (method === 'PATCH' && path.includes('/git/refs/heads/')) {
      const entry = (this.writes.find(w => w.path === '/git/trees')!.body.tree as { content: string }[])[0]!;
      this.state = JSON.parse(entry.content); this.head = String(body.sha); return { object: { sha: this.head } };
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }
}

describe('approved queue extension', () => {
  it('extends the installed completed queue with the two approved product goals without rewriting receipts', () => {
    const config = JSON.parse(readFileSync(new URL('../../.github/approved-loop.json', import.meta.url), 'utf8'));
    const previous = { ...config, tasks: config.tasks.slice(0, 5) };
    const state = emptyLoopState(previous);
    state.tasks.forEach((task, i) => Object.assign(task, { pr: task.pr ?? 90 + i, phase: 'completed', merged: sha('1'), manual_completion: { original_failure_preserved: true } }));
    const original = structuredClone(state), extended = appendApprovedTasks(state, config);
    expect(state).toEqual(original); expect(extended.tasks.slice(0, 5)).toEqual(original.tasks);
    expect(extended.tasks.slice(5).map(t => ({ id: t.id, phase: t.phase, pr: t.pr, request: t.request }))).toEqual([
      { id: 'gemini-interviewer-speaker', phase: 'queued', pr: null, request: null },
      { id: 'gemini-speaker-avatar', phase: 'queued', pr: null, request: null },
    ]);
    const specHash = createHash('sha256').update(readFileSync(new URL('../../harness/specs/gemini-local-interview.md', import.meta.url))).digest('hex');
    expect(config.tasks.slice(5).every((task: { spec: { sha256: string } }) => task.spec.sha256 === specHash)).toBe(true);
    expect(appendApprovedTasks(extended, config)).toBe(extended);
  });
  it('preserves every completed receipt and bootstrap byte and appends only queued work', () => {
    const old = completed(), original = structuredClone(old), next = appendApprovedTasks(old, after);
    expect(old).toEqual(original); expect(next.tasks.slice(0, 1)).toEqual(old.tasks);
    expect(next.bootstrap).toEqual(old.bootstrap); expect(next.revision).toBe(old.revision + 1);
    expect(next.tasks[1]).toEqual(emptyLoopState(after).tasks[1]); expect(parseLoopState(next, after)).toBe(next);
    expect(appendApprovedTasks(next, after)).toBe(next);
  });
  it('rejects changed old goals, approvals, allowed paths, reordered or removed history', () => {
    for (const patch of [{ goal: '새 기능' }, { approval: '다른 승인' }, { allowed_paths: ['src/shared/contracts.ts'] }]) {
      expect(() => appendApprovedTasks(completed(), { ...after, tasks: [{ ...before.tasks[0]!, ...patch }, after.tasks[1]] })).toThrow('invalid_loop_state');
    }
    expect(() => appendApprovedTasks(completed(), { ...after, tasks: [...after.tasks].reverse() })).toThrow();
    expect(() => appendApprovedTasks(completed(), { ...before, tasks: [] })).toThrow('invalid_queue_extension');
  });
  it('preserves paused or active work and never expires an existing lease implicitly', () => {
    for (const phase of ['paused', 'development', 'ci', 'review', 'main-ci']) {
      const state = completed(); state.tasks[0]!.phase = phase;
      expect(() => appendApprovedTasks(state, after)).toThrow('queue_extension_not_idle');
    }
    const state = completed(); state.lease = { owner: 'b'.repeat(64), until: 1 };
    expect(() => appendApprovedTasks(state, after)).toThrow('queue_extension_not_idle');
    expect(() => appendApprovedTasks(state, { ...after, tasks: [...before.tasks, { ...after.tasks[1], allowed_paths: ['.github/review-policy.json'] }] })).toThrow('unapproved_task_path');
  });
  it('persists exactly one extension with the existing parent, base tree and non-force ref', async () => {
    const api = new StateAPI(), old = structuredClone(api.state), store = new LoopStore(api, after);
    expect(await store.appendApprovedTasks()).toBe(true);
    expect((await store.load()).state.tasks.slice(0, 1)).toEqual(old.tasks);
    expect(api.writes).toHaveLength(3);
    expect(api.writes[0]!.body.base_tree).toBe(sha('4'));
    expect(api.writes[1]!.body.parents).toEqual([sha('3')]);
    expect(api.writes[2]!.body).toEqual({ sha: sha('7'), force: false });
    expect(await store.appendApprovedTasks()).toBe(false); expect(api.writes).toHaveLength(3);
  });
  it('does not write when a concurrent ref moves during the fresh comparison', async () => {
    const api = new StateAPI(), request = api.request.bind(api); let refs = 0;
    api.request = async (method, path, body) => { if (method === 'GET' && path.includes('/git/ref/heads/') && ++refs === 2) api.head = sha('8'); return request(method, path, body); };
    await expect(new LoopStore(api, after).appendApprovedTasks()).rejects.toThrow('loop_cas_conflict');
    expect(api.writes).toEqual([]); expect(api.state).toEqual(completed());
  });
});

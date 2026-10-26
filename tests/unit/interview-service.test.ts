import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InterviewService, type AsyncInterviewProvider } from '../../src/main/interview-service';
import { InterviewStore } from '../../src/main/interview-store';
import { createInterviewHandlers } from '../../src/main/interview-handlers';
import { LocalQuestionProvider, type QuestionDraft } from '../../src/main/questions';
import { startFixture } from '../fixtures/interview';

const local = new LocalQuestionProvider();
const resources: { directory: string; store: InterviewStore; service: InterviewService }[] = [];
function fixture(provider?: AsyncInterviewProvider, timeout = 30_000) {
  const directory = mkdtempSync(join(tmpdir(), 'studio-async-'));
  const store = new InterviewStore(join(directory, 'interviews.sqlite'));
  const service = provider ? new InterviewService(() => store, provider, timeout) : new InterviewService(() => store);
  resources.push({ directory, store, service });
  return { store, service, handlers: createInterviewHandlers(() => store, service) };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => {
  for (const item of resources.splice(0)) { item.service.close(); item.store.close(); rmSync(item.directory, { recursive: true, force: true }); }
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe('async generation and atomic storage', () => {
  it('previews current stored Gemini context without provider calls and rejects stale or cross-session snapshots', async () => {
    const next = vi.fn<AsyncInterviewProvider['next']>((resume, turns) => local.next(resume, turns));
    const { store, service, handlers } = fixture({ next });
    const base = startFixture(), ai = { provider: 'gemini' as const, model: 'synthetic-model', quote: base.reviewedText.slice(0, 180), transmissionConsent: true as const };
    const first = store.start({ ...base, ai }, { ...local.next(base, [])!, speakerId: 'b' }), secondBase = startFixture(), second = store.start({ ...secondBase, ai }, { ...local.next(secondBase, [])!, speakerId: 'b' });
    const request = { sessionId: first.id, questionId: first.turns[0]!.question.id, answer: '미리보기 답변' };
    const preview = service.preview(request);
    expect(preview.data).toMatchObject({ selectedQuote: ai.quote, currentAnswer: request.answer, recentCompleted: [] });
    expect(preview.digest).toMatch(/^[0-9a-f]{64}$/); expect(next).not.toHaveBeenCalled();
    await expect(service.answer({ ...request, answer: '변경한 답변', transmissionConsent: true, contextPreview: { digest: preview.digest, consent: true } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(next).not.toHaveBeenCalled();
    const saved = await service.answer({ ...request, transmissionConsent: true, contextPreview: { digest: preview.digest, consent: true } });
    expect(saved.turns[0]!.answer).toBe(request.answer);
    expect(await service.answer({ ...request, transmissionConsent: true, contextPreview: { digest: preview.digest, consent: true } })).toEqual(saved);
    await expect(service.answer({ sessionId: second.id, questionId: second.turns[0]!.question.id, answer: request.answer, transmissionConsent: true, contextPreview: { digest: preview.digest, consent: true } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(handlers.preview([{ ...request, questionId: randomUUID() }])).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(next).toHaveBeenCalledOnce();
  });
  it('rolls back a new interview when usage finalization fails and retries without a phantom session', async () => {
    const next = vi.fn<AsyncInterviewProvider['next']>(async (resume, previous, _signal, onDispatch) => {
      onDispatch?.();
      const draft = local.next(resume, previous);
      return draft ? { ...draft, usage: { promptTokenCount: 11, totalTokenCount: 13 } } : null;
    });
    const { store, service } = fixture({ next, tracksUsage: () => true });
    const base = startFixture(), request = { ...base, ai: { provider: 'gemini' as const, model: 'synthetic-model', quote: base.reviewedText.slice(0, 180), transmissionConsent: true as const } };
    const database = new DatabaseSync(store.path);
    database.exec("CREATE TRIGGER fail_usage BEFORE UPDATE ON usage_ledger WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic_usage_finish_failure'); END;");
    try {
      await expect(service.start(request)).rejects.toThrow('synthetic_usage_finish_failure');
      expect(store.history().sessions).toEqual([]);
      expect(database.prepare('SELECT status,total_tokens FROM usage_ledger').all()).toMatchObject([{ status: 'failed', total_tokens: 13 }]);
      database.exec('DROP TRIGGER fail_usage');
      const session = await service.start(request);
      expect(next).toHaveBeenCalledTimes(2); expect(store.history().sessions).toHaveLength(1);
      expect(session.usage).toMatchObject({ attempts: 1, missingAttempts: 1, tokens: { promptTokenCount: 11, totalTokenCount: 13 } });
      expect(await service.start(request)).toEqual(session); expect(next).toHaveBeenCalledTimes(2);
    } finally { database.close(); }
  });
  it('rolls back an answer and next question when usage finalization fails and preserves the known billed tokens', async () => {
    const next = vi.fn<AsyncInterviewProvider['next']>(async (resume, previous, _signal, onDispatch) => {
      onDispatch?.();
      const draft = local.next(resume, previous);
      return draft ? { ...draft, usage: { totalTokenCount: 13 } } : null;
    });
    const { store, service } = fixture({ next, tracksUsage: () => true });
    const base = startFixture(), request = { ...base, ai: { provider: 'gemini' as const, model: 'synthetic-model', quote: base.reviewedText.slice(0, 180), transmissionConsent: true as const } };
    const session = await service.start(request), answer = { sessionId: session.id, questionId: session.turns[0]!.question.id, answer: '합성 답변', transmissionConsent: true as const };
    const database = new DatabaseSync(store.path);
    database.exec("CREATE TRIGGER fail_usage BEFORE UPDATE ON usage_ledger WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic_usage_finish_failure'); END;");
    try {
      await expect(service.answer(answer)).rejects.toThrow('synthetic_usage_finish_failure');
      const unchanged = store.get(session.id);
      expect(unchanged.turns).toEqual(session.turns);
      expect(unchanged.usage).toMatchObject({ attempts: 2, missingAttempts: 2, tokens: { totalTokenCount: 26 } });
      database.exec('DROP TRIGGER fail_usage');
      const retried = await service.answer(answer);
      expect(retried.turns).toHaveLength(2); expect(retried.turns[0]!.answer).toBe(answer.answer);
      expect(retried.usage).toMatchObject({ attempts: 3, tokens: { totalTokenCount: 39 } });
      expect(await service.answer(answer)).toEqual(retried); expect(next).toHaveBeenCalledTimes(3);
    } finally { database.close(); }
  });
  it('does not open a write transaction while waiting for the first question', async () => {
    const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValue(delayed.promise);
    const { store, service } = fixture({ next }), request = startFixture();
    const pending = service.start(request); await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(store.history().sessions).toEqual([]);
    const other = new DatabaseSync(store.path); other.exec('BEGIN IMMEDIATE; ROLLBACK'); other.close();
    delayed.resolve(local.next(request, []));
    expect((await pending).turns).toHaveLength(1);
    expect(store.history().sessions).toHaveLength(1);
  });
  it('coalesces identical in-flight submissions, preserves input snapshots and replays durable retries without generation', async () => {
    const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValue(delayed.promise);
    const { store, service } = fixture({ next }), session = store.start(startFixture());
    const request = { sessionId: session.id, questionId: session.turns[0]!.question.id, answer: '합성 원본 답변' };
    const pending = service.answer(request), same = service.answer({ ...request });
    expect(same).toBe(pending);
    request.answer = '호출 후 변경';
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next.mock.calls[0]![1][0]!.answer).toBe('합성 원본 답변');
    expect(store.get(session.id)).toEqual(session);
    const other = new DatabaseSync(store.path); other.exec('BEGIN IMMEDIATE; ROLLBACK'); other.close();
    delayed.resolve(local.next(session, [{ ...session.turns[0]!, answer: '합성 원본 답변' }]));
    const saved = await pending;
    expect(saved.turns[0]!.answer).toBe('합성 원본 답변');
    expect(await service.answer({ ...request, answer: '합성 원본 답변' })).toEqual(saved);
    expect(next).toHaveBeenCalledOnce();
    await expect(service.answer(request)).rejects.toThrow('이미 저장된 답변');
    expect(next).toHaveBeenCalledOnce();
  });
  it('rejects a different request while generation is pending without issuing a second provider request', async () => {
    const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValue(delayed.promise);
    const { store, service } = fixture({ next }), request = startFixture();
    const pending = service.start(request); await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    await expect(service.start(startFixture())).rejects.toThrow('다른 질문');
    await expect(service.start({ ...request, reviewedText: '다른 내용' })).rejects.toThrow('다른 질문');
    delayed.resolve(local.next(request, [])); await pending;
    expect(store.history().sessions).toHaveLength(1); expect(next).toHaveBeenCalledOnce();
    expect((await service.start(request)).id).toBe(store.history().sessions[0]!.id); expect(next).toHaveBeenCalledOnce();
  });
  it('can cancel before dispatch without opening storage or calling a provider', async () => {
    const store = vi.fn((): InterviewStore => { throw new Error('must not open'); }), next = vi.fn<AsyncInterviewProvider['next']>();
    const service = new InterviewService(store, { next }), request = startFixture();
    const pending = service.start(request); const check = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(service.cancel(request.requestId)).toBe(true); await check;
    expect(store).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled(); service.close();
  });
  it('cancels an abort-ignoring provider, allows retry and prevents a late result from creating another session', async () => {
    const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValueOnce(delayed.promise).mockImplementation((resume, turns) => local.next(resume, turns));
    const { store, service } = fixture({ next }), request = startFixture();
    const pending = service.start(request); const check = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(service.cancel(randomUUID())).toBe(false); expect(service.cancel(request.requestId)).toBe(true); await check;
    expect(next.mock.calls[0]![2].aborted).toBe(true); expect(store.history().sessions).toEqual([]);
    const saved = await service.start(request);
    delayed.resolve(local.next(request, [])); await Promise.resolve(); await Promise.resolve();
    expect(store.history().sessions).toHaveLength(1); expect(store.get(saved.id)).toEqual(saved);
  });
  it('times out without changing the pending answer and releases timers', async () => {
    vi.useFakeTimers(); const next = vi.fn<AsyncInterviewProvider['next']>(() => new Promise(() => {}));
    const { store, handlers } = fixture({ next }, 100), session = store.start(startFixture());
    const pending = handlers.answer([{ sessionId: session.id, questionId: session.turns[0]!.question.id, answer: '보존할 답변' }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(next.mock.calls[0]![2].aborted).toBe(true); expect(store.get(session.id)).toEqual(session); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels pending generation before deleting a session or all sessions, and never resurrects records', async () => {
    for (const all of [false, true]) {
      const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValue(delayed.promise);
      const { store, service } = fixture({ next }), session = store.start(startFixture());
      const pending = service.answer({ sessionId: session.id, questionId: session.turns[0]!.question.id, answer: '합성 답변' });
      const check = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' }); await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
      if (all) service.deleteAll(); else service.delete(session.id);
      await check; delayed.resolve(local.next(session, [{ ...session.turns[0]!, answer: '합성 답변' }])); await Promise.resolve(); await Promise.resolve();
      expect(store.history().sessions).toEqual([]);
    }
  });
  it('cancels a pending start before delete-all so the late first question cannot create a record', async () => {
    const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValue(delayed.promise);
    const { store, service } = fixture({ next }), request = startFixture();
    const pending = service.start(request); const check = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce()); service.deleteAll(); await check;
    delayed.resolve(local.next(request, [])); await Promise.resolve(); await Promise.resolve(); expect(store.history().sessions).toEqual([]);
  });
  it('rolls back the answer when committing the generated question fails and permits a manual retry', async () => {
    const next = vi.fn<AsyncInterviewProvider['next']>((resume, turns) => local.next(resume, turns));
    const { store, service } = fixture({ next }), session = store.start(startFixture());
    const other = new DatabaseSync(store.path);
    other.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON turns WHEN NEW.sequence=1 BEGIN SELECT RAISE(ABORT,'synthetic private error'); END;");
    const request = { sessionId: session.id, questionId: session.turns[0]!.question.id, answer: '합성 답변' };
    await expect(service.answer(request)).rejects.toThrow(); expect(store.get(session.id)).toEqual(session);
    other.exec('DROP TRIGGER synthetic_failure'); other.close();
    expect((await service.answer(request)).turns).toHaveLength(2); expect(next).toHaveBeenCalledTimes(2);
  });
  it('sanitizes provider failures and rejects premature completion without changing stored answers', async () => {
    for (const provider of [{ next: async () => { throw new Error('synthetic-key private answer'); } }, { next: async () => null }] satisfies AsyncInterviewProvider[]) {
      const { store, handlers } = fixture(provider), session = store.start(startFixture());
      const result = await handlers.answer([{ sessionId: session.id, questionId: session.turns[0]!.question.id, answer: '합성 답변' }]);
      expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } }); expect(JSON.stringify(result)).not.toContain('synthetic-key'); expect(store.get(session.id)).toEqual(session);
    }
  });
  it('rechecks durable state after a concurrent answer commit and does not append a second question', async () => {
    const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValue(delayed.promise);
    const { store, service } = fixture({ next }), session = store.start(startFixture());
    const request = { sessionId: session.id, questionId: session.turns[0]!.question.id, answer: '합성 답변' };
    const pending = service.answer(request); await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    const concurrent = store.answer(request);
    delayed.resolve(local.next(session, [{ ...session.turns[0]!, answer: request.answer }]));
    expect(await pending).toEqual(concurrent); expect(store.get(session.id).turns).toHaveLength(2);
  });
  it('finishes the twelfth answer without asking the provider for a thirteenth question', async () => {
    const next = vi.fn<AsyncInterviewProvider['next']>((resume, turns) => local.next(resume, turns));
    const { service } = fixture({ next }); let session = await service.start(startFixture());
    for (let index = 0; index < 12; index++) session = await service.answer({ sessionId: session.id, questionId: session.turns.at(-1)!.question.id, answer: `합성 답변 ${index}` });
    expect(session.status).toBe('completed'); expect(session.turns).toHaveLength(12); expect(next).toHaveBeenCalledTimes(12);
  });
  it('cancels on shutdown and rejects future work before accessing the store', async () => {
    const delayed = deferred<QuestionDraft | null>(), next = vi.fn<AsyncInterviewProvider['next']>().mockReturnValue(delayed.promise);
    const { store, service } = fixture({ next }), request = startFixture();
    const pending = service.start(request); const check = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' }); await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    service.close(); await check; delayed.resolve(local.next(request, [])); await Promise.resolve();
    await expect(service.start(request)).rejects.toThrow('종료 중'); expect(store.history().sessions).toEqual([]);
  });
});

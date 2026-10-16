import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { InterviewStore } from '../../src/main/interview-store';
import { LocalQuestionProvider, type QuestionProvider } from '../../src/main/questions';
import { createInterviewHandlers } from '../../src/main/interview-handlers';
import { INTERVIEW_LIMITS, isDeleteAllInterviewsRequest, isDeleteInterviewRequest, isStartInterviewRequest, isSubmitAnswerRequest, type InterviewSession } from '../../src/shared/interview';
import { startFixture } from '../fixtures/interview';

const stores: InterviewStore[] = [], directories: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function path() { const dir = mkdtempSync(join(tmpdir(), 'studio-interview-')); directories.push(dir); return join(dir, 'interviews.sqlite'); }
function storage(file = path(), provider?: QuestionProvider) {
  const store = provider ? new InterviewStore(file, provider) : new InterviewStore(file); stores.push(store); return store;
}
function questionId(session: InterviewSession) { return session.turns.at(-1)!.question.id; }

describe('interview IPC input and consent', () => {
  it('accepts the bounded explicit storage request only', () => {
    const input = startFixture();
    expect(isStartInterviewRequest(input)).toBe(true);
    for (const value of [null, [], {}, { ...input, storageConsent: false }, { ...input, reviewedText: ' ' },
      { ...input, reviewedText: 'a'.repeat(100_001) }, { ...input, path: '/private' },
      { ...input, sourceSections: [{ location: '../secret', text: 'x' }] },
      { ...input, sourceSections: [{ location: '단락 1', text: 'a'.repeat(99_999) }, { location: '단락 2', text: 'b' }] },
      Object.assign(Object.create(input), { extra1: 1, extra2: 2, extra3: 3, extra4: 4 }),
    ]) expect(isStartInterviewRequest(value)).toBe(false);
  });
  it('rejects missing confirmation, invalid identifiers, blank and oversized answers', () => {
    const answer = { sessionId: randomUUID(), questionId: randomUUID(), answer: '합성 답변' };
    expect(isSubmitAnswerRequest(answer)).toBe(true);
    for (const value of [{ ...answer, answer: '' }, { ...answer, answer: '\0secret' }, { ...answer, answer: 'a'.repeat(10_001) }, { ...answer, sessionId: "'; DROP TABLE sessions" }, { ...answer, question: 'override' }]) expect(isSubmitAnswerRequest(value)).toBe(false);
    expect(isDeleteInterviewRequest({ sessionId: answer.sessionId, confirm: true })).toBe(true);
    expect(isDeleteInterviewRequest({ sessionId: answer.sessionId })).toBe(false);
    expect(isDeleteAllInterviewsRequest({ confirm: 'DELETE_ALL_INTERVIEWS' })).toBe(true);
    expect(isDeleteAllInterviewsRequest({ confirm: true })).toBe(false);
  });
  it('validates before opening any database and redacts implementation errors', () => {
    let opened = 0;
    const handlers = createInterviewHandlers(() => { opened++; throw new Error('/private/synthetic-secret'); });
    expect(handlers.start([{ ...startFixture(), storageConsent: false }])).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(handlers.history(['extra']).ok).toBe(false);
    expect(handlers.get(['../secret']).ok).toBe(false);
    expect(handlers.deleteAll([{}]).ok).toBe(false);
    expect(handlers.answer([]).ok).toBe(false);
    expect(handlers.delete([{ sessionId: randomUUID(), confirm: false }]).ok).toBe(false);
    expect(opened).toBe(0);
    const failure = handlers.history([]);
    expect(failure.ok).toBe(false);
    expect(JSON.stringify(failure)).not.toContain('synthetic-secret');
    expect(opened).toBe(1);
  });
});

describe('durable SQLite sessions and transitions', () => {
  it('creates schema, persists a session and restores its exact pending question after reopening', () => {
    const file = path(), first = storage(file);
    const started = first.start(startFixture());
    const saved = first.answer({ sessionId: started.id, questionId: questionId(started), answer: '합성 역할과 성능 개선 근거' });
    first.close(); stores.splice(stores.indexOf(first), 1);
    const restarted = storage(file);
    expect(restarted.get(saved.id)).toEqual(saved);
    expect(saved.turns[1]?.question.evidence).toEqual({ origin: 'answer', location: '1번 답변', text: '합성 역할과 성능 개선 근거' });
    expect(restarted.history().sessions).toMatchObject([{ id: saved.id, status: 'active', answered: 1 }]);
  });
  it('makes start and answer retries idempotent while rejecting conflicting retries', () => {
    const store = storage(), input = startFixture(), started = store.start(input);
    expect(store.start(input)).toEqual(started);
    expect(() => store.start({ ...input, reviewedText: '다른 합성 내용' })).toThrow('같은 시작 요청');
    const request = { sessionId: started.id, questionId: questionId(started), answer: '합성 답변' };
    const answered = store.answer(request);
    expect(store.answer(request)).toEqual(answered);
    expect(() => store.answer({ ...request, answer: '수정 시도' })).toThrow('이미 저장된 답변');
    expect(() => store.answer({ ...request, questionId: randomUUID() })).toThrow('현재 면접의 질문이 아닙니다');
    expect(store.get(started.id).turns).toHaveLength(2);
    expect(store.history().sessions).toHaveLength(1);
  });
  it('keeps question/answer order, completes at the configured end and never creates an extra question', () => {
    const store = storage(); let session = store.start(startFixture());
    for (let number = 1; number <= INTERVIEW_LIMITS.turns; number++) {
      expect(session.turns.at(-1)?.question.number).toBe(number);
      session = store.answer({ sessionId: session.id, questionId: questionId(session), answer: `합성 답변 ${number}` });
    }
    expect(session.status).toBe('completed');
    expect(session.turns).toHaveLength(12);
    expect(session.turns.every((turn) => turn.answer !== null)).toBe(true);
    expect(store.history().sessions[0]).toMatchObject({ answered: 12, status: 'completed' });
  });
  it('rolls back a failed next-question generation without losing the unsaved answer position', () => {
    const local = new LocalQuestionProvider();
    const provider: QuestionProvider = { next: (resume, previous) => { if (previous.length) throw new Error('synthetic provider failure'); return local.next(resume, previous); } };
    const store = storage(undefined, provider), started = store.start(startFixture());
    expect(() => store.answer({ sessionId: started.id, questionId: questionId(started), answer: '보존할 입력' })).toThrow('synthetic provider failure');
    expect(store.get(started.id)).toEqual(started);
  });
  it('rolls back both the answer and question when SQLite rejects the next turn', () => {
    const file = path(), store = storage(file), started = store.start(startFixture());
    const fixture = new DatabaseSync(file);
    fixture.exec("CREATE TRIGGER fail_next BEFORE INSERT ON turns WHEN NEW.sequence=1 BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;"); fixture.close();
    expect(() => store.answer({ sessionId: started.id, questionId: questionId(started), answer: '저장 실패 합성 값' })).toThrow('synthetic write failure');
    expect(store.get(started.id)).toEqual(started);
  });
  it('stores SQL-looking answers as data and deletes only the selected session with its evidence', () => {
    const file = path(), store = storage(file), first = store.start(startFixture()), second = store.start(startFixture());
    store.answer({ sessionId: first.id, questionId: questionId(first), answer: "'); DROP TABLE sessions; -- 합성" });
    store.delete(first.id);
    expect(() => store.get(first.id)).toThrow('기록이 없습니다');
    expect(store.get(second.id)).toEqual(second);
    const fixture = new DatabaseSync(file);
    expect(fixture.prepare('SELECT COUNT(*) AS count FROM turns WHERE session_id=?').get(first.id)?.count).toBe(0);
    fixture.close();
    store.deleteAll();
    expect(store.history().sessions).toEqual([]);
    const reopened = storage(file); expect(reopened.history().sessions).toEqual([]);
  });
  it('refuses a future schema and corrupt database without automatically resetting their contents', () => {
    const file = path(), future = new DatabaseSync(file);
    future.exec("CREATE TABLE preservation(value TEXT); INSERT INTO preservation VALUES('synthetic sentinel'); PRAGMA user_version=2;"); future.close();
    const before = readFileSync(file);
    expect(() => new InterviewStore(file)).toThrow('새 버전');
    expect(readFileSync(file)).toEqual(before);
    const corrupt = path(); writeFileSync(corrupt, 'synthetic corrupt database');
    expect(() => new InterviewStore(corrupt)).toThrow();
    expect(readFileSync(corrupt, 'utf8')).toBe('synthetic corrupt database');
  });
  it('caps the session count without silently evicting existing records', () => {
    const store = storage();
    for (let index = 0; index < INTERVIEW_LIMITS.sessions; index++) store.start(startFixture());
    expect(() => store.start(startFixture())).toThrow('100개까지');
    expect(store.history().sessions).toHaveLength(100);
  }, 20_000);
});

describe('local question provenance', () => {
  it('quotes a matching source and labels changed review text separately when no source matches', () => {
    const provider = new LocalQuestionProvider(), resume = startFixture();
    expect(provider.next(resume, [])?.evidence).toEqual({ origin: 'source', location: '단락 1', text: resume.reviewedText });
    expect(provider.next({ ...resume, reviewedText: '사용자가 새로 작성한 내용' }, [])?.evidence?.origin).toBe('reviewed');
  });
  it('keeps general technical questions separate from resume evidence and does not generate AI scores', () => {
    const store = storage(); let session = store.start(startFixture());
    session = store.answer({ sessionId: session.id, questionId: questionId(session), answer: '첫 답변' });
    session = store.answer({ sessionId: session.id, questionId: questionId(session), answer: '후속 답변' });
    expect(session.turns.at(-1)?.question).toMatchObject({ kind: 'technical', evidence: null });
    expect(session.mode).toBe('local-practice');
    expect(Object.keys(session)).not.toContain('score');
  });
});

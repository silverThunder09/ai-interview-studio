import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { GeminiUsageTokens, InterviewSession, SharedContextPreview, SharedContextPreviewRequest, StartInterviewRequest, SubmitAnswerRequest } from '../shared/interview';
import { buildSharedContextData, geminiQuestionRole, isSharedContextPreviewRequest, INTERVIEW_LIMITS, type SharedContextData } from '../shared/interview';
import { AIQuestionError, AI_QUESTION_LIMITS, buildAIQuestionPayload } from './ai-question-provider';
import { InterviewStoreError, type InterviewStore } from './interview-store';
import { LocalQuestionProvider, type QuestionDraft } from './questions';

export interface AsyncInterviewProvider {
  next(resume: Pick<StartInterviewRequest, 'reviewedText' | 'sourceSections' | 'ai'>, previous: InterviewSession['turns'], signal: AbortSignal, onDispatch?: () => void, context?: SharedContextData): (QuestionDraft & { usage?: GeminiUsageTokens }) | null | Promise<(QuestionDraft & { usage?: GeminiUsageTokens }) | null>;
  tracksUsage?(resume: Pick<StartInterviewRequest, 'reviewedText' | 'sourceSections' | 'ai'>): boolean;
}
interface Operation { id: string; signature: string; sessionId: string | null; controller: AbortController; promise: Promise<InterviewSession> }

// Generation happens outside SQLite transactions. The synchronous store checks
// the current request/question again when committing the complete transition.
export class InterviewService {
  private active: Operation | undefined;
  private closed = false;
  constructor(private readonly store: () => InterviewStore, private readonly provider: AsyncInterviewProvider = new LocalQuestionProvider(), private readonly timeoutMs: number = AI_QUESTION_LIMITS.timeoutMs) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > AI_QUESTION_LIMITS.timeoutMs) throw new AIQuestionError('INVALID_INPUT');
  }
  private run(id: string, request: unknown, sessionId: string | null, action: (signal: AbortSignal) => Promise<InterviewSession>): Promise<InterviewSession> {
    if (this.closed) return Promise.reject(new InterviewStoreError('앱이 종료 중입니다.'));
    const signature = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    if (this.active) {
      if (this.active.id === id && this.active.signature === signature) return this.active.promise;
      return Promise.reject(new InterviewStoreError('다른 질문을 처리 중입니다. 완료하거나 취소한 뒤 다시 시도해 주세요.'));
    }
    const controller = new AbortController();
    let reason: 'TIMEOUT' | 'CANCELLED' = 'CANCELLED';
    let rejectStop!: (error: AIQuestionError) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
    const onAbort = () => rejectStop(new AIQuestionError(reason));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { reason = 'TIMEOUT'; controller.abort(new AIQuestionError('TIMEOUT')); }, this.timeoutMs);
    const operation = { id, signature, sessionId, controller } as Operation;
    operation.promise = Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted || this.closed) throw new AIQuestionError('CANCELLED');
      return action(controller.signal);
    }), stopped]).finally(() => {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
      if (this.active === operation) this.active = undefined;
    });
    this.active = operation;
    return operation.promise;
  }
  start(value: StartInterviewRequest): Promise<InterviewSession> {
    const request = structuredClone(value);
    return this.run(request.requestId, request, null, async (signal) => {
      const store = this.store();
      const existing = store.findStart(request);
      if (existing) return existing;
      const tracking = this.provider.tracksUsage?.(request) === true;
      if (tracking) store.checkUsageCapacity();
      let usage: string | undefined;
      const onDispatch = tracking ? () => { const id = randomUUID(); store.reserveUsage(id, null); usage = id; } : undefined;
      let question;
      try { question = await this.provider.next(structuredClone(request), [], signal, onDispatch); }
      catch (error) { if (usage) store.finishUsage(usage, error instanceof AIQuestionError && error.code === 'CANCELLED' ? 'cancelled' : error instanceof AIQuestionError && error.code === 'TIMEOUT' ? 'timeout' : 'failed', error instanceof AIQuestionError ? error.usage : undefined); throw error; }
      if (signal.aborted || this.closed) { const error = signal.reason instanceof AIQuestionError ? signal.reason : new AIQuestionError('CANCELLED'); if (usage) store.finishUsage(usage, error.code === 'TIMEOUT' ? 'timeout' : 'cancelled', question?.usage); throw error; }
      if (!question) throw new Error('Missing first question');
      let saved;
      try { saved = store.start(request, question, usage ? { attemptId: usage, ...(question.usage ? { tokens: question.usage } : {}) } : undefined); }
      catch (error) { if (usage) store.finishUsage(usage, 'failed', question.usage); throw error; }
      return saved;
    });
  }
  preview(value: SharedContextPreviewRequest): SharedContextPreview {
    if (this.closed || !isSharedContextPreviewRequest(value)) throw new AIQuestionError('INVALID_INPUT');
    const session = this.store().get(value.sessionId);
    if (session.status !== 'active' || session.ai?.provider !== 'gemini') throw new AIQuestionError('INVALID_INPUT');
    const current = session.turns.find(turn => turn.answer === null);
    if (!current || current.question.number >= INTERVIEW_LIMITS.turns || current.question.id !== value.questionId) throw new AIQuestionError('INVALID_INPUT');
    const nextRole = geminiQuestionRole(current.question.number + 1);
    const role = nextRole.kind === 'follow-up' && current.question.speakerId ? { ...nextRole, speakerId: current.question.speakerId } : nextRole;
    let data;
    try { data = buildSharedContextData(session.ai.quote, session.turns, value.answer); }
    catch { throw new AIQuestionError('INVALID_INPUT'); }
    buildAIQuestionPayload({ questionNumber: current.question.number + 1, ...role,
      evidence: role.kind === 'experience' ? [{ origin: 'reviewed', location: '사용자 선택 구절', text: session.ai.quote }] : [],
      answer: role.kind === 'follow-up' ? value.answer : null, context: data });
    const canonical = JSON.stringify({ sessionId: session.id, questionId: current.question.id, role, ai: session.ai, data });
    return { sessionId: session.id, questionId: current.question.id, role, data, digest: createHash('sha256').update(canonical).digest('hex') };
  }
  answer(value: SubmitAnswerRequest): Promise<InterviewSession> {
    const request = structuredClone(value);
    return this.run(request.questionId, request, request.sessionId, async (signal) => {
      const store = this.store();
      const { session, pending } = store.prepareAnswer(request);
      if (!pending) return session;
      let context: SharedContextData | undefined;
      if (request.contextPreview) {
        const preview = this.preview({ sessionId: request.sessionId, questionId: request.questionId, answer: request.answer });
        if (preview.digest !== request.contextPreview.digest) throw new AIQuestionError('INVALID_INPUT');
        context = preview.data;
      }
      session.turns.at(-1)!.answer = request.answer;
      const tracking = session.turns.length < INTERVIEW_LIMITS.turns && this.provider.tracksUsage?.(session) === true;
      if (tracking) store.checkUsageCapacity();
      let usage: string | undefined;
      const onDispatch = tracking ? () => { const id = randomUUID(); store.reserveUsage(id, session.id); usage = id; } : undefined;
      let next;
      try { next = session.turns.length === INTERVIEW_LIMITS.turns ? null : await this.provider.next(structuredClone(session), structuredClone(session.turns), signal, onDispatch, context ? structuredClone(context) : undefined); }
      catch (error) { if (usage) store.finishUsage(usage, error instanceof AIQuestionError && error.code === 'CANCELLED' ? 'cancelled' : error instanceof AIQuestionError && error.code === 'TIMEOUT' ? 'timeout' : 'failed', error instanceof AIQuestionError ? error.usage : undefined); throw error; }
      if (signal.aborted || this.closed) { const error = signal.reason instanceof AIQuestionError ? signal.reason : new AIQuestionError('CANCELLED'); if (usage) store.finishUsage(usage, error.code === 'TIMEOUT' ? 'timeout' : 'cancelled', next?.usage); throw error; }
      if (!next && session.turns.length < INTERVIEW_LIMITS.turns) throw new Error('Missing next question');
      let saved;
      try { saved = store.answer(request, { next }, usage ? { attemptId: usage, ...(next?.usage ? { tokens: next.usage } : {}) } : undefined); }
      catch (error) { if (usage) store.finishUsage(usage, 'failed', next?.usage); throw error; }
      return saved;
    });
  }
  cancel(id: string): boolean {
    if (!this.active || this.active.id !== id) return false;
    const operation = this.active;
    this.active = undefined; operation.controller.abort(new AIQuestionError('CANCELLED'));
    return true;
  }
  cancelPending(): void { if (this.active) this.cancel(this.active.id); }
  delete(id: string): void { if (this.active?.sessionId === id) this.cancelPending(); this.store().delete(id); }
  deleteAll(): void { this.cancelPending(); this.store().deleteAll(); }
  close(): void { this.closed = true; this.cancelPending(); }
}

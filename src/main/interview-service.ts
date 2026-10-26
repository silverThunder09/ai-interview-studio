import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { GeminiUsageTokens, InterviewSession, StartInterviewRequest, SubmitAnswerRequest } from '../shared/interview';
import { INTERVIEW_LIMITS } from '../shared/interview';
import { AIQuestionError, AI_QUESTION_LIMITS } from './ai-question-provider';
import { InterviewStoreError, type InterviewStore } from './interview-store';
import { LocalQuestionProvider, type QuestionDraft } from './questions';

export interface AsyncInterviewProvider {
  next(resume: Pick<StartInterviewRequest, 'reviewedText' | 'sourceSections' | 'ai'>, previous: InterviewSession['turns'], signal: AbortSignal): (QuestionDraft & { usage?: GeminiUsageTokens }) | null | Promise<(QuestionDraft & { usage?: GeminiUsageTokens }) | null>;
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
    const timer = setTimeout(() => { reason = 'TIMEOUT'; controller.abort(); }, this.timeoutMs);
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
      const usage = this.provider.tracksUsage?.(request) === true ? randomUUID() : undefined;
      if (usage) store.reserveUsage(usage, null);
      let question;
      try { question = await this.provider.next(structuredClone(request), [], signal); }
      catch (error) { if (usage) store.finishUsage(usage, error instanceof AIQuestionError && error.code === 'CANCELLED' ? 'cancelled' : error instanceof AIQuestionError && error.code === 'TIMEOUT' ? 'timeout' : 'failed'); throw error; }
      if (signal.aborted || this.closed) { if (usage) store.finishUsage(usage, 'cancelled'); throw new AIQuestionError('CANCELLED'); }
      if (!question) throw new Error('Missing first question');
      let saved;
      try { saved = store.start(request, question); }
      catch (error) { if (usage) store.finishUsage(usage, 'failed'); throw error; }
      if (usage) store.finishUsage(usage, 'succeeded', question.usage, saved.id);
      return store.get(saved.id);
    });
  }
  answer(value: SubmitAnswerRequest): Promise<InterviewSession> {
    const request = structuredClone(value);
    return this.run(request.questionId, request, request.sessionId, async (signal) => {
      const store = this.store();
      const { session, pending } = store.prepareAnswer(request);
      if (!pending) return session;
      session.turns.at(-1)!.answer = request.answer;
      const usage = session.turns.length < INTERVIEW_LIMITS.turns && this.provider.tracksUsage?.(session) === true ? randomUUID() : undefined;
      if (usage) store.reserveUsage(usage, session.id);
      let next;
      try { next = session.turns.length === INTERVIEW_LIMITS.turns ? null : await this.provider.next(structuredClone(session), structuredClone(session.turns), signal); }
      catch (error) { if (usage) store.finishUsage(usage, error instanceof AIQuestionError && error.code === 'CANCELLED' ? 'cancelled' : error instanceof AIQuestionError && error.code === 'TIMEOUT' ? 'timeout' : 'failed'); throw error; }
      if (signal.aborted || this.closed) { if (usage) store.finishUsage(usage, 'cancelled'); throw new AIQuestionError('CANCELLED'); }
      if (!next && session.turns.length < INTERVIEW_LIMITS.turns) throw new Error('Missing next question');
      let saved;
      try { saved = store.answer(request, { next }); }
      catch (error) { if (usage) store.finishUsage(usage, 'failed'); throw error; }
      if (usage) store.finishUsage(usage, 'succeeded', next?.usage, session.id);
      return store.get(saved.id);
    });
  }
  cancel(id: string): boolean {
    if (!this.active || this.active.id !== id) return false;
    const operation = this.active;
    this.active = undefined; operation.controller.abort();
    return true;
  }
  cancelPending(): void { if (this.active) this.cancel(this.active.id); }
  delete(id: string): void { if (this.active?.sessionId === id) this.cancelPending(); this.store().delete(id); }
  deleteAll(): void { this.cancelPending(); this.store().deleteAll(); }
  close(): void { this.closed = true; this.cancelPending(); }
}

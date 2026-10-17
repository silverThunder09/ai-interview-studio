import { createHash } from 'node:crypto';
import type { InterviewSession, StartInterviewRequest, SubmitAnswerRequest } from '../shared/interview';
import { INTERVIEW_LIMITS } from '../shared/interview';
import { AIQuestionError, AI_QUESTION_LIMITS } from './ai-question-provider';
import { InterviewStoreError, type InterviewStore } from './interview-store';
import { LocalQuestionProvider, type QuestionDraft } from './questions';

export interface AsyncInterviewProvider {
  next(resume: Pick<StartInterviewRequest, 'reviewedText' | 'sourceSections'>, previous: InterviewSession['turns'], signal: AbortSignal): QuestionDraft | null | Promise<QuestionDraft | null>;
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
      const question = await this.provider.next(structuredClone(request), [], signal);
      if (signal.aborted || this.closed) throw new AIQuestionError('CANCELLED');
      if (!question) throw new Error('Missing first question');
      return store.start(request, question);
    });
  }
  answer(value: SubmitAnswerRequest): Promise<InterviewSession> {
    const request = structuredClone(value);
    return this.run(request.questionId, request, request.sessionId, async (signal) => {
      const store = this.store();
      const { session, pending } = store.prepareAnswer(request);
      if (!pending) return session;
      session.turns.at(-1)!.answer = request.answer;
      const next = session.turns.length === INTERVIEW_LIMITS.turns ? null : await this.provider.next(structuredClone(session), structuredClone(session.turns), signal);
      if (signal.aborted || this.closed) throw new AIQuestionError('CANCELLED');
      if (!next && session.turns.length < INTERVIEW_LIMITS.turns) throw new Error('Missing next question');
      return store.answer(request, { next });
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

import type { Result } from '../shared/contracts';
import { isDeleteAllInterviewsRequest, isDeleteInterviewRequest, isInterviewId, isStartInterviewRequest, isSubmitAnswerRequest } from '../shared/interview';
import { InterviewStoreError, type InterviewStore } from './interview-store';
import { InterviewService } from './interview-service';
import { AIQuestionError } from './ai-question-provider';

export function createInterviewHandlers(store: () => InterviewStore, service = new InterviewService(store)) {
  const invalid = (): Result<never> => ({ ok: false, error: { code: 'INVALID_REQUEST', message: '면접 요청 형식이나 저장 동의를 확인해 주세요.' } });
  const failure = (error: unknown): Result<never> => {
    if (error instanceof AIQuestionError) {
      const code = error.code === 'INVALID_INPUT' ? 'INVALID_REQUEST' : error.code === 'INVALID_RESPONSE' ? 'UNAVAILABLE' : error.code;
      return { ok: false, error: { code, message: new AIQuestionError(error.code).message } };
    }
    return { ok: false, error: { code: 'UNAVAILABLE', message: error instanceof InterviewStoreError ? error.message : '기록 저장소나 질문 생성에 접근하지 못했습니다. 저장 공간·권한을 확인하고 다시 시도해 주세요. 기존 파일을 자동 초기화하지 않습니다.' } };
  };
  const perform = <T>(action: () => T): Result<T> => {
    try { return { ok: true, value: action() }; }
    catch (error) { return failure(error); }
  };
  const performAsync = async <T>(action: () => Promise<T>): Promise<Result<T>> => {
    try { return { ok: true, value: await action() }; } catch (error) { return failure(error); }
  };
  return {
    history(args: unknown[]) { return args.length ? invalid() : perform(() => store().history()); },
    get(args: unknown[]) { return args.length !== 1 || !isInterviewId(args[0]) ? invalid() : perform(() => store().get(args[0] as string)); },
    async start(args: unknown[]) {
      const request = args[0];
      return args.length !== 1 || !isStartInterviewRequest(request) ? invalid() : performAsync(() => service.start(request));
    },
    async answer(args: unknown[]) {
      const request = args[0];
      return args.length !== 1 || !isSubmitAnswerRequest(request) ? invalid() : performAsync(() => service.answer(request));
    },
    cancel(args: unknown[]) { return args.length !== 1 || !isInterviewId(args[0]) ? invalid() : perform(() => service.cancel(args[0] as string)); },
    delete(args: unknown[]) {
      const request = args[0];
      return args.length !== 1 || !isDeleteInterviewRequest(request) ? invalid() : perform(() => { service.delete(request.sessionId); return null; });
    },
    deleteAll(args: unknown[]) {
      return args.length !== 1 || !isDeleteAllInterviewsRequest(args[0]) ? invalid() : perform(() => { service.deleteAll(); return null; });
    },
    cancelPending: () => service.cancelPending(),
    close: () => service.close(),
  };
}

import type { Result } from '../shared/contracts';
import { isDeleteAllInterviewsRequest, isDeleteInterviewRequest, isInterviewId, isStartInterviewRequest, isSubmitAnswerRequest } from '../shared/interview';
import { InterviewStoreError, type InterviewStore } from './interview-store';

export function createInterviewHandlers(store: () => InterviewStore) {
  const invalid = (): Result<never> => ({ ok: false, error: { code: 'INVALID_REQUEST', message: '면접 요청 형식이나 저장 동의를 확인해 주세요.' } });
  const perform = <T>(action: () => T): Result<T> => {
    try { return { ok: true, value: action() }; }
    catch (error) { return { ok: false, error: { code: 'UNAVAILABLE', message: error instanceof InterviewStoreError ? error.message : '기록 저장소에 접근하지 못했습니다. 저장 공간·권한을 확인하고 다시 시도해 주세요. 기존 파일을 자동 초기화하지 않습니다.' } }; }
  };
  return {
    history(args: unknown[]) { return args.length ? invalid() : perform(() => store().history()); },
    get(args: unknown[]) { return args.length !== 1 || !isInterviewId(args[0]) ? invalid() : perform(() => store().get(args[0] as string)); },
    start(args: unknown[]) {
      const request = args[0];
      return args.length !== 1 || !isStartInterviewRequest(request) ? invalid() : perform(() => store().start(request));
    },
    answer(args: unknown[]) {
      const request = args[0];
      return args.length !== 1 || !isSubmitAnswerRequest(request) ? invalid() : perform(() => store().answer(request));
    },
    delete(args: unknown[]) {
      const request = args[0];
      return args.length !== 1 || !isDeleteInterviewRequest(request) ? invalid() : perform(() => { store().delete(request.sessionId); return null; });
    },
    deleteAll(args: unknown[]) {
      return args.length !== 1 || !isDeleteAllInterviewsRequest(args[0]) ? invalid() : perform(() => { store().deleteAll(); return null; });
    },
  };
}

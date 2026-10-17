import type { Result } from '../shared/contracts';
import { isInterviewId } from '../shared/interview';
import { isSpeechRequest, SPEECH_ENDPOINT, SPEECH_LIMITS, type SpeechRequest } from '../shared/speech';
import type { AICredentials } from './external-ai';
import type { InterviewStore } from './interview-store';
import { isMP3 } from './speech-mp3';

type Code = Extract<Result<never>, { ok: false }>['error']['code'];
const messages: Record<Code, string> = {
  INVALID_REQUEST: '현재 질문·전송 미리보기·모델·음성·동의를 확인해 주세요. 질문은 최대 1,500자입니다.',
  UNAUTHORIZED: '허용되지 않은 음성 읽기 요청입니다.',
  UNAVAILABLE: '질문 음성을 생성하지 못했습니다. 모델·음성 지원 여부를 확인하고 직접 다시 시도하세요. 질문과 답변은 유지됩니다.',
  CANCELLED: '질문 음성 생성을 취소했습니다.', TIMEOUT: '질문 음성 생성 시간이 초과되었습니다. 직접 다시 시도해 주세요.',
  RATE_LIMITED: '음성 생성 서비스의 요청 한도에 도달했습니다. 잠시 후 직접 다시 시도해 주세요.',
  BUDGET_EXHAUSTED: '이번 실행의 질문 음성 생성 36회를 모두 사용했습니다. 서비스 사용량·예산을 확인해 주세요. 키 재등록은 한도를 초기화하지 않습니다.',
  AUTHENTICATION: 'OpenAI 키와 음성 모델 접근 권한을 확인해 주세요.',
};
class SpeechError extends Error { constructor(readonly code: Code) { super(messages[code]); } }
function failure(error: unknown): Result<never> { const code = error instanceof SpeechError ? error.code : 'UNAVAILABLE'; return { ok: false, error: { code, message: messages[code] } }; }
export class SpeechService {
  private pending: { id: string; fingerprint: string; controller: AbortController; promise: Promise<Result<Uint8Array>> } | undefined;
  private cache: { id: string; fingerprint: string; audio: Uint8Array } | undefined;
  private used = 0;
  constructor(private readonly store: () => InterviewStore, private readonly credentials: AICredentials,
    private readonly request: typeof fetch = (...args) => fetch(...args), private readonly timeoutMs: number = SPEECH_LIMITS.timeoutMs) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SPEECH_LIMITS.timeoutMs) throw new SpeechError('INVALID_REQUEST');
  }
  status() { return { remainingRequests: SPEECH_LIMITS.requests - this.used }; }
  private current(value: SpeechRequest): void {
    const session = this.store().get(value.sessionId), question = session.turns.find(t => t.answer === null)?.question;
    if (session.status !== 'active' || question?.id !== value.questionId || question.text !== value.preview) throw new SpeechError('INVALID_REQUEST');
  }
  cancel(id?: string): void {
    if (id === undefined || this.cache?.id === id) this.cache = undefined;
    if (id === undefined || this.pending?.id === id) { const pending = this.pending; this.pending = undefined; pending?.controller.abort(); }
  }
  generate(input: unknown): Promise<Result<Uint8Array>> {
    try {
      if (!isSpeechRequest(input)) throw new SpeechError('INVALID_REQUEST');
      const value = { ...input }; this.current(value);
      const fingerprint = JSON.stringify(value);
      if (this.pending) {
        if (this.pending.id === value.operationId && this.pending.fingerprint === fingerprint) return this.pending.promise;
        throw new SpeechError('INVALID_REQUEST');
      }
      if (this.cache?.id === value.operationId) {
        if (this.cache.fingerprint !== fingerprint) throw new SpeechError('INVALID_REQUEST');
        return Promise.resolve({ ok: true, value: new Uint8Array(this.cache.audio) });
      }
      let key: string;
      try { key = this.credentials.keyForAudio(); } catch { throw new SpeechError('AUTHENTICATION'); }
      if (this.used >= SPEECH_LIMITS.requests) throw new SpeechError('BUDGET_EXHAUSTED');
      this.used++; this.cache = undefined;
      const controller = new AbortController();
      const promise = this.perform(value, key, controller, fingerprint);
      this.pending = { id: value.operationId, fingerprint, controller, promise };
      return promise;
    } catch (error) { return Promise.resolve(failure(error)); }
  }
  private async perform(value: SpeechRequest, key: string, controller: AbortController, fingerprint: string): Promise<Result<Uint8Array>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remove = () => {};
    try {
      const stopped = new Promise<never>((_resolve, reject) => {
        const cancel = () => reject(new SpeechError('CANCELLED')); controller.signal.addEventListener('abort', cancel, { once: true });
        remove = () => controller.signal.removeEventListener('abort', cancel);
        timer = setTimeout(() => { reject(new SpeechError('TIMEOUT')); controller.abort(); }, this.timeoutMs);
      });
      const operation = async () => {
        if (controller.signal.aborted) throw new SpeechError('CANCELLED');
        const response = await this.request(SPEECH_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: value.model, voice: value.voice, input: value.preview, response_format: 'mp3' }), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new SpeechError(response.status === 429 ? 'RATE_LIMITED' : [401,403].includes(response.status) ? 'AUTHENTICATION' : 'UNAVAILABLE'); }
        if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'audio/mpeg' || !response.body) { void response.body?.cancel().catch(() => {}); throw new SpeechError('UNAVAILABLE'); }
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          while (true) {
            if (controller.signal.aborted) throw new SpeechError('CANCELLED');
            const item = await reader.read(); if (item.done) break;
            size += item.value.byteLength; if (size > SPEECH_LIMITS.bytes) throw new SpeechError('UNAVAILABLE'); chunks.push(item.value);
          }
          const audio = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
          if (!isMP3(audio)) throw new SpeechError('UNAVAILABLE');
          return audio;
        } finally { controller.signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
      };
      const audio = await Promise.race([Promise.resolve().then(operation), stopped]);
      if (controller.signal.aborted || this.pending?.controller !== controller) throw new SpeechError('CANCELLED');
      this.current(value); this.cache = { id: value.operationId, fingerprint, audio: new Uint8Array(audio) };
      return { ok: true, value: audio };
    } catch (error) { return failure(error); }
    finally { clearTimeout(timer); remove(); if (this.pending?.controller === controller) this.pending = undefined; }
  }
}
export function createSpeechHandlers(service: SpeechService) {
  const invalid = () => failure(new SpeechError('INVALID_REQUEST'));
  return {
    generate: (args: unknown[]) => args.length === 1 ? service.generate(args[0]) : invalid(),
    cancel(args: unknown[]) { if (args.length !== 1 || !isInterviewId(args[0])) return invalid(); service.cancel(args[0]); return { ok: true, value: null } as const; },
    status: (args: unknown[]) => args.length ? invalid() : { ok: true, value: service.status() } as const,
  };
}

import { isInterviewId } from '../shared/interview';
import { isVoiceRequest, isVoiceStart, VOICE_ENDPOINT, VOICE_LIMITS, type VoiceStart, type VoiceStatus } from '../shared/voice';
import type { Result } from '../shared/contracts';
import type { AICredentials } from './external-ai';
import type { InterviewStore } from './interview-store';
import { isOpusWebM } from './voice-webm';

type Code = Extract<Result<never>, { ok: false }>['error']['code'];
const messages: Record<Code, string> = {
  INVALID_REQUEST: '음성 입력의 녹음·모델·동의·현재 질문을 확인해 주세요.', UNAUTHORIZED: '허용되지 않은 음성 요청입니다.',
  UNAVAILABLE: '음성 전사를 완료하지 못했습니다. 기존 답변은 유지됩니다. 직접 다시 시도하거나 텍스트로 입력하세요.',
  CANCELLED: '음성 입력을 취소했습니다.', TIMEOUT: '음성 전사 시간이 초과되었습니다. 직접 다시 시도해 주세요.',
  RATE_LIMITED: '음성 서비스의 요청 한도에 도달했습니다. 잠시 후 직접 다시 시도해 주세요.',
  BUDGET_EXHAUSTED: '이번 실행의 음성 전사 36회를 모두 사용했습니다. 서비스 사용량·예산을 확인해 주세요. 키 재등록은 한도를 초기화하지 않습니다.',
  AUTHENTICATION: 'OpenAI 음성 전사 키와 모델 접근 권한을 확인해 주세요.',
};
class VoiceError extends Error { constructor(readonly code: Code) { super(messages[code]); } }
function failure(error: unknown): Result<never> { const code = error instanceof VoiceError ? error.code : 'UNAVAILABLE'; return { ok: false, error: { code, message: messages[code] } }; }

export class VoiceService {
  private active: (VoiceStart & { permissionUntil: number; requested: boolean }) | undefined;
  private pending: AbortController | undefined;
  private used = 0;
  constructor(private readonly store: () => InterviewStore, private readonly credentials: AICredentials,
    private readonly request: typeof fetch = (...args) => fetch(...args), private readonly timeoutMs: number = VOICE_LIMITS.timeoutMs) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > VOICE_LIMITS.timeoutMs) throw new VoiceError('INVALID_REQUEST');
  }
  status(): VoiceStatus { return { remainingRequests: VOICE_LIMITS.requests - this.used }; }
  private current(start: VoiceStart): void {
    const session = this.store().get(start.sessionId);
    if (session.status !== 'active' || session.turns.find(t => t.answer === null)?.question.id !== start.questionId) throw new VoiceError('INVALID_REQUEST');
  }
  allows(permission: string, url: string | undefined, mainFrame: boolean, media: string[] | undefined, entry: string, request: boolean): boolean {
    const active = this.active;
    if (!active || this.pending || permission !== 'media' || url !== entry || !mainFrame ||
      !media || media.length !== 1 || media[0] !== 'audio' || Date.now() > active.permissionUntil || (request && active.requested)) return false;
    if (request) active.requested = true;
    return true;
  }
  begin(value: unknown): Result<null> {
    try {
      if (!isVoiceStart(value) || this.active) throw new VoiceError('INVALID_REQUEST');
      this.current(value); this.active = { ...value, permissionUntil: Date.now() + 15_000, requested: false };
      return { ok: true, value: null };
    } catch (error) { return failure(error); }
  }
  stop(id: unknown): Result<null> {
    if (!isInterviewId(id) || this.active?.operationId !== id) return failure(new VoiceError('INVALID_REQUEST'));
    this.active.permissionUntil = 0; return { ok: true, value: null };
  }
  cancel(id?: string): void {
    if (id !== undefined && this.active?.operationId !== id) return;
    this.active = undefined; this.pending?.abort(); this.pending = undefined;
  }
  async transcribe(value: unknown): Promise<Result<string>> {
    let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort = () => {};
    try {
      if (!isVoiceRequest(value) || !this.active || this.active.operationId !== value.operationId || this.pending || this.active.permissionUntil !== 0 || !isOpusWebM(value.audio)) throw new VoiceError('INVALID_REQUEST');
      const active = this.active; this.current(active);
      let key: string;
      try { key = this.credentials.keyForTranscription(); } catch { throw new VoiceError('AUTHENTICATION'); }
      if (this.used >= VOICE_LIMITS.requests) throw new VoiceError('BUDGET_EXHAUSTED');
      this.used++; controller = new AbortController(); this.pending = controller;
      const abort = controller;
      const stopped = new Promise<never>((_resolve, reject) => {
        const cancel = () => reject(new VoiceError('CANCELLED'));
        abort.signal.addEventListener('abort', cancel, { once: true }); removeAbort = () => abort.signal.removeEventListener('abort', cancel);
        timer = setTimeout(() => { reject(new VoiceError('TIMEOUT')); abort.abort(); }, this.timeoutMs);
      });
      const operation = async () => {
        if (abort.signal.aborted) throw new VoiceError('CANCELLED');
        const body = new FormData();
        body.set('file', new Blob([new Uint8Array(value.audio)], { type: 'audio/webm' }), 'answer.webm');
        body.set('model', value.model); body.set('language', 'ko'); body.set('response_format', 'json');
        const response = await this.request(VOICE_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body, signal: abort.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new VoiceError(response.status === 429 ? 'RATE_LIMITED' : [401, 403].includes(response.status) ? 'AUTHENTICATION' : 'UNAVAILABLE'); }
        if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new VoiceError('UNAVAILABLE');
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        const cancel = () => { void reader.cancel().catch(() => {}); };
        abort.signal.addEventListener('abort', cancel, { once: true });
        let text = '', size = 0;
        try {
          while (true) {
            if (abort.signal.aborted) throw new VoiceError('CANCELLED');
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength; if (size > VOICE_LIMITS.responseBytes) throw new VoiceError('UNAVAILABLE');
            text += decoder.decode(chunk.value, { stream: true });
          }
          const result: unknown = JSON.parse(text + decoder.decode());
          if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string' ||
            !result.text.trim() || result.text.includes('\0') || result.text.length > 16_000) throw new VoiceError('UNAVAILABLE');
          return result.text;
        } finally { abort.signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
      };
      const text = await Promise.race([Promise.resolve().then(operation), stopped]);
      if (abort.signal.aborted || this.active !== active) throw new VoiceError('CANCELLED');
      this.current(active);
      this.active = undefined;
      return { ok: true, value: text };
    } catch (error) { return failure(error); }
    finally { clearTimeout(timer); removeAbort(); if (controller && this.pending === controller) this.pending = undefined; }
  }
}

export function createVoiceHandlers(service: VoiceService) {
  const invalid = () => failure(new VoiceError('INVALID_REQUEST'));
  return {
    begin: (args: unknown[]) => args.length === 1 ? service.begin(args[0]) : invalid(),
    stop: (args: unknown[]) => args.length === 1 ? service.stop(args[0]) : invalid(),
    transcribe: (args: unknown[]) => args.length === 1 ? service.transcribe(args[0]) : invalid(),
    cancel(args: unknown[]) { if (args.length !== 1 || !isInterviewId(args[0])) return invalid(); service.cancel(args[0]); return { ok: true, value: null } as const; },
    status: (args: unknown[]) => args.length ? invalid() : { ok: true, value: service.status() } as const,
  };
}

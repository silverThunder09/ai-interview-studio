import type { Result } from '../shared/contracts';
import { isInterviewId } from '../shared/interview';
import { isSpeechRequest, SPEECH_LIMITS, type SpeechRequest, type SpeechStatus } from '../shared/local-speech';
import type { InterviewStore } from './interview-store';
import { WindowsSpeechAdapter, type SpeechProcess } from './windows-speech';
type Code = Extract<Result<never>, { ok: false }>['error']['code'];
const message: Record<Code, string> = { INVALID_REQUEST: '현재 질문과 발언자·설치된 한국어 음성을 확인해 주세요.', UNAUTHORIZED: '허용되지 않은 음성 요청입니다.', UNAVAILABLE: 'Windows 로컬 음성을 확인하거나 생성하지 못했습니다. 텍스트 질문으로 계속하세요.', CANCELLED: '질문 음성 생성을 취소했습니다.', TIMEOUT: '로컬 음성 생성 시간이 초과되었습니다.', RATE_LIMITED: '사용할 수 없습니다.', BUDGET_EXHAUSTED: '사용할 수 없습니다.', AUTHENTICATION: '사용할 수 없습니다.' };
class SpeechError extends Error { constructor(readonly code: Code) { super(message[code]); } }
const failure = (error: unknown): Result<never> => { const code = error instanceof SpeechError ? error.code : 'UNAVAILABLE'; return { ok: false, error: { code, message: message[code] } }; };
export class LocalSpeechService {
  private pending: { id: string; fingerprint: string; job: SpeechProcess; promise: Promise<Result<Uint8Array>> } | undefined;
  private cache: { id: string; fingerprint: string; audio: Uint8Array } | undefined;
  private voiceCache: Promise<SpeechStatus> | undefined;
  private epoch = 0;
  constructor(private readonly store: () => InterviewStore, private readonly adapter = new WindowsSpeechAdapter(), private readonly timeoutMs = SPEECH_LIMITS.timeoutMs) {}
  status(): Promise<SpeechStatus> {
    if (!this.voiceCache) {
      const pending = this.adapter.voices().then(voices => ({ available: voices.length > 0, voices }));
      this.voiceCache = pending;
      void pending.catch(() => { if (this.voiceCache === pending) this.voiceCache = undefined; });
    }
    return this.voiceCache;
  }
  private current(value: SpeechRequest) { const session = this.store().get(value.sessionId), question = session.turns.find(t => t.answer === null)?.question; if (session.status !== 'active' || question?.id !== value.questionId || question.text !== value.preview || (question.speakerId ?? (question.kind === 'technical' ? 'a' : 'b')) !== value.speakerId) throw new SpeechError('INVALID_REQUEST'); }
  private pendingNow() { return this.pending; }
  cancel(id?: string) { this.epoch++; if (!id || this.cache?.id === id) this.cache = undefined; if (!id || this.pending?.id === id) { const pending = this.pending; this.pending = undefined; pending?.job.cancel(); } }
  async generate(input: unknown): Promise<Result<Uint8Array>> {
    try {
      if (!isSpeechRequest(input)) throw new SpeechError('INVALID_REQUEST'); this.current(input); const fingerprint = JSON.stringify(input), epoch = this.epoch;
      if (this.pending) { if (this.pending.id === input.operationId && this.pending.fingerprint === fingerprint) return this.pending.promise; throw new SpeechError('INVALID_REQUEST'); }
      if (this.cache?.id === input.operationId) return this.cache.fingerprint === fingerprint ? { ok: true, value: new Uint8Array(this.cache.audio) } : failure(new SpeechError('INVALID_REQUEST'));
      const voices = await this.status(); if (epoch !== this.epoch) throw new SpeechError('CANCELLED'); if (!voices.voices.some(v => v.id === input.voiceId)) throw new SpeechError('INVALID_REQUEST'); this.current(input);
      const pendingAfterVoices = this.pendingNow(); if (pendingAfterVoices) { if (pendingAfterVoices.id === input.operationId && pendingAfterVoices.fingerprint === fingerprint) return pendingAfterVoices.promise; throw new SpeechError('INVALID_REQUEST'); }
      const job = this.adapter.speak(input.preview, input.voiceId); const promise = this.perform(input, fingerprint, job); this.pending = { id: input.operationId, fingerprint, job, promise }; return promise;
    } catch (error) { return failure(error); }
  }
  private async perform(value: SpeechRequest, fingerprint: string, job: SpeechProcess): Promise<Result<Uint8Array>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { const timed = new Promise<never>((_, reject) => { timer = setTimeout(() => { job.cancel(); reject(new SpeechError('TIMEOUT')); }, this.timeoutMs); }); const audio = await Promise.race([job.promise, timed]); if (this.pending?.job !== job) throw new SpeechError('CANCELLED'); this.current(value); this.cache = { id: value.operationId, fingerprint, audio: new Uint8Array(audio) }; return { ok: true, value: audio }; }
    catch (error) { return failure(this.pending?.job !== job ? new SpeechError('CANCELLED') : error); }
    finally { clearTimeout(timer); if (this.pending?.job === job) this.pending = undefined; }
  }
}
export function createLocalSpeechHandlers(service: LocalSpeechService) { const invalid = () => failure(new SpeechError('INVALID_REQUEST')); return { generate: (args: unknown[]) => args.length === 1 ? service.generate(args[0]) : invalid(), cancel: (args: unknown[]) => { if (args.length !== 1 || !isInterviewId(args[0])) return invalid(); service.cancel(args[0]); return { ok: true, value: null } as const; }, status: (args: unknown[]) => args.length ? invalid() : service.status().then(value => ({ ok: true, value } as const), failure) }; }

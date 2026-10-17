import { exactRecord } from './ai';
import { isInterviewId } from './interview';

export const VOICE_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, recordingMs: 60_000, timeoutMs: 30_000, requests: 36, responseBytes: 65_536 });
export const VOICE_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
export const VOICE_MIME = 'audio/webm;codecs=opus';
export interface VoiceStart { operationId: string; sessionId: string; questionId: string; microphoneConsent: true }
export interface VoiceRequest { operationId: string; model: string; audio: Uint8Array; transmissionConsent: true }
export interface VoiceStatus { remainingRequests: number }
export function isVoiceStart(value: unknown): value is VoiceStart {
  return exactRecord(value, ['operationId', 'sessionId', 'questionId', 'microphoneConsent']) && value.microphoneConsent === true &&
    isInterviewId(value.operationId) && isInterviewId(value.sessionId) && isInterviewId(value.questionId);
}
export function isVoiceRequest(value: unknown): value is VoiceRequest {
  return exactRecord(value, ['operationId', 'model', 'audio', 'transmissionConsent']) && value.transmissionConsent === true &&
    isInterviewId(value.operationId) && typeof value.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.model) &&
    value.audio instanceof Uint8Array && value.audio.byteLength > 0 && value.audio.byteLength <= VOICE_LIMITS.bytes;
}

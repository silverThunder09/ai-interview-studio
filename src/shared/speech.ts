import { exactRecord } from './ai';
import { isInterviewId } from './interview';

export const SPEECH_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
export const SPEECH_LIMITS = Object.freeze({ textChars: 1_500, bytes: 8 * 1024 * 1024, timeoutMs: 30_000, playbackMs: 90_000, requests: 36 });
export const SPEECH_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;
export type SpeechVoice = typeof SPEECH_VOICES[number];
export interface SpeechRequest {
  operationId: string; sessionId: string; questionId: string; preview: string;
  model: string; voice: SpeechVoice; transmissionConsent: true;
}
export interface SpeechStatus { remainingRequests: number }
export function isSpeechRequest(value: unknown): value is SpeechRequest {
  return exactRecord(value, ['operationId', 'sessionId', 'questionId', 'preview', 'model', 'voice', 'transmissionConsent']) &&
    isInterviewId(value.operationId) && isInterviewId(value.sessionId) && isInterviewId(value.questionId) && value.transmissionConsent === true &&
    typeof value.preview === 'string' && value.preview.trim().length > 0 && value.preview.length <= SPEECH_LIMITS.textChars && !value.preview.includes('\0') &&
    typeof value.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.model) && SPEECH_VOICES.some(voice => voice === value.voice);
}

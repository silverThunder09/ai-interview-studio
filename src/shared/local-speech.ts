import { exactRecord } from './ai';
import type { AvatarSlot } from './avatar';
import { isInterviewId } from './interview';

export const SPEECH_LIMITS = Object.freeze({ textChars: 1_500, bytes: 8 * 1024 * 1024, timeoutMs: 30_000, playbackMs: 90_000 });
export interface LocalSpeechVoice { id: string; name: string; culture: string }
export interface LocalSpeechVoices { a: string; b: string }
export function isLocalSpeechVoices(value: unknown): value is LocalSpeechVoices {
  return exactRecord(value, ['a', 'b']) && [value.a, value.b].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !v.includes('\0'));
}
export interface SpeechRequest { operationId: string; sessionId: string; questionId: string; preview: string; speakerId: AvatarSlot; voiceId: string }
export interface SpeechStatus { available: boolean; voices: LocalSpeechVoice[] }
export function isSpeechRequest(value: unknown): value is SpeechRequest {
  return exactRecord(value, ['operationId', 'sessionId', 'questionId', 'preview', 'speakerId', 'voiceId']) &&
    isInterviewId(value.operationId) && isInterviewId(value.sessionId) && isInterviewId(value.questionId) &&
    (value.speakerId === 'a' || value.speakerId === 'b') && typeof value.voiceId === 'string' && value.voiceId.length > 0 && value.voiceId.length <= 200 && !value.voiceId.includes('\0') &&
    typeof value.preview === 'string' && value.preview.trim().length > 0 && value.preview.length <= SPEECH_LIMITS.textChars && !value.preview.includes('\0');
}

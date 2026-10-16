import type { ResumeSection } from './resume';
import { RESUME_LIMITS } from './resume';

export const INTERVIEW_LIMITS = Object.freeze({ sessions: 100, answerChars: 10_000, turns: 12 });
export interface StartInterviewRequest {
  requestId: string;
  reviewedText: string;
  sourceSections: ResumeSection[];
  storageConsent: true;
}
export interface SubmitAnswerRequest { sessionId: string; questionId: string; answer: string }
export interface DeleteInterviewRequest { sessionId: string; confirm: true }
export interface DeleteAllInterviewsRequest { confirm: 'DELETE_ALL_INTERVIEWS' }
export interface EvidenceQuote { origin: 'source' | 'reviewed' | 'answer'; location: string; text: string }
export interface InterviewQuestion {
  id: string; number: number; kind: 'experience' | 'technical' | 'follow-up';
  text: string; evidence: EvidenceQuote | null;
}
export interface InterviewTurn { question: InterviewQuestion; answer: string | null }
export interface InterviewSession {
  id: string; createdAt: string; status: 'active' | 'completed';
  reviewedText: string; sourceSections: ResumeSection[]; turns: InterviewTurn[];
  mode: 'local-practice';
}
export interface InterviewSummary {
  id: string; createdAt: string; status: 'active' | 'completed'; answered: number;
}
export interface InterviewHistory { sessions: InterviewSummary[]; storagePath: string; limit: number }

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function isInterviewId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}
export function isStartInterviewRequest(value: unknown): value is StartInterviewRequest {
  if (!record(value, ['requestId', 'reviewedText', 'sourceSections', 'storageConsent']) ||
    !isInterviewId(value.requestId) || value.storageConsent !== true || !text(value.reviewedText, RESUME_LIMITS.textChars) ||
    !Array.isArray(value.sourceSections) || !value.sourceSections.length || value.sourceSections.length > 2_000) return false;
  let length = (value.sourceSections.length - 1) * 2;
  return value.sourceSections.every((section: unknown) => {
    if (!record(section, ['location', 'text']) || typeof section.location !== 'string' ||
      !/^(?:[1-9]\d?페이지|단락 [1-9]\d{0,3})$/.test(section.location) || !text(section.text, RESUME_LIMITS.textChars)) return false;
    length += section.text.length;
    return length <= RESUME_LIMITS.textChars;
  });
}
export function isSubmitAnswerRequest(value: unknown): value is SubmitAnswerRequest {
  return record(value, ['sessionId', 'questionId', 'answer']) && isInterviewId(value.sessionId) &&
    isInterviewId(value.questionId) && text(value.answer, INTERVIEW_LIMITS.answerChars);
}
export function isDeleteInterviewRequest(value: unknown): value is DeleteInterviewRequest {
  return record(value, ['sessionId', 'confirm']) && isInterviewId(value.sessionId) && value.confirm === true;
}
export function isDeleteAllInterviewsRequest(value: unknown): value is DeleteAllInterviewsRequest {
  return record(value, ['confirm']) && value.confirm === 'DELETE_ALL_INTERVIEWS';
}

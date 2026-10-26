import type { ResumeSection } from './resume';
import { RESUME_LIMITS } from './resume';
import { isAIConfig, type AIInterviewConfig } from './ai';

export const INTERVIEW_LIMITS = Object.freeze({ sessions: 100, answerChars: 10_000, turns: 12, usageRows: 3_600 });
export const SHARED_CONTEXT_LIMITS = Object.freeze({ quoteChars: 180, questionChars: 500, answerChars: 1_000, currentAnswerChars: 2_000, turns: 2, historyJSONChars: 4_000, dataJSONChars: 8_000 });
export const GEMINI_USAGE_FIELDS = ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'totalTokenCount'] as const;
export type GeminiUsageField = typeof GEMINI_USAGE_FIELDS[number];
export type GeminiUsageTokens = Partial<Record<GeminiUsageField, number>>;
export function normalizeGeminiUsage(value: unknown): GeminiUsageTokens | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>, result: GeminiUsageTokens = {};
  for (const field of GEMINI_USAGE_FIELDS) {
    const count = Object.hasOwn(source, field) ? source[field] : undefined;
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) result[field] = count;
  }
  return Object.keys(result).length ? result : undefined;
}
export interface InterviewUsage {
  attempts: number;
  missingAttempts: number;
  tokens: GeminiUsageTokens;
  providedAttempts: Partial<Record<GeminiUsageField, number>>;
}
export interface StartInterviewRequest {
  requestId: string;
  reviewedText: string;
  sourceSections: ResumeSection[];
  storageConsent: true;
  ai?: AIInterviewConfig;
}
export interface SubmitAnswerRequest { sessionId: string; questionId: string; answer: string; transmissionConsent?: true; contextPreview?: { digest: string; consent: true } }
export interface SharedContextPreviewRequest { sessionId: string; questionId: string; answer: string }
export interface SharedContextTurn { question: string; answer: string }
export interface SharedContextData {
  selectedQuote: string; recentCompleted: SharedContextTurn[]; currentAnswer: string;
  scope: { includedCompleted: number; omittedCompleted: number; excerpts: true };
}
export interface SharedContextPreview {
  sessionId: string; questionId: string; role: { kind: InterviewQuestion['kind']; speakerId: 'a' | 'b' };
  data: SharedContextData; digest: string;
}
export interface DeleteInterviewRequest { sessionId: string; confirm: true }
export interface DeleteAllInterviewsRequest { confirm: 'DELETE_ALL_INTERVIEWS' }
export interface EvidenceQuote { origin: 'source' | 'reviewed' | 'answer'; location: string; text: string }
export interface InterviewQuestion {
  id: string; number: number; kind: 'experience' | 'technical' | 'follow-up';
  text: string; evidence: EvidenceQuote | null; speakerId?: 'a' | 'b';
}
export interface InterviewTurn { question: InterviewQuestion; answer: string | null }
export interface InterviewSession {
  id: string; createdAt: string; status: 'active' | 'completed';
  reviewedText: string; sourceSections: ResumeSection[]; turns: InterviewTurn[];
  mode: 'local-practice' | 'external-ai'; ai?: AIInterviewConfig; usage?: InterviewUsage;
}
export interface InterviewSummary {
  id: string; createdAt: string; status: 'active' | 'completed'; answered: number;
  mode: InterviewSession['mode'];
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
  const keys = ['requestId', 'reviewedText', 'sourceSections', 'storageConsent'];
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'ai')) keys.push('ai');
  if (!record(value, keys) ||
    !isInterviewId(value.requestId) || value.storageConsent !== true || !text(value.reviewedText, RESUME_LIMITS.textChars) ||
    !Array.isArray(value.sourceSections) || !value.sourceSections.length || value.sourceSections.length > 2_000) return false;
  if (Object.hasOwn(value, 'ai') && (!isAIConfig(value.ai) || !value.reviewedText.includes(value.ai.quote))) return false;
  let length = (value.sourceSections.length - 1) * 2;
  return value.sourceSections.every((section: unknown) => {
    if (!record(section, ['location', 'text']) || typeof section.location !== 'string' ||
      !/^(?:[1-9]\d?페이지|단락 [1-9]\d{0,3})$/.test(section.location) || !text(section.text, RESUME_LIMITS.textChars)) return false;
    length += section.text.length;
    return length <= RESUME_LIMITS.textChars;
  });
}
export function isSubmitAnswerRequest(value: unknown): value is SubmitAnswerRequest {
  const consent = typeof value === 'object' && value !== null && Object.hasOwn(value, 'transmissionConsent');
  const preview = typeof value === 'object' && value !== null && Object.hasOwn(value, 'contextPreview');
  const keys = ['sessionId', 'questionId', 'answer']; if (consent) keys.push('transmissionConsent'); if (preview) keys.push('contextPreview');
  return record(value, keys) &&
    (!consent || value.transmissionConsent === true) && isInterviewId(value.sessionId) &&
    isInterviewId(value.questionId) && text(value.answer, INTERVIEW_LIMITS.answerChars) && (!preview ||
      record(value.contextPreview, ['digest', 'consent']) && value.contextPreview.consent === true && typeof value.contextPreview.digest === 'string' && /^[0-9a-f]{64}$/.test(value.contextPreview.digest));
}
export function isSharedContextPreviewRequest(value: unknown): value is SharedContextPreviewRequest {
  return record(value, ['sessionId', 'questionId', 'answer']) && isInterviewId(value.sessionId) &&
    isInterviewId(value.questionId) && text(value.answer, SHARED_CONTEXT_LIMITS.currentAnswerChars);
}

export function buildSharedContextData(selectedQuote: string, completed: readonly InterviewTurn[], currentAnswer: string): SharedContextData {
  if (!text(selectedQuote, SHARED_CONTEXT_LIMITS.quoteChars) || !text(currentAnswer, SHARED_CONTEXT_LIMITS.currentAnswerChars)) throw new Error('INVALID_SHARED_CONTEXT');
  if (!Array.isArray(completed) || !completed.every(turn => typeof turn === 'object' && turn !== null && isInterviewQuestion(turn.question) &&
    (turn.answer === null || text(turn.answer, INTERVIEW_LIMITS.answerChars)))) throw new Error('INVALID_SHARED_CONTEXT');
  const answered = completed.filter((turn): turn is InterviewTurn & { answer: string } => turn.answer !== null);
  const recentCompleted = answered.slice(-SHARED_CONTEXT_LIMITS.turns).map(turn => ({
    question: turn.question.text.slice(0, SHARED_CONTEXT_LIMITS.questionChars), answer: turn.answer.slice(0, SHARED_CONTEXT_LIMITS.answerChars),
  }));
  const historyJSON = JSON.stringify(recentCompleted);
  if (historyJSON.length > SHARED_CONTEXT_LIMITS.historyJSONChars) throw new Error('SHARED_HISTORY_TOO_LARGE');
  const data: SharedContextData = { selectedQuote, recentCompleted, currentAnswer, scope: {
    includedCompleted: recentCompleted.length, omittedCompleted: answered.length - recentCompleted.length, excerpts: true,
  } };
  if (JSON.stringify(data).length > SHARED_CONTEXT_LIMITS.dataJSONChars) throw new Error('SHARED_DATA_TOO_LARGE');
  return data;
}
export function isDeleteInterviewRequest(value: unknown): value is DeleteInterviewRequest {
  return record(value, ['sessionId', 'confirm']) && isInterviewId(value.sessionId) && value.confirm === true;
}
export function isDeleteAllInterviewsRequest(value: unknown): value is DeleteAllInterviewsRequest {
  return record(value, ['confirm']) && value.confirm === 'DELETE_ALL_INTERVIEWS';
}

export function isInterviewQuestion(value: unknown): value is InterviewQuestion {
  const keys = ['id', 'number', 'kind', 'text', 'evidence'];
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'speakerId')) keys.push('speakerId');
  if (!record(value, keys) || !isInterviewId(value.id) ||
    !Number.isInteger(value.number) || Number(value.number) < 1 || Number(value.number) > INTERVIEW_LIMITS.turns ||
    typeof value.kind !== 'string' || !['experience', 'technical', 'follow-up'].includes(value.kind) || !text(value.text, 4_000) ||
    (Object.hasOwn(value, 'speakerId') && !['a', 'b'].includes(value.speakerId as string))) return false;
  const evidence = value.evidence;
  return evidence === null || (record(evidence, ['origin', 'location', 'text']) &&
    typeof evidence.origin === 'string' && ['source', 'reviewed', 'answer'].includes(evidence.origin) && text(evidence.location, 64) && text(evidence.text, 180));
}

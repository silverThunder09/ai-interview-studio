export const AI_PROVIDERS = ['openai', 'claude', 'gemini'] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export const AI_NAMES: Record<AIProvider, string> = { openai: 'OpenAI', claude: 'Claude (Anthropic)', gemini: 'Gemini (Google)' };
export const AI_ENDPOINTS: Record<AIProvider, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
};
export const AI_CALL_LIMIT = 36;
export interface InterviewerProfiles { a: 'strict' | 'balanced'; b: 'calm' | 'supportive' }
export const DEFAULT_INTERVIEWER_PROFILES: InterviewerProfiles = { a: 'strict', b: 'calm' };
export function isInterviewerProfiles(value: unknown): value is InterviewerProfiles {
  return exactRecord(value, ['a', 'b']) && (value.a === 'strict' || value.a === 'balanced') && (value.b === 'calm' || value.b === 'supportive');
}
export interface AIInterviewConfig {
  provider: AIProvider; model: string; quote: string; transmissionConsent: true; profiles?: InterviewerProfiles;
}
export interface AIStatus {
  providers: { provider: AIProvider; configured: boolean; saved?: boolean }[];
  remainingRequests: number;
  storage?: { available: boolean; warning: string };
  preferences?: AIPreferences;
}
export interface AIPreferences { provider: AIProvider; models: Record<AIProvider, string>; profiles?: InterviewerProfiles }
export const DEFAULT_AI_PREFERENCES: AIPreferences = { provider: 'openai', models: { openai: '', claude: '', gemini: '' } };
export function isAIPreferences(value: unknown): value is AIPreferences {
  const withProfiles = exactRecord(value, ['provider', 'models', 'profiles']);
  if ((!withProfiles && !exactRecord(value, ['provider', 'models'])) || !isAIProvider(value.provider) || (withProfiles && !isInterviewerProfiles(value.profiles))) return false;
  const models = value.models;
  return exactRecord(models, [...AI_PROVIDERS]) && AI_PROVIDERS.every(p => models[p] === '' || isAIModelId(models[p]));
}
export interface AIKeyRequest { provider: AIProvider; key: string; remember?: boolean }
export function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
export function isAIProvider(value: unknown): value is AIProvider { return AI_PROVIDERS.some(p => p === value); }
export function isAIModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value);
}
export function isAIConfig(value: unknown): value is AIInterviewConfig {
  const hasProfiles = exactRecord(value, ['provider', 'model', 'quote', 'transmissionConsent', 'profiles']);
  return (hasProfiles || exactRecord(value, ['provider', 'model', 'quote', 'transmissionConsent'])) && isAIProvider(value.provider) &&
    isAIModelId(value.model) &&
    typeof value.quote === 'string' && value.quote.trim().length > 0 && value.quote.length <= 180 && !value.quote.includes('\0') && value.transmissionConsent === true && (!hasProfiles || (value.provider === 'gemini' && isInterviewerProfiles(value.profiles)));
}
export function isAIKeyRequest(value: unknown): value is AIKeyRequest {
  return (exactRecord(value, ['provider', 'key']) || (exactRecord(value, ['provider', 'key', 'remember']) && typeof value.remember === 'boolean')) && isAIProvider(value.provider) && typeof value.key === 'string' && /^[\x21-\x7e]{8,512}$/.test(value.key);
}

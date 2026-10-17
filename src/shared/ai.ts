export const AI_PROVIDERS = ['openai', 'claude', 'gemini'] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];
export const AI_NAMES: Record<AIProvider, string> = { openai: 'OpenAI', claude: 'Claude (Anthropic)', gemini: 'Gemini (Google)' };
export const AI_ENDPOINTS: Record<AIProvider, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
};
export const AI_CALL_LIMIT = 36;
export interface AIInterviewConfig {
  provider: AIProvider; model: string; quote: string; transmissionConsent: true;
}
export interface AIStatus { providers: { provider: AIProvider; configured: boolean }[]; remainingRequests: number }
export interface AIKeyRequest { provider: AIProvider; key: string }
export function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
export function isAIProvider(value: unknown): value is AIProvider { return AI_PROVIDERS.some(p => p === value); }
export function isAIConfig(value: unknown): value is AIInterviewConfig {
  return exactRecord(value, ['provider', 'model', 'quote', 'transmissionConsent']) && isAIProvider(value.provider) &&
    typeof value.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.model) &&
    typeof value.quote === 'string' && value.quote.trim().length > 0 && value.quote.length <= 180 && !value.quote.includes('\0') && value.transmissionConsent === true;
}
export function isAIKeyRequest(value: unknown): value is AIKeyRequest {
  return exactRecord(value, ['provider', 'key']) && isAIProvider(value.provider) && typeof value.key === 'string' && /^[\x21-\x7e]{8,512}$/.test(value.key);
}

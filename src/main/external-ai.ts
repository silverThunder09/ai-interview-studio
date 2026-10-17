import type { Result } from '../shared/contracts';
import { AI_CALL_LIMIT, AI_ENDPOINTS, AI_PROVIDERS, exactRecord, isAIKeyRequest, isAIProvider, type AIProvider, type AIStatus } from '../shared/ai';
import type { AIQuestionPayload, AIQuestionTransport, AITransportResult } from './ai-question-provider';
import { AIQuestionError, AIQuestionProvider } from './ai-question-provider';
import type { AsyncInterviewProvider } from './interview-service';
import { LocalQuestionProvider } from './questions';

// Keys are write-only across IPC, process-memory only, never stored in SQLite.
export class AICredentials {
  #keys = new Map<AIProvider, string>();
  private used = 0;
  status(): AIStatus { return { providers: AI_PROVIDERS.map(provider => ({ provider, configured: this.#keys.has(provider) })), remainingRequests: AI_CALL_LIMIT - this.used }; }
  set(provider: AIProvider, key: string): void { this.#keys.set(provider, key); }
  clear(provider: AIProvider): void { this.#keys.delete(provider); }
  clearAll(): void { this.#keys.clear(); }
  acquire(provider: AIProvider): string {
    const key = this.#keys.get(provider);
    if (!key) throw new AIQuestionError('AUTHENTICATION');
    if (this.used >= AI_CALL_LIMIT) throw new AIQuestionError('RATE_LIMITED');
    this.used++; return key;
  }
}
export function createAIHandlers(credentials: AICredentials, cancel: () => void) {
  const invalid = (): Result<never> => ({ ok: false, error: { code: 'INVALID_REQUEST', message: 'AI 설정 형식을 확인해 주세요.' } });
  const success = (): Result<AIStatus> => ({ ok: true, value: credentials.status() });
  return {
    status(args: unknown[]) { return args.length ? invalid() : success(); },
    set(args: unknown[]) {
      if (args.length !== 1 || !isAIKeyRequest(args[0])) return invalid();
      cancel(); credentials.set(args[0].provider, args[0].key); return success();
    },
    clear(args: unknown[]) {
      if (args.length !== 1 || !exactRecord(args[0], ['provider']) || !isAIProvider(args[0].provider)) return invalid();
      cancel(); credentials.clear(args[0].provider); return success();
    },
  };
}
const schema = { type: 'object', properties: { text: { type: 'string' }, evidenceId: { type: ['string', 'null'] } }, required: ['text', 'evidenceId'], additionalProperties: false };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIQuestionError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function items(value: unknown): unknown[] { if (!Array.isArray(value)) throw new AIQuestionError('INVALID_RESPONSE'); return value; }
function parseText(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 8_000) throw new AIQuestionError('INVALID_RESPONSE');
  return JSON.parse(value);
}
async function boundedJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) throw new AIQuestionError('INVALID_RESPONSE');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  let size = 0, text = '';
  try {
    if (signal.aborted) throw new AIQuestionError('CANCELLED');
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new AIQuestionError('CANCELLED');
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new AIQuestionError('INVALID_RESPONSE');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { signal.removeEventListener('abort', stop); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function createExternalTransport(provider: AIProvider, model: string, key: string, request: typeof fetch = fetch): AIQuestionTransport {
  return async (payload: AIQuestionPayload, signal): Promise<AITransportResult> => {
    const data = JSON.stringify(payload.data);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    let url = AI_ENDPOINTS[provider];
    let body: unknown;
    if (provider === 'openai') {
      headers.authorization = `Bearer ${key}`;
      body = { model, store: false, stream: false, max_completion_tokens: payload.maxOutputTokens,
        messages: [{ role: 'system', content: payload.instructions }, { role: 'user', content: data }],
        response_format: { type: 'json_schema', json_schema: { name: 'interview_question', strict: true, schema } } };
    } else if (provider === 'claude') {
      headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01';
      body = { model, stream: false, max_tokens: payload.maxOutputTokens, system: payload.instructions, output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: data }] };
    } else {
      headers['x-goog-api-key'] = key; url += `${encodeURIComponent(model)}:generateContent`;
      body = { systemInstruction: { parts: [{ text: payload.instructions }] }, contents: [{ role: 'user', parts: [{ text: data }] }],
        generationConfig: { maxOutputTokens: payload.maxOutputTokens, responseFormat: { text: { mimeType: 'application/json', schema } } } };
    }
    const response = await request(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: response.status === 429 ? 'rate-limit' : [401, 403].includes(response.status) ? 'authentication' : 'unavailable' };
    }
    const result = object(await boundedJSON(response, signal));
    let value: unknown;
    if (provider === 'openai') {
      const choices = items(result.choices);
      if (choices.length !== 1 || object(choices[0]).finish_reason !== 'stop') throw new AIQuestionError('INVALID_RESPONSE');
      const message = object(object(choices[0]).message);
      if (message.refusal || message.tool_calls || message.function_call) throw new AIQuestionError('INVALID_RESPONSE');
      value = parseText(message.content);
    } else if (provider === 'claude') {
      const content = items(result.content);
      if (result.stop_reason !== 'end_turn' || result.stop_details || content.length !== 1 || object(content[0]).type !== 'text') throw new AIQuestionError('INVALID_RESPONSE');
      value = parseText(object(content[0]).text);
    } else {
      if (result.promptFeedback && object(result.promptFeedback).blockReason) throw new AIQuestionError('INVALID_RESPONSE');
      const candidates = items(result.candidates);
      if (candidates.length !== 1 || object(candidates[0]).finishReason !== 'STOP') throw new AIQuestionError('INVALID_RESPONSE');
      const parts = items(object(object(candidates[0]).content).parts);
      if (parts.length !== 1 || object(parts[0]).thought === true || typeof object(parts[0]).text !== 'string' || object(parts[0]).functionCall) throw new AIQuestionError('INVALID_RESPONSE');
      value = parseText(object(parts[0]).text);
    }
    return { ok: true, value };
  };
}
export class InterviewProviderRouter implements AsyncInterviewProvider {
  constructor(private readonly credentials: AICredentials, private readonly request: typeof fetch = (...args) => fetch(...args)) {}
  async next(resume: Parameters<AsyncInterviewProvider['next']>[0], previous: Parameters<AsyncInterviewProvider['next']>[1], signal: AbortSignal) {
    if (!resume.ai) return new LocalQuestionProvider().next(resume, previous);
    if (signal.aborted) throw new AIQuestionError('CANCELLED');
    const config = resume.ai, number = previous.length + 1;
    const key = this.credentials.acquire(config.provider);
    const transport: AIQuestionTransport = (payload, abort) => {
      if (abort.aborted) throw new AIQuestionError('CANCELLED');
      return createExternalTransport(config.provider, config.model, key, this.request)(payload, abort);
    };
    return new AIQuestionProvider(transport).next({ questionNumber: number,
      evidence: number === 1 ? [{ origin: 'reviewed', location: '사용자 선택 구절', text: config.quote }] : [],
      answer: number % 2 === 0 ? previous.at(-1)?.answer : null }, signal);
  }
}

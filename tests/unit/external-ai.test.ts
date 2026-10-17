import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_CALL_LIMIT, AI_ENDPOINTS, AI_PROVIDERS, isAIConfig, isAIKeyRequest, type AIProvider } from '../../src/shared/ai';
import { isStartInterviewRequest } from '../../src/shared/interview';
import { AICredentials, createAIHandlers, createExternalTransport, InterviewProviderRouter } from '../../src/main/external-ai';
import { AIQuestionProvider, type AIQuestionPayload } from '../../src/main/ai-question-provider';
import { InterviewService } from '../../src/main/interview-service';
import { InterviewStore } from '../../src/main/interview-store';
import { createInterviewHandlers } from '../../src/main/interview-handlers';
import { startFixture } from '../fixtures/interview';

const key = 'synthetic-api-key-not-real';
const config = (provider: AIProvider = 'openai') => ({ provider, model: 'synthetic-model', quote: startFixture().reviewedText, transmissionConsent: true as const });
const payload: AIQuestionPayload = { instructions: '합성 지시 JSON', maxOutputTokens: 600, data: { questionNumber: 1, kind: 'experience', evidence: [{ id: 'evidence-1', origin: 'reviewed', location: '사용자 선택 구절', text: '합성 구절' }], answer: null } };
const answer = { text: '실제 역할과 검증 방법을 설명해 주세요.', evidenceId: 'evidence-1' };
function envelope(provider: AIProvider, value: unknown = answer) {
  const text = JSON.stringify(value);
  if (provider === 'openai') return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] };
  if (provider === 'claude') return { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text }] };
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] };
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const dirs: string[] = [], stores: InterviewStore[] = [];
function store(file?: string) { const dir = mkdtempSync(join(tmpdir(), 'studio-ai-')); dirs.push(dir); const result = new InterviewStore(file ?? join(dir, 'records.sqlite')); stores.push(result); return result; }
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('write-only credentials and consent validation', () => {
  it('rejects arbitrary hosts, extra keys, missing consent, invented quotes and header injection', () => {
    expect(isAIConfig(config())).toBe(true);
    expect(isAIKeyRequest({ provider: 'claude', key })).toBe(true);
    for (const ai of [{ ...config(), transmissionConsent: false }, { ...config(), model: '../../secret' }, { ...config(), url: 'https://evil.invalid' }, { ...config(), provider: 'ollama' }, { ...config(), quote: 'a'.repeat(181) }]) expect(isAIConfig(ai)).toBe(false);
    for (const value of [{ provider: 'openai', key: key + '\r\nx-leak: yes' }, { provider: 'other', key }, { provider: 'gemini', key, save: true }]) expect(isAIKeyRequest(value)).toBe(false);
    expect(isStartInterviewRequest({ ...startFixture(), ai: config() })).toBe(true);
    expect(isStartInterviewRequest({ ...startFixture(), ai: { ...config(), quote: '원문에 없는 경험' } })).toBe(false);
  });
  it('returns registration metadata only, clears keys, validates before mutation and never calls a service for setup', () => {
    const vault = new AICredentials(), cancel = vi.fn(), handlers = createAIHandlers(vault, cancel);
    expect(handlers.set([{ provider: 'openai', key, extra: true }]).ok).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    const result = handlers.set([{ provider: 'openai', key }]);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(vault.status().providers[0]?.configured).toBe(true);
    expect(vault.status().remainingRequests).toBe(AI_CALL_LIMIT);
    expect(handlers.status(['extra']).ok).toBe(false);
    expect(handlers.clear([{ provider: 'openai' }]).ok).toBe(true);
    expect(() => vault.acquire('openai')).toThrow('인증');
    expect(handlers.clear([{ provider: 'openai', key }]).ok).toBe(false);
    vault.set('gemini', key); vault.clearAll(); expect(vault.status().providers.every(p => !p.configured)).toBe(true);
    expect(new AICredentials().status().providers.every(p => !p.configured)).toBe(true);
  });
});

describe.each(AI_PROVIDERS)('%s REST adapter with synthetic fetch', provider => {
  it('uses fixed HTTPS destination/header-only authentication, bounded output and separated instructions/data', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(envelope(provider)));
    expect(await createExternalTransport(provider, 'synthetic-model', key, request)(payload, new AbortController().signal)).toEqual({ ok: true, value: answer });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(AI_ENDPOINTS[provider] + (provider === 'gemini' ? 'synthetic-model:generateContent' : ''));
    expect(String(url)).not.toContain(key);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store' });
    expect(Object.values(init!.headers!)).toContain(provider === 'openai' ? `Bearer ${key}` : key);
    expect(init!.body).not.toContain(key);
    const body = JSON.parse(String(init!.body));
    expect(body).not.toHaveProperty('tools');
    if (provider === 'openai') expect(body).toMatchObject({ max_completion_tokens: 600, store: false, stream: false, messages: [{ role: 'system', content: payload.instructions }, { role: 'user', content: JSON.stringify(payload.data) }] });
    if (provider === 'claude') expect(body).toMatchObject({ max_tokens: 600, stream: false, system: payload.instructions });
    if (provider === 'gemini') expect(body).toMatchObject({ generationConfig: { maxOutputTokens: 600, responseFormat: { text: { mimeType: 'application/json' } } } });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 400, 500])('redacts HTTP %i and does not retry or change providers', async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret error ' + key, { status }));
    const result = await createExternalTransport(provider, 'synthetic-model', key, request)(payload, new AbortController().signal);
    expect(result).toEqual({ ok: false, reason: status === 429 ? 'rate-limit' : status === 401 || status === 403 ? 'authentication' : 'unavailable' });
    expect(JSON.stringify(result)).not.toContain(key); expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed, truncated, blocked, tool and oversized responses without returning raw bodies', async () => {
    const bad = provider === 'openai' ? [ { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(answer) } }] }, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer), refusal: 'refused' } }] }, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer), tool_calls: [{}] } }] } ] : provider === 'claude' ? [ { stop_reason: 'max_tokens', content: [{ type: 'text', text: JSON.stringify(answer) }] }, { stop_reason: 'end_turn', content: [{ type: 'tool_use' }] }, { stop_reason: 'end_turn', stop_details: { type: 'refusal' }, content: [{ type: 'text', text: JSON.stringify(answer) }] } ] : [ { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(answer) }] } }] }, { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }, { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: {} }] } }] } ];
    for (const res of [...bad.map(response), response(null), new Response('bad ' + key, { headers: { 'content-type': 'application/json' } }), response({ content: 'a'.repeat(65_537) }), new Response('not JSON')]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(res);
      await expect(new AIQuestionProvider(createExternalTransport(provider, 'synthetic-model', key, fetcher)).next({ questionNumber: 1, evidence: [], answer: null })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
  });
  it('drives SQLite AI sessions with exact context, per-answer consent, durable retry and restored provider', async () => {
    const seen: string[] = [];
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const raw = String(init?.body); seen.push(raw);
      const body = JSON.parse(raw);
      const data = JSON.parse(provider === 'gemini' ? body.contents[0].parts[0].text : body.messages.at(-1).content);
      return response(envelope(provider, { text: '합성 질문', evidenceId: data.kind === 'follow-up' ? 'answer-previous' : data.kind === 'technical' ? null : 'evidence-1' }));
    });
    const storage = store(), vault = new AICredentials(); vault.set(provider, key);
    const service = new InterviewService(() => storage, new InterviewProviderRouter(vault, request));
    const input = { ...startFixture(), reviewedText: startFixture().reviewedText + '\n개인 연락처 synthetic@example.invalid', ai: config(provider) };
    const first = await service.start(input);
    expect(first.mode).toBe('external-ai'); expect(first.ai).toEqual(config(provider));
    expect(seen[0]).not.toContain('synthetic@example.invalid'); expect(seen[0]).not.toContain('sourceSections');
    expect(await service.start(input)).toEqual(first); expect(request).toHaveBeenCalledTimes(1);
    await expect(service.start({ ...input, ai: { ...input.ai, model: 'changed' } })).rejects.toThrow('같은 시작 요청');
    const submit = { sessionId: first.id, questionId: first.turns[0]!.question.id, answer: '합성 답변' };
    await expect(service.answer(submit)).rejects.toThrow('전송·비용 확인');
    await expect(service.answer({ ...submit, answer: 'a'.repeat(2001), transmissionConsent: true })).rejects.toThrow('2,000');
    expect(request).toHaveBeenCalledTimes(1);
    const second = await service.answer({ ...submit, transmissionConsent: true });
    expect(seen[1]).toContain('합성 답변'); expect(seen[1]).not.toContain(input.ai.quote);
    expect(await service.answer({ ...submit, transmissionConsent: true })).toEqual(second); expect(request).toHaveBeenCalledTimes(2);
    const third = await service.answer({ sessionId: second.id, questionId: second.turns[1]!.question.id, answer: '후속 비공개 답변', transmissionConsent: true });
    expect(seen[2]).not.toContain('후속 비공개 답변'); expect(seen[2]).not.toContain('합성 답변');
    expect(third.turns.at(-1)?.question.evidence).toBeNull();
    const restored = store(storage.path); expect(restored.get(first.id)).toEqual(third);
    expect(restored.history().sessions[0]?.mode).toBe('external-ai');
    expect(readFileSync(storage.path).includes(Buffer.from(key))).toBe(false);
    const noKey = new InterviewService(() => restored, new InterviewProviderRouter(new AICredentials(), request));
    const last = { sessionId: third.id, questionId: third.turns[2]!.question.id, answer: '보존할 답변', transmissionConsent: true as const };
    await expect(noKey.answer(last)).rejects.toMatchObject({ code: 'AUTHENTICATION' }); expect(restored.get(first.id)).toEqual(third);
    service.close(); noKey.close();
  });
});

it('caps even failed or cancelled requests across all providers and clearing/re-registering keys does not reset usage', async () => {
  const vault = new AICredentials(); vault.set('openai', key);
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
  const provider = new InterviewProviderRouter(vault, request);
  const input = { ...startFixture(), ai: config() };
  for (let n = 0; n < AI_CALL_LIMIT; n++) await expect(provider.next(input, [], new AbortController().signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  vault.clear('openai'); vault.set('openai', key);
  await expect(provider.next(input, [], new AbortController().signal)).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED', retryable: false });
  const storage = store(), handlers = createInterviewHandlers(() => storage, new InterviewService(() => storage, provider));
  expect(await handlers.start([input])).toMatchObject({ ok: false, error: { code: 'BUDGET_EXHAUSTED', message: expect.stringContaining('기다리거나 키를 재등록해도 복구되지 않습니다') } });
  expect(storage.history().sessions).toEqual([]);
  expect(request).toHaveBeenCalledTimes(AI_CALL_LIMIT); expect(vault.status().remainingRequests).toBe(0);
});
it('migrates schema 1 without changing old request hashes, sessions or pending questions', () => {
  const storage = store(), input = startFixture(), first = storage.start(input);
  const fixture = new DatabaseSync(storage.path);
  fixture.exec('ALTER TABLE sessions DROP COLUMN ai_config; PRAGMA user_version=1;'); fixture.close();
  const migrated = store(storage.path);
  expect(migrated.get(first.id)).toEqual(first); expect(migrated.start(input)).toEqual(first);
  const check = new DatabaseSync(storage.path); expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(2); check.close();
});
it('keeps interrupted network answers atomic and redacts raw transport failures through IPC', async () => {
  const storage = store(), vault = new AICredentials(); vault.set('openai', key);
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(envelope('openai'))).mockRejectedValue(new Error(key + ' private resume'));
  const service = new InterviewService(() => storage, new InterviewProviderRouter(vault, request));
  const handlers = createInterviewHandlers(() => storage, service);
  const first = await service.start({ ...startFixture(), ai: config() });
  const result = await handlers.answer([{ sessionId: first.id, questionId: first.turns[0]!.question.id, answer: '합성 답변', transmissionConsent: true }]);
  expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } }); expect(JSON.stringify(result)).not.toContain(key);
  expect(storage.get(first.id)).toEqual(first); service.close();
});
it('aborts an in-progress response stream, discards late data and preserves records without another paid request', async () => {
  const storage = store(), vault = new AICredentials(); vault.set('openai', key);
  const cancelled = vi.fn(); let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, pull() { started(); }, cancel: cancelled });
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(envelope('openai'))).mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'application/json' } }));
  const service = new InterviewService(() => storage, new InterviewProviderRouter(vault, request));
  const first = await service.start({ ...startFixture(), ai: config() });
  const id = first.turns[0]!.question.id;
  const pending = service.answer({ sessionId: first.id, questionId: id, answer: '취소할 합성 답변', transmissionConsent: true });
  const result = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  await reading; await Promise.resolve(); service.cancel(id); await result;
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
  expect(storage.get(first.id)).toEqual(first); expect(request).toHaveBeenCalledTimes(2); expect(vault.status().remainingRequests).toBe(AI_CALL_LIMIT - 2); service.close();
});
it('does not acquire a key or consume budget on pre-aborted operations', async () => {
  const vault = new AICredentials(), request = vi.fn<typeof fetch>(), controller = new AbortController(); controller.abort();
  await expect(new InterviewProviderRouter(vault, request).next({ ...startFixture(), ai: config() }, [], controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(request).not.toHaveBeenCalled(); expect(vault.status().remainingRequests).toBe(AI_CALL_LIMIT);
});

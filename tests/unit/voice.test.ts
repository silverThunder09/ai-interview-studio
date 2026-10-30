import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { VoiceService, createVoiceHandlers } from '../../src/main/voice';
import { isOpusWebM } from '../../src/main/voice-webm';
import { AICredentials } from '../../src/main/external-ai';
import { InterviewStore } from '../../src/main/interview-store';
import { VOICE_ENDPOINT, VOICE_LIMITS, isVoiceRequest } from '../../src/shared/voice';
import { APP_URL } from '../../src/main/policy';
import { startFixture } from '../fixtures/interview';
import { webmFixture } from '../fixtures/voice';

const resources: { directory: string; store: InterviewStore; voice: VoiceService }[] = [];
const response = () => new Response(JSON.stringify({ text: '합성 음성의 전사입니다.' }), { headers: { 'content-type': 'application/json' } });
function setup(request: typeof fetch = vi.fn<typeof fetch>().mockImplementation(async () => response()), timeout = 30_000) {
  const directory = mkdtempSync(join(tmpdir(), 'studio-voice-')), store = new InterviewStore(join(directory, 'interviews.sqlite'));
  const session = store.start(startFixture()), credentials = new AICredentials(); credentials.set('openai', 'synthetic-key-not-real');
  const voice = new VoiceService(() => store, credentials, request, timeout);
  resources.push({ directory, store, voice });
  const start = { operationId: randomUUID(), sessionId: session.id, questionId: session.turns[0]!.question.id, microphoneConsent: true as const };
  const input = { operationId: start.operationId, model: 'synthetic-transcribe', audio: webmFixture(), transmissionConsent: true as const };
  expect(voice.begin(start)).toEqual({ ok: true, value: null });
  return { voice, credentials, store, session, start, input, request, handlers: createVoiceHandlers(voice) };
}
afterEach(() => { for (const { voice, store, directory } of resources.splice(0)) { voice.cancel(); store.close(); rmSync(directory, { recursive: true, force: true }); } vi.useRealTimers(); vi.restoreAllMocks(); });

describe('voice boundary and permission', () => {
  it('only arms the exact main-frame audio request and expires/revokes permission', () => {
    vi.useFakeTimers(); const { voice, start } = setup();
    expect(voice.allows('media', APP_URL, true, ['audio'], APP_URL, false)).toBe(true);
    for (const media of [['video'], ['audio', 'video'], [], ['unknown']]) expect(voice.allows('media', APP_URL, true, media, APP_URL, true)).toBe(false);
    expect(voice.allows('media', APP_URL, false, ['audio'], APP_URL, true)).toBe(false);
    expect(voice.allows('media', APP_URL + '?other', true, ['audio'], APP_URL, true)).toBe(false);
    expect(voice.allows('display-capture', APP_URL, true, ['audio'], APP_URL, true)).toBe(false);
    expect(voice.allows('media', APP_URL, true, ['audio'], APP_URL, true)).toBe(true);
    expect(voice.allows('media', APP_URL, true, ['audio'], APP_URL, true)).toBe(false);
    vi.advanceTimersByTime(15_001);
    expect(voice.allows('media', APP_URL, true, ['audio'], APP_URL, false)).toBe(false);
    voice.stop(start.operationId);
    expect(voice.allows('media', APP_URL, true, ['audio'], APP_URL, false)).toBe(false);
    voice.cancel(); expect(voice.begin({ ...start, microphoneConsent: false })).toMatchObject({ ok: false });
  });
  it('requires a current unanswered question and exact IPC shapes, without invoking a provider', async () => {
    const f = setup();
    expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    f.voice.stop(f.start.operationId);
    for (const input of [null, { ...f.input, transmissionConsent: false }, { ...f.input, model: '../path' }, { ...f.input, audio: new Uint8Array(VOICE_LIMITS.bytes + 1) }, { ...f.input, audio: webmFixture(1) }, { ...f.input, operationId: randomUUID() }, { ...f.input, extra: 'synthetic-secret' }]) {
      expect(await f.voice.transcribe(input)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(f.request).not.toHaveBeenCalled();
    f.voice.cancel(); expect(f.voice.begin({ ...f.start, questionId: randomUUID() })).toMatchObject({ ok: false });
    expect(f.handlers.begin([])).toMatchObject({ ok: false }); expect(f.handlers.cancel(['invalid'])).toMatchObject({ ok: false });
    expect(isVoiceRequest({ ...f.input, audio: new ArrayBuffer(4) })).toBe(false);
  });
  it('accepts bounded audio-only Opus containers and rejects truncated/malformed/video containers', () => {
    const good = webmFixture(); expect(isOpusWebM(good)).toBe(true);
    expect(isOpusWebM(webmFixture(1))).toBe(false);
    for (let n = 0; n < good.length; n++) expect(isOpusWebM(good.slice(0, n))).toBe(false);
    expect(isOpusWebM(new Uint8Array([0, 1, 2, 3]))).toBe(false);
  });
  it('sends only audio/model/language/format to the fixed endpoint and never saves or advances a question', async () => {
    const f = setup(); f.voice.stop(f.start.operationId);
    expect(await f.voice.transcribe(f.input)).toEqual({ ok: true, value: '합성 음성의 전사입니다.' });
    expect(f.request).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(f.request).mock.calls[0]!;
    expect(url).toBe(VOICE_ENDPOINT); expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { authorization: 'Bearer synthetic-key-not-real' } });
    const form = options!.body as FormData; expect([...form.keys()].sort()).toEqual(['file', 'language', 'model', 'response_format']);
    expect(await (form.get('file') as Blob).arrayBuffer()).toEqual(f.input.audio.buffer);
    expect(form.get('model')).toBe(f.input.model); expect(form.get('language')).toBe('ko');
    expect(f.store.get(f.session.id)).toEqual(f.session);
    expect(f.credentials.status().remainingRequests).toBe(36); expect(f.voice.status().remainingRequests).toBe(35);
    expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(f.request).toHaveBeenCalledOnce();
  });
  it.each([[401, 'AUTHENTICATION'], [403, 'AUTHENTICATION'], [429, 'RATE_LIMITED'], [500, 'UNAVAILABLE']] as const)('sanitizes %s without automatic retry', async (status, code) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('synthetic-key and personal text', { status }));
    const f = setup(request); f.voice.stop(f.start.operationId);
    expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: false, error: { code } }); expect(request).toHaveBeenCalledOnce();
    expect(JSON.stringify(await f.voice.transcribe({}))).not.toContain('synthetic-key'); expect(f.store.get(f.session.id)).toEqual(f.session);
  });
  it.each(['{}', '{"text":""}', '{"text":"\\u0000"}', 'not JSON', JSON.stringify({ text: 'x'.repeat(70_000) })])('rejects malformed/unbounded output', async body => {
    const f = setup(vi.fn<typeof fetch>().mockImplementation(async () => new Response(body, { headers: { 'content-type': 'application/json' } }))); f.voice.stop(f.start.operationId);
    expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });
  it('cancels even a provider that ignores abort, discards late completion, and permits a manual new recording', async () => {
    let resolve!: (value: Response) => void;
    const request = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockImplementation(async () => response());
    const f = setup(request); f.voice.stop(f.start.operationId); const pending = f.voice.transcribe(f.input);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: false });
    f.voice.cancel(f.start.operationId);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect((request.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true);
    resolve(response()); await Promise.resolve(); expect(f.store.get(f.session.id)).toEqual(f.session);
    expect(f.voice.begin({ ...f.start, operationId: randomUUID() })).toEqual({ ok: true, value: null });
  });
  it('times out a stalled response stream, clears its timer and allows a manual retry', async () => {
    vi.useFakeTimers(); const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } })).mockImplementation(async () => response());
    const f = setup(request, 100); f.voice.stop(f.start.operationId); const pending = f.voice.transcribe(f.input);
    await vi.advanceTimersByTimeAsync(100); expect(await pending).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(vi.getTimerCount()).toBe(0); expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps failed/cancelled requests within an independent process budget that rekeying cannot reset', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 429 }));
    const f = setup(request); f.voice.stop(f.start.operationId);
    for (let n = 0; n < 36; n++) expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    f.credentials.clear('openai'); f.credentials.set('openai', 'synthetic-new-key');
    expect(await f.voice.transcribe(f.input)).toMatchObject({ ok: false, error: { code: 'BUDGET_EXHAUSTED' } });
    expect(request).toHaveBeenCalledTimes(36); expect(f.voice.status().remainingRequests).toBe(0);
  }, 15_000);
});

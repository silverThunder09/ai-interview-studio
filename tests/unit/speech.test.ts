import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SpeechService, createSpeechHandlers } from '../../src/main/speech';
import { isMP3 } from '../../src/main/speech-mp3';
import { AICredentials, createAIHandlers } from '../../src/main/external-ai';
import { InterviewStore } from '../../src/main/interview-store';
import { isSpeechRequest, SPEECH_ENDPOINT, SPEECH_LIMITS } from '../../src/shared/speech';
import { startFixture } from '../fixtures/interview';
import { mp3Fixture } from '../fixtures/speech';

const resources: { path: string; store: InterviewStore; service: SpeechService }[] = [];
const response = () => new Response(mp3Fixture(4), { headers: { 'content-type': 'audio/mpeg' } });
function fixture(request = vi.fn<typeof fetch>().mockImplementation(async () => response()), timeout = 30_000) {
  const path = mkdtempSync(join(tmpdir(), 'studio-speech-')), store = new InterviewStore(join(path, 'interviews.sqlite'));
  const session = store.start(startFixture()), credentials = new AICredentials(); credentials.set('openai', 'synthetic-speech-key-not-real');
  const service = new SpeechService(() => store, credentials, request, timeout); resources.push({ path, store, service });
  const input = { operationId: randomUUID(), sessionId: session.id, questionId: session.turns[0]!.question.id, preview: session.turns[0]!.question.text, model: 'synthetic-tts', voice: 'alloy' as const, transmissionConsent: true as const };
  return { store, session, credentials, service, request, input, handlers: createSpeechHandlers(service) };
}
afterEach(() => { for (const f of resources.splice(0)) { f.service.cancel(); f.store.close(); rmSync(f.path, { recursive: true, force: true }); } vi.useRealTimers(); vi.restoreAllMocks(); });
describe('question speech trust boundary and request lifetime', () => {
  it('requires explicit consent, an exact current question and bounded model/voice without network side effects', async () => {
    const f = fixture();
    for (const input of [null, {}, { ...f.input, transmissionConsent: false }, { ...f.input, questionId: randomUUID() }, { ...f.input, preview: '원문과 다른 합성 질문' }, { ...f.input, preview: 'x'.repeat(1501) }, { ...f.input, voice: 'custom-url' }, { ...f.input, model: '../model' }, { ...f.input, arbitraryText: 'synthetic-secret' }]) {
      expect(await f.service.generate(input)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(f.request).not.toHaveBeenCalled(); expect(isSpeechRequest({ ...f.input, preview: '\0' })).toBe(false);
    expect(f.handlers.generate([])).toMatchObject({ ok: false }); expect(f.handlers.cancel(['invalid'])).toMatchObject({ ok: false });
  });
  it('sends only the current question to a fixed endpoint and caches identical successful retries without changing SQLite', async () => {
    const f = fixture(); const result = await f.service.generate(f.input); expect(result).toEqual({ ok: true, value: mp3Fixture(4) });
    expect(f.request).toHaveBeenCalledOnce();
    const [url, options] = f.request.mock.calls[0]!; expect(url).toBe(SPEECH_ENDPOINT);
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { authorization: 'Bearer synthetic-speech-key-not-real' } });
    expect(JSON.parse(String(options!.body))).toEqual({ input: f.input.preview, model: 'synthetic-tts', voice: 'alloy', response_format: 'mp3' });
    if (result.ok) result.value.fill(0);
    expect(await f.service.generate({ ...f.input })).toEqual({ ok: true, value: mp3Fixture(4) }); expect(f.request).toHaveBeenCalledOnce();
    expect(await f.service.generate({ ...f.input, voice: 'coral' })).toMatchObject({ ok: false });
    expect(f.store.get(f.session.id)).toEqual(f.session); expect(f.credentials.status().remainingRequests).toBe(36); expect(f.service.status().remainingRequests).toBe(35);
  });
  it.each([[401, 'AUTHENTICATION'], [403, 'AUTHENTICATION'], [429, 'RATE_LIMITED'], [500, 'UNAVAILABLE']] as const)('sanitizes %s and does not automatically retry', async (status, code) => {
    const f = fixture(vi.fn<typeof fetch>().mockImplementation(async () => new Response('synthetic-key private data', { status })));
    const result = await f.service.generate(f.input); expect(result).toMatchObject({ ok: false, error: { code } }); expect(JSON.stringify(result)).not.toContain('synthetic-key'); expect(f.request).toHaveBeenCalledOnce();
  });
  it('rejects empty/truncated/HTML/oversized audio and cancels discarded streams', async () => {
    for (const bytes of [new Uint8Array(), mp3Fixture(1), new TextEncoder().encode('<script>secret</script>'), new Uint8Array(SPEECH_LIMITS.bytes + 1)]) {
      const f = fixture(vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } })));
      expect(await f.service.generate(f.input)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    }
    const cancel = vi.fn();
    const f = fixture(vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/html' } })));
    expect(await f.service.generate(f.input)).toMatchObject({ ok: false }); expect(cancel).toHaveBeenCalledOnce();
  });
  it('coalesces duplicate pending requests, rejects conflicts and discards results after cancellation', async () => {
    let resolve!: (r: Response) => void;
    const f = fixture(vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; })));
    const pending = f.service.generate(f.input); expect(f.service.generate({ ...f.input })).toBe(pending);
    expect(await f.service.generate({ ...f.input, operationId: randomUUID() })).toMatchObject({ ok: false });
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce()); f.service.cancel(f.input.operationId);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(f.request.mock.calls[0]![1]!.signal!.aborted).toBe(true); resolve(response()); await Promise.resolve(); expect(f.store.get(f.session.id)).toEqual(f.session);
  });
  it('times out stalled streams without waiting for an adapter and releases timers for a manual retry', async () => {
    vi.useFakeTimers(); const f = fixture(vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response(new ReadableStream(), { headers: { 'content-type': 'audio/mpeg' } })).mockImplementation(async () => response()), 100);
    const pending = f.service.generate(f.input); await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } }); expect(vi.getTimerCount()).toBe(0);
    expect(await f.service.generate(f.input)).toMatchObject({ ok: true }); expect(f.request).toHaveBeenCalledTimes(2);
  }, 15_000);
  it('revalidates the question after an external wait and never returns obsolete audio', async () => {
    let resolve!: (r: Response) => void;
    const f = fixture(vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; })));
    const pending = f.service.generate(f.input); await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
    f.store.delete(f.session.id); resolve(response()); expect(await pending).toMatchObject({ ok: false }); expect(f.store.history().sessions).toHaveLength(0);
  });
  it('does not reset the independent generation budget when keys are changed', async () => {
    const f = fixture(vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 429 })));
    for (let n = 0; n < 36; n++) expect(await f.service.generate({ ...f.input, operationId: randomUUID() })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    createAIHandlers(f.credentials, () => f.service.cancel()).set([{ provider: 'openai', key: 'synthetic-new-key' }]);
    expect(await f.service.generate(f.input)).toMatchObject({ ok: false, error: { code: 'BUDGET_EXHAUSTED' } }); expect(f.request).toHaveBeenCalledTimes(36);
  });
  it('validates MP3 frames and ID3 bounds without decoding or executing response data', () => {
    expect(isMP3(mp3Fixture())).toBe(true); expect(isMP3(mp3Fixture(1))).toBe(false);
    const id3 = new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,0, ...mp3Fixture(4)]); expect(isMP3(id3)).toBe(true);
    id3[6] = 255; expect(isMP3(id3)).toBe(false);
  });
});

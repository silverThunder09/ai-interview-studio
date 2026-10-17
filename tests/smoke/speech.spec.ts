import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture } from '../fixtures/interview';
import { mp3Fixture } from '../fixtures/speech';

test('question speech requires consent, plays real synthetic MP3 bytes and cleans up before recording', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-speech-')), profile = join(directory, 'profile'); await mkdir(profile);
  const env = Object.fromEntries(Object.entries(process.env).filter((x): x is [string,string] => typeof x[1] === 'string')); delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  const app = await electron.launch({ chromiumSandbox: true, env, ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
    args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), '--use-fake-device-for-media-stream', '--mute-audio'] });
  try {
    await app.evaluate(({ app }, path) => app.setPath('userData', path), profile);
    await app.evaluate((_electron, bytes) => {
      Reflect.set(globalThis, 'syntheticSpeechCalls', 0);
      globalThis.fetch = async (url, init) => {
        if (url !== 'https://api.openai.com/v1/audio/speech') throw new Error('Unexpected synthetic destination');
        const data = JSON.parse(String(init?.body));
        if (Object.keys(data).sort().join(',') !== 'input,model,response_format,voice' || data.response_format !== 'mp3') throw new Error('Unexpected synthetic payload');
        const count = Number(Reflect.get(globalThis, 'syntheticSpeechCalls')) + 1; Reflect.set(globalThis, 'syntheticSpeechCalls', count);
        return count === 1 ? new Response(null, { status: 429 }) : new Response(new Uint8Array(bytes), { headers: { 'content-type': 'audio/mpeg' } });
      };
    }, Array.from(mp3Fixture()));
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => {
      const elements: HTMLAudioElement[] = [], tracks: MediaStreamTrack[] = [];
      Reflect.set(window, 'syntheticPlaybackElements', elements); Reflect.set(window, 'syntheticCaptureTracks', tracks);
      window.Audio = new Proxy(window.Audio, { construct(target, args) { const element = Reflect.construct(target, args); elements.push(element); return element; } });
      const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await acquire(constraints); tracks.push(...stream.getTracks()); return stream; };
    });
    expect((await page.evaluate(input => window.studio!.startInterview(input), startFixture())).ok).toBe(true);
    await page.getByRole('button', { name: '면접 기록', exact: true }).click(); await page.getByRole('button', { name: '이어하기', exact: true }).click();
    await page.getByLabel('내 답변', { exact: true }).fill('음성 재생 중에도 보존할 합성 답변');
    await page.getByLabel('질문 음성 읽기 사용 (OpenAI TTS)', { exact: true }).check();
    const speech = page.getByRole('region', { name: '질문 음성 읽기', exact: true });
    await speech.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true }).fill('synthetic-speech-key-not-real');
    await speech.getByRole('button', { name: '이번 실행에 키 등록', exact: true }).click();
    await speech.getByLabel('음성 읽기 모델 ID (OpenAI 콘솔에서 확인)', { exact: true }).fill('synthetic-tts');
    const generate = speech.getByRole('button', { name: '질문 음성 만들기', exact: true }); await expect(generate).toBeDisabled();
    expect(await app.evaluate(() => Reflect.get(globalThis, 'syntheticSpeechCalls'))).toBe(0);
    const question = await page.locator('.question-copy').innerText(); await expect(speech.locator('pre')).toHaveText(question);
    await speech.getByLabel('위 질문의 OpenAI 전송과', { exact: false }).check(); await generate.click();
    await expect(speech.getByRole('alert')).toContainText('요청 한도'); await expect(speech).toContainText('음성 읽기 남은 요청: 35 / 36');
    await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue('음성 재생 중에도 보존할 합성 답변');
    await generate.click(); await expect(speech.getByRole('status')).toContainText('직접 재생');
    expect(await page.evaluate(() => (Reflect.get(window, 'syntheticPlaybackElements') as HTMLAudioElement[]).length)).toBe(0);
    await speech.getByRole('button', { name: '질문 음성 재생', exact: true }).click(); await expect(speech.getByRole('status')).toHaveText('질문 음성 재생 중');
    await expect.poll(() => page.evaluate(() => { const audio = (Reflect.get(window, 'syntheticPlaybackElements') as HTMLAudioElement[]).at(-1)!; return !audio.paused && audio.readyState >= 2 && !audio.error; })).toBe(true);
    await speech.getByRole('button', { name: '재생 중지', exact: true }).click();
    expect(await page.evaluate(() => { const audio = (Reflect.get(window, 'syntheticPlaybackElements') as HTMLAudioElement[]).at(-1)!; return audio.paused && !audio.getAttribute('src'); })).toBe(true);
    await speech.getByRole('button', { name: '질문 음성 재생', exact: true }).click();
    expect(await app.evaluate(() => Reflect.get(globalThis, 'syntheticSpeechCalls'))).toBe(2);
    await page.getByLabel('음성 입력 사용 (OpenAI 전사)', { exact: true }).check(); await expect(speech).toHaveCount(0);
    expect(await page.evaluate(() => (Reflect.get(window, 'syntheticPlaybackElements') as HTMLAudioElement[]).every(a => a.paused && !a.getAttribute('src')))).toBe(true);
    const voice = page.getByRole('region', { name: '음성 답변 입력', exact: true });
    await voice.getByLabel('음성 전사 모델 ID (OpenAI 콘솔에서 확인)', { exact: true }).fill('synthetic-transcribe');
    await voice.getByLabel('이 답변을 위해 마이크를 사용하고', { exact: false }).check(); await voice.getByRole('button', { name: '녹음 시작', exact: true }).click();
    await expect(voice.getByRole('status')).toContainText('녹음 중');
    await page.getByLabel('질문 음성 읽기 사용 (OpenAI TTS)', { exact: true }).check(); await expect(voice).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => { const tracks = Reflect.get(window, 'syntheticCaptureTracks') as MediaStreamTrack[]; return tracks.length > 0 && tracks.every(t => t.readyState === 'ended'); })).toBe(true);
    let externalAudioRequests = 0; await page.route('https://blocked.invalid/**', route => { externalAudioRequests++; return route.abort(); });
    expect(await page.evaluate(() => new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No media CSP event')), 2000);
      const listener = (event: SecurityPolicyViolationEvent) => { if (event.effectiveDirective === 'media-src') { clearTimeout(timer); document.removeEventListener('securitypolicyviolation', listener); resolve(event.effectiveDirective); } };
      document.addEventListener('securitypolicyviolation', listener); const audio = new Audio('https://blocked.invalid/question.mp3'); audio.load();
    }))).toBe('media-src'); expect(externalAudioRequests).toBe(0); expect(errors).toEqual([]);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

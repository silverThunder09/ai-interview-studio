import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixture } from '../fixtures/interview';

test('explicit audio capture and synthetic transcription preserve drafts and require review before saving', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-voice-smoke-')), profile = join(directory, 'profile'); await mkdir(profile);
  const env = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')); delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  const application = await electron.launch({ chromiumSandbox: true, env,
    ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
    args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), '--use-fake-device-for-media-stream'] });
  try {
    await application.evaluate(({ app }, path) => { app.setPath('userData', path); }, profile);
    await application.evaluate(() => {
      Reflect.set(globalThis, 'syntheticVoiceCalls', 0);
      globalThis.fetch = async (url, init) => {
        if (url !== 'https://api.openai.com/v1/audio/transcriptions' || !(init?.body instanceof FormData)) throw new Error('Unexpected synthetic destination');
        const form = init.body;
        if ([...form.keys()].sort().join(',') !== 'file,language,model,response_format' || !(form.get('file') instanceof Blob)) throw new Error('Unexpected synthetic payload');
        const count = Number(Reflect.get(globalThis, 'syntheticVoiceCalls')) + 1; Reflect.set(globalThis, 'syntheticVoiceCalls', count);
        return count === 1 ? new Response(null, { status: 429 }) : new Response(JSON.stringify({ text: '합성 마이크 전사를 검토합니다.' }), { headers: { 'content-type': 'application/json' } });
      };
    });
    const page = await application.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const started = await page.evaluate(request => window.studio!.startInterview(request), startFixture()); expect(started.ok).toBe(true);
    await page.getByRole('button', { name: '면접 기록', exact: true }).click(); await page.getByRole('button', { name: '이어하기', exact: true }).click();
    await page.getByLabel('내 답변', { exact: true }).fill('기존에 입력한 합성 답변');
    await page.getByRole('button', { name: '2. 답변 녹음·전사', exact: true }).click();
    const voice = page.getByRole('region', { name: '음성 답변 입력', exact: true });
    await expect(voice.getByRole('button', { name: '녹음 시작', exact: true })).toBeDisabled();
    await voice.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true }).fill('synthetic-voice-key-not-real');
    await voice.getByRole('button', { name: '이번 실행에 키 등록', exact: true }).click();
    await expect(voice.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true })).toHaveValue('');
    await voice.getByLabel('음성 전사 모델 ID (OpenAI 콘솔에서 확인)', { exact: true }).fill('synthetic-transcribe');
    await voice.getByLabel('이 답변을 위해 마이크를 사용하고', { exact: false }).check();
    await voice.getByRole('button', { name: '녹음 시작', exact: true }).click();
    await expect(voice.getByRole('status')).toContainText('녹음 중 · 1 / 60초');
    // An armed audio operation still cannot grant a camera request.
    expect(await page.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); stream.getTracks().forEach(track => track.stop()); return 'allowed'; }
      catch (error) { return error instanceof DOMException ? error.name : 'unknown'; }
    })).toBe('NotAllowedError');
    await voice.getByRole('button', { name: '녹음 중지', exact: true }).click();
    const transcribe = voice.getByRole('button', { name: '동의한 음성 전사', exact: true }); await expect(transcribe).toBeDisabled();
    expect(await application.evaluate(() => Reflect.get(globalThis, 'syntheticVoiceCalls'))).toBe(0);
    await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue('기존에 입력한 합성 답변');
    const consent = voice.getByLabel('선택 음성의 OpenAI 전송과', { exact: false }); await consent.check(); await transcribe.click();
    await expect(voice.getByRole('alert')).toContainText('요청 한도');
    await expect(voice).toContainText('전사 남은 요청: 35 / 36');
    await expect(page.getByRole('heading', { name: '질문 1', exact: true })).toBeVisible();
    await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue('기존에 입력한 합성 답변');
    await transcribe.click();
    const reviewed = voice.getByLabel('전사 검토·수정 (아직 제출되지 않음)', { exact: true }); await expect(reviewed).toHaveValue('합성 마이크 전사를 검토합니다.');
    const apply = voice.getByRole('button', { name: '답변 입력에 적용', exact: true }); await expect(apply).toBeDisabled();
    await reviewed.fill('직접 수정한 합성 전사'); await voice.getByLabel('현재 입력한 답변을 검토한 전사 내용으로 교체합니다.', { exact: true }).check(); await apply.click();
    await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue('직접 수정한 합성 전사');
    await expect(page.getByLabel('내 답변', { exact: true })).toBeFocused();
    await expect(voice).toHaveCount(0);
    await expect(page.getByRole('button', { name: '3. 답변 검토·제출', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: '질문 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click(); await expect(page.getByRole('heading', { name: '질문 2', exact: true })).toBeVisible();
    expect(await application.evaluate(() => Reflect.get(globalThis, 'syntheticVoiceCalls'))).toBe(2);
    expect(errors).toEqual([]);
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
});

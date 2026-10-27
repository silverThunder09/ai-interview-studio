import { registerTemporaryKey, selectModel } from './settings-helpers';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { docxFixture } from '../fixtures/resume';

test('Gemini speaker roles drive the question UI and live WebGL interviewer without losing state', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-gemini-'));
  const profile = join(directory, 'profile'); await mkdir(profile);
  const quote = '합성 프로젝트에서 API를 구현했습니다.';
  const file = join(directory, 'synthetic.docx');
  await writeFile(file, docxFixture(`<w:p><w:r><w:t>${quote}</w:t></w:r></w:p>`));
  const env = Object.fromEntries(Object.entries(process.env).filter((x): x is [string, string] => typeof x[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ chromiumSandbox: true, env,
      ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
      args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), ...(process.env.STUDIO_SMOKE_HEADLESS === '1' ? ['--ozone-platform=headless', '--use-gl=angle', '--use-angle=swiftshader'] : []), `--user-data-dir=${profile}`] });
    // Strict synthetic REST endpoint; nothing reaches Google and there is no product test flag.
    await app.evaluate(() => {
      (globalThis as typeof globalThis & { __geminiFetches: number }).__geminiFetches = 0;
      globalThis.fetch = async (url, init) => {
        (globalThis as typeof globalThis & { __geminiFetches: number }).__geminiFetches++;
        const body = JSON.parse(String(init?.body));
        const headers = init?.headers as Record<string, string>;
        if (url !== 'https://generativelanguage.googleapis.com/v1beta/models/synthetic-gemini-model:generateContent'
          || init?.method !== 'POST' || headers['x-goog-api-key'] !== 'synthetic-gemini-key-never-real'
          || body.generationConfig?.responseFormat?.text?.mimeType !== 'APPLICATION_JSON'
          || body.generationConfig.maxOutputTokens !== 600 || body.tools) {
          return new Response('synthetic invalid REST enum', { status: 400 });
        }
        const data = JSON.parse(body.contents[0].parts[0].text);
        const expectedSpeaker = data.questionNumber <= 2 ? 'b' : 'a';
        if (data.speakerId !== expectedSpeaker || body.generationConfig.responseFormat.text.schema?.properties?.speakerId?.enum?.[0] !== expectedSpeaker) {
          return new Response('synthetic invalid speaker contract', { status: 400 });
        }
        const value = { text: `합성 Gemini ${data.questionNumber}번 ${data.speakerId.toUpperCase()} 질문입니다.`, evidenceId: data.evidence[0]?.id ?? null, speakerId: data.speakerId };
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
          usageMetadata: { promptTokenCount: data.questionNumber * 10, candidatesTokenCount: 3, totalTokenCount: data.questionNumber * 10 + 3 } }),
          { headers: { 'content-type': 'application/json' } });
      };
    });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('button', { name: '이력서', exact: true }).click();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, file);
    await page.getByRole('button', { name: '이력서 불러오기', exact: true }).click();
    await expect(page.getByLabel('누락·읽기 순서를 원본과 비교하고 수정하세요.')).toHaveValue(quote);
    await page.getByRole('button', { name: '검토 완료', exact: true }).click();
    await page.getByLabel('외부 API로 AI 질문 생성', { exact: true }).check();
    await registerTemporaryKey(page, 'synthetic-gemini-key-never-real', 'gemini');
    await selectModel(page, 'gemini', 'synthetic-gemini-model');
    await page.getByLabel('첫 질문에 보낼 구절', { exact: false }).fill(quote);
    await page.getByLabel('선택 서비스·모델·구절과 과금·보존 가능성', { exact: false }).check();
    await page.getByLabel('이력서 검토 내용과 면접 기록의 로컬 저장에 동의합니다.').check();
    await page.getByRole('button', { name: '동의한 내용으로 AI 면접 시작', exact: true }).click();
    const canvas = page.locator('.avatar-viewport canvas');
    await expect(canvas).toHaveAttribute('data-studio-ready', 'true');
    async function expectQuestion(number: number, speaker: 'a' | 'b') {
      await expect(page.getByRole('heading', { name: `질문 ${number}`, exact: true })).toBeVisible();
      await expect(page.getByText(`합성 Gemini ${number}번 ${speaker.toUpperCase()} 질문입니다.`, { exact: true })).toBeVisible();
      await expect(page.locator('.avatar-status')).toContainText(`현재 면접관 ${speaker === 'a' ? 'A · 기술 면접관' : 'B · 경험·협업 면접관'}`);
      await expect(canvas).toHaveAttribute('data-active', speaker);
      expect(await canvas.evaluate(c => (c as HTMLCanvasElement).getContext('webgl2')?.isContextLost())).toBe(false);
    }
    for (const [number, speaker] of [[1, 'b'], [2, 'b'], [3, 'a']] as const) {
      await expectQuestion(number, speaker);
      await expect(page.getByLabel('내 답변', { exact: true })).toHaveAttribute('maxlength', '2000');
      await page.getByLabel('내 답변', { exact: true }).fill(`${number}번 합성 답변`);
      const preview = page.getByRole('region', { name: '공유 문맥 미리보기', exact: true });
      await expect(preview.locator('pre')).toContainText(`${number}번 합성 답변`);
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { __geminiFetches: number }).__geminiFetches)).toBe(number);
      const localConsent = preview.getByRole('checkbox'); await expect(localConsent).not.toBeChecked();
      await localConsent.check();
      await page.getByLabel('내 답변', { exact: true }).fill(`${number}번 합성 답변 수정`);
      await expect(preview.locator('pre')).toContainText(`${number}번 합성 답변 수정`);
      await expect(localConsent).not.toBeChecked();
      await page.getByLabel('위 전송 범위·비용 가능성을 확인했습니다.', { exact: false }).check();
      await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
    }
    await expectQuestion(4, 'a');
    const answer = '잘못된 발언자 뒤에도 보존할 합성 답변';
    await page.getByLabel('내 답변', { exact: true }).fill(answer);
    await app.evaluate(() => {
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const data = JSON.parse(body.contents[0].parts[0].text);
        const value = { text: '잘못된 발언자의 합성 질문', evidenceId: null, speakerId: data.speakerId === 'a' ? 'b' : 'a' };
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 } }),
          { headers: { 'content-type': 'application/json' } });
      };
    });
    await page.getByLabel('위 전송 범위·비용 가능성을 확인했습니다.', { exact: false }).check();
    await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('AI 응답의 형식');
    await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue(answer);
    await expectQuestion(4, 'a');
    await expect(page.getByRole('region', { name: 'Gemini 사용량' })).toContainText('요청 시도 5회 · 일부 토큰 정보 미제공 5회');
    await expect(page.getByRole('region', { name: 'Gemini 사용량' })).toContainText('전체: 127 토큰 · 5/5회 제공');
    for (const [responseStatus, expected] of [[400, 'HTTP 400'], [404, 'HTTP 404'], [200, 'AI 응답의 형식']] as const) {
      await app.evaluate((_electron, status) => {
        globalThis.fetch = async () => status === 200
          ? new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), { headers: { 'content-type': 'application/json' } })
          : new Response('synthetic-gemini-key-never-real and private synthetic error body', { status });
      }, responseStatus);
      await page.getByLabel('위 전송 범위·비용 가능성을 확인했습니다.', { exact: false }).check();
      await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(expected);
      await expect(page.getByRole('alert')).not.toContainText('synthetic-gemini-key-never-real');
      await expect(page.getByRole('alert')).not.toContainText('private synthetic error body');
      await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue(answer);
      await expectQuestion(4, 'a');
    }
    await page.getByRole('button', { name: '저장된 기록 보기', exact: true }).click();
    await page.getByRole('button', { name: '이어하기', exact: true }).click();
    await expectQuestion(4, 'a');
    await page.getByLabel('내 답변', { exact: true }).fill(answer);
    const restoredPreview = page.getByRole('region', { name: '공유 문맥 미리보기', exact: true });
    await expect(restoredPreview.locator('pre')).toContainText(answer);
    await expect(restoredPreview.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByRole('region', { name: 'Gemini 사용량' })).toContainText('요청 시도 8회 · 일부 토큰 정보 미제공 8회');
    await expect(page.getByRole('region', { name: 'Gemini 사용량' })).toContainText('입력: 112 토큰 · 5/8회 제공 (부분 합계)');
    await page.screenshot({ path: 'test-results/gemini-usage-restored.png', fullPage: true });
    const status = await page.evaluate(() => window.studio!.getAIStatus());
    expect(status).toMatchObject({ ok: true, value: { remainingRequests: 28 } }); // 4 successes + four rejected/failed responses; no retry.
    await app.evaluate(() => {
      (globalThis as typeof globalThis & { __sharedRequests: number }).__sharedRequests = 0;
      globalThis.fetch = async (_url, init) => {
        const data = JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text);
        const state = globalThis as typeof globalThis & { __sharedRequests: number; __expectedContext?: unknown };
        state.__sharedRequests++;
        const position = (data.questionNumber - 1) % 4;
        const kind = position === 0 ? 'experience' : position === 2 ? 'technical' : 'follow-up';
        const speaker = position < 2 ? 'b' : 'a';
        if (data.kind !== kind || data.speakerId !== speaker || JSON.stringify(data.context) !== JSON.stringify(state.__expectedContext) || JSON.stringify(data).length > 8_000) return new Response('synthetic context mismatch', { status: 400 });
        const value = { text: `합성 Gemini ${data.questionNumber}번 ${speaker.toUpperCase()} 질문입니다.`, speakerId: speaker, evidenceId: kind === 'technical' ? null : kind === 'experience' ? 'evidence-1' : 'answer-previous' };
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { totalTokenCount: 7 } }), { headers: { 'content-type': 'application/json' } });
      };
    });
    for (let number = 4; number <= 12; number++) {
      await expectQuestion(number, (number - 1) % 4 < 2 ? 'b' : 'a');
      await page.getByLabel('내 답변', { exact: true }).fill(`${number}번 공유 문맥 합성 답변`);
      const region = page.getByRole('region', { name: '공유 문맥 미리보기', exact: true });
      let expected: unknown;
      if (number < 12) {
        await expect(region.locator('pre')).toContainText(`${number}번 공유 문맥 합성 답변`);
        if (number % 2 === 0) { expected = JSON.parse(await region.locator('pre').innerText()); await region.getByRole('checkbox').check(); }
        else await expect(region.getByRole('checkbox')).not.toBeChecked();
      } else await expect(region.getByRole('checkbox')).toBeDisabled();
      await app.evaluate((_electron, value) => { (globalThis as typeof globalThis & { __expectedContext?: unknown }).__expectedContext = value; }, expected);
      await page.getByLabel('위 전송 범위·비용 가능성을 확인했습니다.', { exact: false }).check();
      await page.getByRole('button', { name: number === 12 ? '답변 저장하고 완료' : '답변 저장하고 다음 질문', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: '이번 연습을 완료했습니다' })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { __sharedRequests: number }).__sharedRequests)).toBe(8);
    expect(errors).toEqual([]);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

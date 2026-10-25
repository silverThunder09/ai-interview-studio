import { registerTemporaryKey, selectModel } from './settings-helpers';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { docxFixture } from '../fixtures/resume';

test('Gemini uses the REST MIME enum and distinguishes safe request/model/response failures without losing an answer', async () => {
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
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(String(init?.body));
        const headers = init?.headers as Record<string, string>;
        if (url !== 'https://generativelanguage.googleapis.com/v1beta/models/synthetic-gemini-model:generateContent'
          || init?.method !== 'POST' || headers['x-goog-api-key'] !== 'synthetic-gemini-key-never-real'
          || body.generationConfig?.responseFormat?.text?.mimeType !== 'APPLICATION_JSON'
          || body.generationConfig.maxOutputTokens !== 600 || body.tools) {
          return new Response('synthetic invalid REST enum', { status: 400 });
        }
        const data = JSON.parse(body.contents[0].parts[0].text);
        if (data.speakerId !== 'b' || body.generationConfig.responseFormat.text.schema?.properties?.speakerId?.enum?.[0] !== 'b') {
          return new Response('synthetic invalid speaker contract', { status: 400 });
        }
        const value = { text: '합성 Gemini 질문입니다. 검증 방법을 설명해 주세요.', evidenceId: data.evidence[0].id, speakerId: data.speakerId };
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }),
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
    await expect(page.getByRole('heading', { name: '질문 1', exact: true })).toBeVisible();
    await expect(page.getByText('합성 Gemini 질문입니다. 검증 방법을 설명해 주세요.', { exact: true })).toBeVisible();
    const answer = '서비스 실패 후에도 보존할 합성 답변';
    await page.getByLabel('내 답변', { exact: true }).fill(answer);
    for (const [status, expected] of [[400, 'HTTP 400'], [404, 'HTTP 404'], [200, 'AI 응답의 형식']] as const) {
      await app.evaluate((_electron, status) => {
        globalThis.fetch = async () => status === 200
          ? new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), { headers: { 'content-type': 'application/json' } })
          : new Response('synthetic-gemini-key-never-real and private synthetic error body', { status });
      }, status);
      await page.getByLabel('위 전송 범위·비용 가능성을 확인했습니다.', { exact: false }).check();
      await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(expected);
      await expect(page.getByRole('alert')).not.toContainText('synthetic-gemini-key-never-real');
      await expect(page.getByRole('alert')).not.toContainText('private synthetic error body');
      await expect(page.getByRole('heading', { name: '질문 1', exact: true })).toBeVisible();
      await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue(answer);
    }
    const status = await page.evaluate(() => window.studio!.getAIStatus());
    expect(status).toMatchObject({ ok: true, value: { remainingRequests: 32 } }); // 1 success + 3 manual failures; no auto retry.
    expect(errors).toEqual([]);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

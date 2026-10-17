import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { docxFixture } from '../fixtures/resume';

test('external AI requires selected context and per-turn consent, uses main-only synthetic transport and forgets keys on restart', async () => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-external-ai-'));
  const profile = join(directory, 'isolated-profile'); await mkdir(profile);
  const quote = '합성 프로젝트에서 Java API를 구현했습니다.';
  const file = join(directory, 'synthetic.docx'); await writeFile(file, docxFixture(`<w:p><w:r><w:t>${quote}</w:t></w:r></w:p>`));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  let application: ElectronApplication | undefined;
  async function launch() {
    application = await electron.launch({ chromiumSandbox: true, env,
      ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}), args: process.env.SMOKE_EXECUTABLE ? [] : ['.'] });
    await application.evaluate(({ app }, path) => { app.setPath('userData', path); }, profile);
    // Runtime interception in the test process only. There is no product test
    // flag, synthetic provider option, external call or real API key in this test.
    await application.evaluate(() => {
      globalThis.fetch = async (url, init) => {
        if (url !== 'https://api.openai.com/v1/chat/completions') throw new Error('Unexpected synthetic destination');
        const body = JSON.parse(String(init?.body));
        const data = JSON.parse(body.messages.at(-1).content);
        const value = { text: '합성 AI 질문: 선택 이유와 검증 방법을 설명해 주세요.', evidenceId: data.kind === 'follow-up' ? 'answer-previous' : data.kind === 'technical' ? null : 'evidence-1' };
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } });
      };
    });
    return application.firstWindow();
  }
  async function close() { await application?.close(); application = undefined; }
  try {
    let page = await launch();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: '이력서', exact: true }).click();
    await application!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, file);
    await page.getByRole('button', { name: '이력서 불러오기', exact: true }).click();
    await expect(page.getByLabel('누락·읽기 순서를 원본과 비교하고 수정하세요.')).toHaveValue(quote);
    await page.getByRole('button', { name: '검토 완료', exact: true }).click();
    await page.getByLabel('외부 API로 AI 질문 생성', { exact: true }).check();
    await expect(page.getByLabel('면접 서비스', { exact: true }).locator('option')).toHaveCount(3);
    await page.getByLabel('이력서 검토 내용과 면접 기록의 로컬 저장에 동의합니다.').check();
    const start = page.getByRole('button', { name: '동의한 내용으로 AI 면접 시작', exact: true });
    await expect(start).toBeDisabled();
    await page.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true }).fill('synthetic-api-key-not-real');
    await page.getByRole('button', { name: '이번 실행에 키 등록', exact: true }).click();
    await expect(page.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true })).toHaveValue('');
    await expect(page.getByText('키를 이번 실행에 등록했습니다.', { exact: false })).toBeVisible();
    await page.getByLabel('모델 ID (서비스 콘솔에서 확인)', { exact: true }).fill('synthetic-model');
    await page.getByLabel('첫 질문에 보낼 구절', { exact: false }).fill('없는 합성 경력');
    await expect(start).toBeDisabled();
    await page.getByLabel('첫 질문에 보낼 구절', { exact: false }).fill(quote);
    await expect(page.locator('.transmission-preview pre')).toHaveText(quote);
    await expect(start).toBeDisabled();
    await page.getByLabel('선택 서비스·모델·구절과 과금·보존 가능성', { exact: false }).check();
    await start.click();
    await expect(page.getByRole('heading', { name: '질문 1', exact: true })).toBeVisible();
    await expect(page.getByText('OpenAI · synthetic-model에서 생성한 질문입니다.', { exact: false })).toBeVisible();
    await expect(page.locator('.question-card blockquote')).toContainText('사용자 선택 구절');
    await page.getByLabel('내 답변', { exact: true }).fill('합성 답변으로만 검증합니다.');
    const next = page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true });
    await expect(next).toBeDisabled();
    await expect(page.locator('.transmission-preview pre')).toHaveText('합성 답변으로만 검증합니다.');
    await page.getByLabel('위 전송 범위·비용 가능성을 확인했습니다.', { exact: false }).check();
    await next.click();
    await expect(page.getByRole('heading', { name: '질문 2', exact: true })).toBeVisible();
    await expect(page.locator('.transmission-preview pre')).toContainText('개인 문맥 없이');
    await expect(next).toBeDisabled();
    expect(errors).toEqual([]);
    await close();
    page = await launch();
    await page.getByRole('button', { name: '면접 기록', exact: true }).click();
    await expect(page.getByText('외부 AI · 답변 1개', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '이어하기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '질문 2', exact: true })).toBeVisible();
    await page.getByLabel('내 답변', { exact: true }).fill('실패 후에도 남는 합성 입력');
    await page.getByLabel('위 전송 범위·비용 가능성을 확인했습니다.', { exact: false }).check();
    await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('인증');
    await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue('실패 후에도 남는 합성 입력');
    await expect(page.getByRole('heading', { name: '질문 2', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const status = await page.evaluate(() => window.studio!.getAIStatus());
    expect(status).toMatchObject({ ok: true, value: { providers: [{ provider: 'openai', configured: false }, { provider: 'claude', configured: false }, { provider: 'gemini', configured: false }] } });
  } finally { await close(); await rm(directory, { recursive: true, force: true }); }
});

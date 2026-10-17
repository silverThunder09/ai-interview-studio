import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { docxFixture } from '../fixtures/resume';
import { startFixture } from '../fixtures/interview';

test('local practice requires consent, survives restart, preserves failed answers and deletes records', async () => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-practice-'));
  const profile = join(directory, 'isolated-profile'); await mkdir(profile);
  const databaseFile = join(profile, 'interviews.sqlite');
  const resumeFile = join(directory, 'synthetic.docx'); await writeFile(resumeFile, docxFixture('<w:p><w:r><w:t>합성 프로젝트에서 Java API를 구현했습니다.</w:t></w:r></w:p>'));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  let application: ElectronApplication | undefined;
  const runtimeErrors: string[] = [];
  async function launch() {
    application = await electron.launch({
      chromiumSandbox: true, env,
      ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
      args: process.env.SMOKE_EXECUTABLE ? [] : ['.'],
    });
    // Store creation is lazy. Select an isolated profile before any history or
    // interview request; never read or delete a user's real application records.
    await application.evaluate(({ app }, path) => { app.setPath('userData', path); }, profile);
    const page = await application.firstWindow();
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    return page;
  }
  async function close() { await application?.close(); application = undefined; }
  try {
    let page = await launch();
    const invalid = await page.evaluate(async (request) => window.studio!.startInterview({ ...request, storageConsent: false } as never), startFixture());
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await expect(access(databaseFile)).rejects.toThrow();
    async function startFromResume() {
      await page.getByRole('button', { name: '이력서', exact: true }).click();
      await application!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resumeFile);
      await page.getByRole('button', { name: '이력서 불러오기', exact: true }).click();
      await expect(page.getByLabel('누락·읽기 순서를 원본과 비교하고 수정하세요.')).toHaveValue('합성 프로젝트에서 Java API를 구현했습니다.');
      await page.getByRole('button', { name: '검토 완료', exact: true }).click();
      const start = page.getByRole('button', { name: '이 내용으로 연습 시작', exact: true });
      await expect(start).toBeDisabled();
      await page.getByLabel('이력서 검토 내용과 면접 기록의 로컬 저장에 동의합니다.').check();
      await start.click();
      await expect(page.getByRole('heading', { name: '질문 1', exact: true })).toBeVisible();
    }
    await startFromResume();
    const localNotice = page.getByText('기본 질문은 준비된 질문과 답변 인용이며', { exact: false });
    await expect(localNotice).toContainText('AI 분석·평가가 아닙니다.');
    await expect(localNotice).toContainText('별도로 선택하는 음성 입력·읽기는 OpenAI 전송과 비용이 발생할 수 있습니다.');
    await expect(page.locator('.question-card blockquote')).toContainText('추출 원문 · 단락 1');
    const initial = await page.evaluate(async () => {
      const history = await window.studio!.getInterviewHistory();
      if (!history.ok || history.value.sessions.length !== 1) throw new Error('Expected one synthetic session');
      const session = await window.studio!.getInterview(history.value.sessions[0]!.id);
      if (!session.ok) throw new Error('Expected synthetic session');
      return session.value;
    });
    const firstAnswer = '합성 API를 구현했습니다. <script>window.interviewLeak=1</script>';
    await page.getByLabel('내 답변', { exact: true }).fill(firstAnswer);
    await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
    await expect(page.getByRole('heading', { name: '질문 2', exact: true })).toBeVisible();
    await expect(page.locator('.question-card blockquote')).toContainText(firstAnswer);
    expect(await page.evaluate(() => Reflect.get(window, 'interviewLeak'))).toBeUndefined();
    const retried = await page.evaluate(async (request) => window.studio!.submitInterviewAnswer(request), { sessionId: initial.id, questionId: initial.turns[0]!.question.id, answer: firstAnswer });
    expect(retried.ok && retried.value.turns.length).toBe(2);

    const fixture = new DatabaseSync(databaseFile);
    fixture.exec("CREATE TRIGGER synthetic_write_failure BEFORE UPDATE OF answer ON turns BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;");
    fixture.close();
    await page.getByLabel('내 답변', { exact: true }).fill('저장 실패 후에도 남아야 하는 합성 답변');
    await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('기록 저장소나 질문 생성에 접근하지 못했습니다');
    await expect(page.getByLabel('내 답변', { exact: true })).toHaveValue('저장 실패 후에도 남아야 하는 합성 답변');
    await expect(page.getByRole('heading', { name: '질문 2', exact: true })).toBeVisible();
    const recovery = new DatabaseSync(databaseFile); recovery.exec('DROP TRIGGER synthetic_write_failure'); recovery.close();
    await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
    await expect(page.getByRole('heading', { name: '질문 3', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await close();

    page = await launch();
    await page.getByRole('button', { name: '면접 기록', exact: true }).click();
    await expect(page.locator('.history-list article')).toHaveCount(1);
    await expect(page.getByText('로컬 연습 · 답변 2개', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '이어하기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '질문 3', exact: true })).toBeVisible();
    await expect(page.locator('.question-card .tag')).toHaveText('일반 기술 질문');
    for (let number = 3; number <= 12; number++) {
      await page.getByLabel('내 답변', { exact: true }).fill(`합성 답변 ${number}: 선택 이유와 대안, 한계를 설명합니다.`);
      await page.getByRole('button', { name: /답변 저장하고 (다음 질문|완료)/ }).click();
      if (number < 12) await expect(page.getByRole('heading', { name: `질문 ${number + 1}`, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: '이번 연습을 완료했습니다', exact: true })).toBeVisible();
    await page.locator('.transcript').first().locator('summary').click();
    await expect(page.locator('.transcript article')).toHaveCount(12);
    await page.screenshot({ path: 'test-results/local-interview.png', fullPage: true });
    await startFromResume();
    await page.getByRole('button', { name: '면접 기록', exact: true }).click();
    const records = page.locator('.history-list article');
    await expect(records).toHaveCount(2);
    await records.filter({ has: page.getByText('완료', { exact: true }) }).getByRole('button', { name: '이 기록 삭제', exact: true }).click();
    await page.getByRole('group', { name: '기록 삭제 확인', exact: true }).getByRole('button', { name: '취소', exact: true }).click();
    await expect(records).toHaveCount(2);
    await records.filter({ has: page.getByText('완료', { exact: true }) }).getByRole('button', { name: '이 기록 삭제', exact: true }).click();
    await page.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await expect(records).toHaveCount(1);
    await expect(records.first().getByText('진행 중', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '전체 기록 삭제', exact: true }).click();
    await page.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await expect(records).toHaveCount(0);
    await expect(page.getByRole('button', { name: '현재 연습', exact: true })).toHaveCount(0);
    await close();
    page = await launch();
    await page.getByRole('button', { name: '면접 기록', exact: true }).click();
    await expect(page.getByRole('heading', { name: '저장된 면접 기록이 없습니다', exact: true })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  } finally { await close(); await rm(directory, { recursive: true, force: true }); }
});

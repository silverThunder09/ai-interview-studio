import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { docxFixture } from '../fixtures/resume';

test('redesigned screens remain usable in both themes and at the minimum window size', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-visual-'));
  const resume = join(directory, 'synthetic.docx');
  await writeFile(resume, docxFixture('<w:p><w:r><w:t>합성 프로젝트에서 Java API를 구현했습니다.</w:t></w:r></w:p>'));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ chromiumSandbox: true, env,
    ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
    args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), `--user-data-dir=${join(directory, 'profile')}`],
  });
  async function noHorizontalOverflow(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('heading', { name: /좋은 면접은/ })).toBeVisible();
    for (const size of [{ width: 1280, height: 850 }, { width: 860, height: 640 }]) {
      await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]!.setSize(bounds.width, bounds.height), size);
      for (const theme of ['라이트', '다크', '시스템']) {
        await page.getByRole('button', { name: '설정', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '앱 설정' });
        await dialog.getByRole('button', { name: theme, exact: true }).click();
        await expect(dialog.getByRole('button', { name: theme, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true })).toBeVisible();
        expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await dialog.getByRole('button', { name: '설정 닫기', exact: true }).scrollIntoViewIfNeeded();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('button', { name: '설정', exact: true })).toBeFocused();
        await noHorizontalOverflow(page);
        await page.screenshot({ path: `test-results/design-home-${size.width}-${theme}.png`, fullPage: true });
      }
      await page.getByRole('button', { name: '이력서', exact: true }).click();
      await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resume);
      await page.getByRole('button', { name: '이력서 불러오기', exact: true }).click();
      await expect(page.getByLabel('누락·읽기 순서를 원본과 비교하고 수정하세요.')).toHaveValue('합성 프로젝트에서 Java API를 구현했습니다.');
      await noHorizontalOverflow(page);
      await page.getByRole('button', { name: '검토 완료', exact: true }).click();
      await page.getByLabel('이력서 검토 내용과 면접 기록의 로컬 저장에 동의합니다.').check();
      await page.getByRole('button', { name: '이 내용으로 연습 시작', exact: true }).click();
      await expect(page.getByRole('heading', { name: '질문 1', exact: true })).toBeVisible();
      await page.getByLabel('내 답변', { exact: true }).fill('합성 답변으로 화면 배치와 입력·저장 동작을 확인합니다.');
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `test-results/design-interview-${size.width}.png`, fullPage: true });
      await page.getByRole('button', { name: '답변 저장하고 다음 질문', exact: true }).click();
      await expect(page.getByRole('heading', { name: '질문 2', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '면접 기록', exact: true }).click();
      await expect(page.locator('.history-list article')).toHaveCount(size.width === 1280 ? 1 : 2);
      await noHorizontalOverflow(page);
      await page.getByRole('button', { name: '시작하기', exact: true }).click();
    }
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
});

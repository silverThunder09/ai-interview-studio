import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { docxFixture, pdfFixture } from '../fixtures/resume';

test('selected local documents are extracted, reviewed and cleared inside the sandbox', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-synthetic-'));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  const application = await electron.launch({
    chromiumSandbox: true, env,
    ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
    args: process.env.SMOKE_EXECUTABLE ? [] : ['.'],
  });
  try {
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '이력서', exact: true }).click();
    await expect(page.getByRole('heading', { name: '이력서 검토', exact: true })).toBeVisible();
    // Replace only the OS dialog in the test process. The production bridge,
    // sender checks, bounded file reader, packaged assets and workers stay real.
    async function select(name: string, bytes: Uint8Array) {
      const path = join(directory, name); await writeFile(path, bytes);
      await application.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, path);
      await page.getByRole('button', { name: /이력서 불러오기|다른 문서 선택/ }).click();
    }
    await application.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.getByRole('button', { name: '이력서 불러오기', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('파일 선택을 취소');

    await select('합성.docx', docxFixture());
    const editor = page.getByLabel('누락·읽기 순서를 원본과 비교하고 수정하세요.');
    await expect(editor).toHaveValue('합성 이력서 Java Spring');
    await expect(page.getByRole('heading', { name: '단락 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '검토 완료', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('검토를 완료');
    await editor.fill('사용자가 수정한 합성 내용');
    await expect(page.getByRole('button', { name: '검토 완료', exact: true })).toBeEnabled();
    await expect(page.locator('.source-text')).toContainText('합성 이력서 Java Spring');

    await select('합성.pdf', pdfFixture());
    await expect(editor).toHaveValue('Synthetic Java Spring resume');
    await expect(page.getByRole('heading', { name: '1페이지', exact: true })).toBeVisible();
    await select('한글.pdf', pdfFixture({ text: '합성 이력서', korean: true }));
    await expect(editor).toHaveValue('합성 이력서');

    for (const [name, bytes, message] of [
      ['암호화.pdf', pdfFixture({ encrypted: true }), '암호화된 문서'],
      ['스캔.pdf', pdfFixture({ text: '' }), 'OCR'],
      ['페이지한도.pdf', pdfFixture({ pages: 51 }), '문서 처리 한도'],
      ['손상.pdf', new TextEncoder().encode('%PDF-1.7 broken'), '문서를 읽을 수 없습니다'],
      ['위장.pdf', docxFixture(), '확장자와 실제 형식'],
    ] as const) {
      await select(name, bytes);
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(editor).toHaveValue('합성 이력서'); // failed replacement preserves edits
    }
    await page.getByRole('button', { name: '내용 비우기', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText('아직 불러온 이력서가 없습니다')).toBeVisible();
    await select('다시.docx', docxFixture('<w:p><w:r><w:t>&lt;script&gt;window.secret=1&lt;/script&gt;</w:t></w:r></w:p>'));
    await expect(editor).toHaveValue('<script>window.secret=1</script>');
    expect(await page.evaluate(() => Reflect.get(window, 'secret'))).toBeUndefined();
    await page.screenshot({ path: 'test-results/resume-review.png', fullPage: true });
    await page.getByRole('button', { name: '시작하기', exact: true }).click();
    await page.getByRole('button', { name: '이력서', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
});

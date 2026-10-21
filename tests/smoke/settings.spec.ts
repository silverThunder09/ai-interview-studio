import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openAPISettings } from './settings-helpers';

test('separate settings use OS encryption, survive restart and delete saved keys without sending requests', async () => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(join(tmpdir(), 'studio-protected-settings-'));
  const key = 'synthetic-windows-protected-key-never-real';
  const env = Object.fromEntries(Object.entries(process.env).filter((x): x is [string, string] => typeof x[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  // Fixed stage names only: never log profile paths, settings, keys or IPC values.
  async function stage<T>(name: 'launch' | 'profile' | 'block-network' | 'first-window' | 'decrypt' | 'close' | 'status' | 'cleanup-close' | 'cleanup-profile', action: () => Promise<T>): Promise<T> {
    console.log(`AIS_SETTINGS_SMOKE_STEP ${name}:begin`);
    const value = await action();
    console.log(`AIS_SETTINGS_SMOKE_STEP ${name}:end`);
    return value;
  }
  async function launch() {
    app = await stage('launch', () => electron.launch({ chromiumSandbox: true, env,
      ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
      args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`] }));
    expect(await stage('profile', () => app!.evaluate(({ app }) => app.getPath('userData')))).toBe(profile);
    await stage('block-network', () => app!.evaluate(() => { globalThis.fetch = async () => { throw new Error('No external requests are allowed during settings tests'); }; }));
    return stage('first-window', () => app!.firstWindow());
  }
  try {
    let page = await launch();
    await expect(page.getByRole('heading', { name: /좋은 면접은/ })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/settings-home.png', fullPage: true });
    let dialog = await openAPISettings(page);
    await expect(dialog.getByRole('button', { name: '설정 닫기', exact: true })).toBeFocused();
    await dialog.getByLabel('키를 등록할 서비스', { exact: true }).selectOption('gemini');
    await dialog.getByLabel('모델 ID (서비스 콘솔에서 확인)', { exact: true }).fill('synthetic-gemini-model');
    await dialog.getByRole('button', { name: '서비스·모델 저장', exact: true }).click();
    await expect(dialog.getByText('서비스와 모델 설정을 저장했습니다.', { exact: false })).toBeVisible();
    await expect(dialog.getByLabel('이 기기에 키 저장', { exact: false })).toBeChecked();
    await dialog.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true }).fill(key);
    await dialog.getByRole('button', { name: '키 저장', exact: true }).click();
    await expect(dialog.getByText('키를 이 기기에 암호화해 저장했습니다.', { exact: false })).toBeVisible();
    await expect(dialog.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true })).toHaveValue('');
    await dialog.getByRole('button', { name: '다크', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const settings = await readFile(join(profile, 'settings.json'), 'utf8');
    expect(settings).not.toContain(key); expect(settings).not.toContain(Buffer.from(key).toString('base64'));
    // Actual Electron safeStorage decrypt, no synthetic OS/crypto adapter in this test.
    expect(await stage('decrypt', () => app!.evaluate(({ safeStorage }, raw) => {
      const data = JSON.parse(raw);
      return safeStorage.isEncryptionAvailable() && safeStorage.decryptString(Buffer.from(data.keys.gemini, 'base64')) === 'synthetic-windows-protected-key-never-real';
    }, settings))).toBe(true);
    await page.screenshot({ path: 'test-results/settings-dialog.png', fullPage: true });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '설정', exact: true })).toBeFocused();
    await stage('close', () => app!.close()); app = undefined;
    page = await launch();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const status = await stage('status', () => page.evaluate(() => window.studio!.getAIStatus()));
    expect(status).toMatchObject({ ok: true, value: { remainingRequests: 36, preferences: { provider: 'gemini', models: { gemini: 'synthetic-gemini-model' } }, providers: expect.arrayContaining([{ provider: 'gemini', configured: true, saved: true }]) } });
    expect(JSON.stringify(status)).not.toContain(key);
    dialog = await openAPISettings(page);
    await expect(dialog.getByLabel('키를 등록할 서비스', { exact: true })).toHaveValue('gemini');
    await expect(dialog.getByLabel('모델 ID (서비스 콘솔에서 확인)', { exact: true })).toHaveValue('synthetic-gemini-model');
    await expect(dialog.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true })).toHaveValue('');
    await dialog.getByRole('button', { name: '선택 서비스 키 삭제', exact: true }).click();
    await expect(dialog.getByText('저장된 키와 이번 실행의 키를 삭제했습니다.', { exact: true })).toBeVisible();
    await stage('close', () => app!.close()); app = undefined;
    page = await launch();
    expect(await stage('status', () => page.evaluate(() => window.studio!.getAIStatus()))).toMatchObject({ ok: true, value: { providers: expect.arrayContaining([{ provider: 'gemini', configured: false, saved: false }]) } });
    expect(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).keys).toEqual({});
  } finally {
    if (app) await stage('cleanup-close', () => app!.close());
    await stage('cleanup-profile', () => rm(profile, { recursive: true, force: true }));
  }
});

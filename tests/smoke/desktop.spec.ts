import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('desktop starts with secure boundaries, Korean UI and ephemeral settings', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  const options = {
    chromiumSandbox: true,
    ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
    args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), '--use-fake-device-for-media-stream'], env,
  };
  const application = await electron.launch(options);
  try {
    const page = await application.firstWindow();
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await expect(page.getByRole('heading', { name: /좋은 면접은/ })).toBeVisible();
    await expect(page.getByText('MVP 0 · v0.1.0')).toBeVisible();
    await expect(page.getByRole('button', { name: '면접 시작하기' })).toBeDisabled();
    expect(page.url()).toBe('app://studio/index.html');
    expect(await page.evaluate(() => ({
      require: typeof Reflect.get(window, 'require'), process: typeof Reflect.get(window, 'process'),
      api: Object.keys(window.studio ?? {}).sort(),
    }))).toEqual({ require: 'undefined', process: 'undefined', api: ['getSnapshot', 'updateSettings'] });
    const rendererMetric = await application.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
      return app.getAppMetrics().find((metric) => metric.pid === pid);
    });
    expect(rendererMetric?.type).toBe('Tab');
    // Electron exposes OS sandbox metrics on Windows/macOS; Linux is not supported.
    if (process.platform !== 'linux') expect(rendererMetric?.sandboxed).toBe(true);

    const invalid = await page.evaluate(async () => window.studio!.updateSettings({ theme: 'invalid' } as never));
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(page.getByRole('button', { name: '시스템', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '다크', exact: true }).click();
    await expect(page.getByRole('button', { name: '다크', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('alert')).toHaveCount(0);

    let externalRequests = 0;
    await page.route('https://blocked.invalid/**', async (route) => {
      externalRequests++;
      await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: 'unexpected access' });
    });
    expect(await page.evaluate(async () => {
      try { await fetch('https://blocked.invalid/probe'); return 'allowed'; } catch { return 'blocked'; }
    })).toBe('blocked');
    expect(externalRequests).toBe(0);
    // Synthetic devices eliminate NotFoundError false positives on hardware-free CI.
    for (const constraints of [{ audio: true }, { video: true }]) {
      expect(await page.evaluate(async (request) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(request);
          stream.getTracks().forEach((track) => track.stop());
          return 'unexpectedly allowed';
        } catch (error) { return error instanceof DOMException ? error.name : 'unexpected failure'; }
      }, constraints)).toBe('NotAllowedError');
    }
    expect(await application.evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0]!;
      const response = await main.webContents.session.fetch('app://studio/index.html');
      return response.headers.get('content-security-policy');
    })).toContain("connect-src 'none'");

    const unauthorized = await application.evaluate(async ({ app, BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0]!;
      const other = new BrowserWindow({ show: false, webPreferences: {
        preload: `${app.getAppPath()}/out/preload/index.js`, session: main.webContents.session,
        sandbox: true, contextIsolation: true, nodeIntegration: false,
      } });
      try {
        await other.loadURL('app://studio/index.html');
        return await other.webContents.executeJavaScript('window.studio.getSnapshot()');
      } finally { other.destroy(); }
    });
    expect(unauthorized).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });

    await page.getByRole('button', { name: '시작하기', exact: true }).click();
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    await page.evaluate(() => { window.open('https://example.invalid'); });
    await expect.poll(() => application.windows().length).toBe(1);
    const navigation = application.evaluate(({ BrowserWindow }) => new Promise<boolean>((done) => {
      BrowserWindow.getAllWindows()[0]!.webContents.once('will-navigate', (event) => done(event.defaultPrevented));
    }));
    await page.evaluate(() => { window.location.href = 'https://example.invalid'; });
    expect(await navigation).toBe(true);
    // CDP can retain an unfinished navigation after Electron cancels it.
    // Verify the committed URL and surviving document through Electron instead.
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getURL())).toBe('app://studio/index.html');
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript('document.querySelector("h1").textContent'))).toContain('좋은 면접은');
    expect(runtimeErrors).toEqual([]);
  } finally { await application.close(); }

  const restarted = await electron.launch(options);
  try {
    const page = await restarted.firstWindow();
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(page.getByRole('button', { name: '시스템', exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally { await restarted.close(); }
});

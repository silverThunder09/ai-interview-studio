import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { avatarFixture, texturedAvatarFixture } from '../fixtures/avatar';

test('two WebGL interviewers, offline GLB/glTF import, motion, restoration and context cleanup', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'studio-avatar-smoke-'));
  const profile = join(directory, 'profile'); await mkdir(profile);
  const glb = join(directory, 'synthetic.glb'), gltf = join(directory, 'synthetic.gltf'), invalid = join(directory, 'invalid.gltf');
  await writeFile(glb, texturedAvatarFixture().bytes); await writeFile(gltf, avatarFixture('gltf').bytes);
  await writeFile(invalid, avatarFixture('gltf', j => { j.buffers = [{ byteLength: 108, uri: 'https://example.invalid/private.bin' }]; }).bytes);
  const env = Object.fromEntries(Object.entries(process.env).filter((p): p is [string, string] => typeof p[1] === 'string')); delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.SMOKE_EXECUTABLE) env.ELECTRON_RENDERER_URL = 'https://example.invalid';
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  async function launch() {
    app = await electron.launch({ chromiumSandbox: true, env,
      ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
      args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), ...(process.env.STUDIO_SMOKE_HEADLESS === '1' ? ['--ozone-platform=headless', '--use-gl=angle', '--use-angle=swiftshader'] : []), `--user-data-dir=${profile}`],
    });
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ app: electronApp }) => { electronApp.getAppMetrics(); });
    page.on('console', message => { if (message.type() === 'error' && /3D 초기화:|THREE.WebGLRenderer/.test(message.text())) console.log(message.text().slice(0, 600)); });
    await page.getByRole('button', { name: '3D 면접관', exact: true }).click();
    await expect(page.locator('.avatar-viewport canvas')).toHaveAttribute('data-studio-ready', 'true');
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: '모델 검증·복원 중입니다.' })).toHaveCount(0);
    return page;
  }
  try {
    let page = await launch();
    const canvas = page.locator('.avatar-viewport canvas');
    await expect.poll(async () => Number(await canvas.getAttribute('data-fps')), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await canvas.evaluate(c => (c as HTMLCanvasElement).getContext('webgl2')?.getParameter(0x1f02))).toContain('WebGL');
    async function visibleCharacters() {
      return canvas.evaluate(async c => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const gl = (c as HTMLCanvasElement).getContext('webgl2'); if (!gl || gl.isContextLost()) throw new Error('Expected a live WebGL scene');
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const left = new Set<string>(), right = new Set<string>();
        for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
          const offset = (y * width + x) * 4;
          (x < width / 2 ? left : right).add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
        }
        return { left: left.size, right: right.size };
      });
    }
    const rendered = await visibleCharacters();
    expect(rendered.left).toBeGreaterThan(20); expect(rendered.right).toBeGreaterThan(20);
    await page.getByRole('button', { name: '오른쪽 시점', exact: true }).click();
    await canvas.focus(); await page.keyboard.press('ArrowLeft');
    await page.getByRole('button', { name: '시점 초기화', exact: true }).click();
    await page.screenshot({ path: 'test-results/avatar-room-default.png', fullPage: true });
    console.log(JSON.stringify({ avatar_metrics: { rendered_fps: await canvas.getAttribute('data-fps'), runtime: process.platform, snapshot_not_peak: true,
      processes: await app!.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map(m => ({ type: m.type, cpu_percent: m.cpu.percentCPUUsage, working_set_kib: m.memory.workingSetSize }))),
      gpu_features: await app!.evaluate(({ app: electronApp }) => electronApp.getGPUFeatureStatus()),
    } }));
    await page.getByLabel('동작 확인 면접관').selectOption('b');
    await page.getByRole('button', { name: '발언 동작 미리보기 (무음)', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-speaking', 'b');
    await expect(canvas).toHaveAttribute('data-speaking', 'none', { timeout: 8_000 });
    await page.getByLabel('움직임 일시정지').check(); await expect(canvas).toHaveAttribute('data-paused', 'true');
    const paused = await visibleCharacters();
    expect(paused.left).toBeGreaterThan(20); expect(paused.right).toBeGreaterThan(20);
    await page.getByLabel('움직임 일시정지').uncheck();
    await page.getByText('면접관 모델 설정', { exact: true }).click();
    for (const [slot, path] of [['A', glb], ['B', gltf]] as const) {
      await app!.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, path);
      await page.getByRole('button', { name: `${slot} 모델 불러오기`, exact: true }).click();
      await expect(page.locator('.avatar-models article').nth(slot === 'A' ? 0 : 1)).toContainText(`synthetic.${slot === 'A' ? 'glb' : 'gltf'}`);
    }
    await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, invalid);
    await page.getByRole('button', { name: 'A 모델 불러오기', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('지원 범위를 벗어난 모델');
    await expect(page.locator('.avatar-models article').first()).toContainText('synthetic.glb');
    await page.getByRole('button', { name: '발언 동작 미리보기 (무음)', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-speaking', 'b');
    await page.getByRole('button', { name: '동작 미리보기 중지', exact: true }).click(); await expect(canvas).toHaveAttribute('data-speaking', 'none');
    await page.screenshot({ path: 'test-results/avatar-room-imported.png', fullPage: true });
    await canvas.evaluate(c => { c.addEventListener('webglcontextlost', () => Reflect.set(window, '__testAvatarContextReleased', true), { once: true }); });
    await page.getByRole('button', { name: '시작하기', exact: true }).click();
    await expect(canvas).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__testAvatarContextReleased'))).toBe(true);
    await app!.close(); app = undefined;
    page = await launch(); await page.getByText('면접관 모델 설정', { exact: true }).click();
    await expect(page.locator('.avatar-models article').first()).toContainText('synthetic.glb');
    await expect(page.locator('.avatar-models article').last()).toContainText('synthetic.gltf');
    await page.getByRole('button', { name: 'A 기본 모델', exact: true }).click();
    await expect(page.locator('.avatar-models article').first()).toContainText('기본 3D 캐릭터');
    await expect(page.locator('.avatar-models article').last()).toContainText('synthetic.gltf');
    expect(errors).toEqual([]);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
});

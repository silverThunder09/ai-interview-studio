import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('empty history permits confirmed cleanup after a failed history load, with cancellation and repeat safety', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'studio-history-clear-'));
  const env = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ chromiumSandbox: true, env,
    ...(process.env.SMOKE_EXECUTABLE ? { executablePath: resolve(process.env.SMOKE_EXECUTABLE) } : {}),
    args: [...(process.env.SMOKE_EXECUTABLE ? [] : ['.']), ...(process.env.STUDIO_SMOKE_HEADLESS === '1' ? ['--ozone-platform=headless', '--use-gl=angle', '--use-angle=swiftshader'] : []), `--user-data-dir=${profile}`],
  });
  let database: DatabaseSync | undefined;
  try {
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const file = await app.evaluate(({ app }) => app.getPath('userData'));
    database = new DatabaseSync(join(file, 'interviews.sqlite'));
    database.exec('BEGIN EXCLUSIVE');
    await page.getByRole('button', { name: '면접 기록', exact: true }).click();
    const clear = page.getByRole('button', { name: '전체 기록 삭제', exact: true });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(clear).toBeDisabled();
    database.exec('ROLLBACK'); database.close(); database = undefined;
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expect(page.getByRole('heading', { name: '저장된 면접 기록이 없습니다' })).toBeVisible();
    await expect(clear).toBeEnabled();
    await clear.click();
    const confirmation = page.getByRole('group', { name: '기록 삭제 확인' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: '취소', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByText('모든 면접 기록을 삭제했습니다.', { exact: true })).toHaveCount(0);
    await clear.click();
    await confirmation.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await expect(page.getByText('모든 면접 기록을 삭제했습니다.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '저장된 면접 기록이 없습니다' })).toBeVisible();
    await expect(clear).toBeEnabled();
    await clear.click(); await confirmation.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(await page.evaluate(async () => { const result = await window.studio!.getInterviewHistory(); return result.ok ? result.value.sessions.length : -1; })).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    database?.close(); await app.close(); await rm(profile, { recursive: true, force: true });
  }
});

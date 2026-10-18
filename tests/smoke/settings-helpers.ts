import { expect, type Locator, type Page } from '@playwright/test';
import type { AIProvider } from '../../src/shared/ai';

export async function openAPISettings(page: Page, source?: Locator) {
  await (source ?? page).getByRole('button', { name: source ? 'API 연결 설정' : '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '앱 설정', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('이번 실행의 남은 요청:', { exact: false })).toBeVisible();
  return dialog;
}
export async function registerTemporaryKey(page: Page, key: string, provider?: AIProvider, source?: Locator) {
  const dialog = await openAPISettings(page, source);
  if (provider) await dialog.getByLabel('키를 등록할 서비스', { exact: true }).selectOption(provider);
  const remember = dialog.getByLabel('이 기기에 키 저장', { exact: false });
  if (await remember.isEnabled()) await remember.uncheck();
  await dialog.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true }).fill(key);
  await dialog.getByRole('button', { name: '이번 실행에 키 등록', exact: true }).click();
  await expect(dialog.getByLabel('API 키 (저장 후 화면에서 비움)', { exact: true })).toHaveValue('');
  await expect(dialog.getByText('키를 이번 실행에 등록했습니다.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '설정 닫기', exact: true }).click();
}
export async function selectModel(page: Page, provider: AIProvider, model: string) {
  const dialog = await openAPISettings(page);
  await dialog.getByLabel('키를 등록할 서비스', { exact: true }).selectOption(provider);
  await dialog.getByLabel('모델 ID (서비스 콘솔에서 확인)', { exact: true }).fill(model);
  await dialog.getByRole('button', { name: '서비스·모델 저장', exact: true }).click();
  await expect(dialog.getByText('서비스와 모델 설정을 저장했습니다.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '설정 닫기', exact: true }).click();
}

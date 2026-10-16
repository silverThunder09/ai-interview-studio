import type { SelectedResume } from './resume';

export const CHANNELS = { snapshot: 'studio:snapshot', settings: 'studio:settings', resume: 'studio:select-resume' } as const;
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export interface Settings { locale: 'ko-KR'; theme: Theme; interviewRole: 'backend' }
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  locale: 'ko-KR', theme: 'system', interviewRole: 'backend',
});
export interface Snapshot { version: string; settings: Settings; stage: 'mvp-1-local' }
export type Result<T> = { ok: true; value: T } | {
  ok: false; error: { code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'UNAVAILABLE'; message: string };
};
export interface DesktopAPI {
  getSnapshot(): Promise<Result<Snapshot>>;
  updateSettings(settings: Settings): Promise<Result<Settings>>;
  selectResume(): Promise<Result<SelectedResume | null>>;
}

export function isSettings(value: unknown): value is Settings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  return keys.length === 3 && keys.every((key) => ['locale', 'theme', 'interviewRole'].includes(key)) && obj.locale === 'ko-KR' &&
    obj.interviewRole === 'backend' && THEMES.some((theme) => obj.theme === theme);
}

import { DEFAULT_SETTINGS, isSettings, type Result, type Settings, type Snapshot } from '../shared/contracts';

export function createHandlers(version: string) {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const invalid = (): Result<never> => ({
    ok: false, error: { code: 'INVALID_REQUEST', message: '설정 요청 형식이 올바르지 않습니다.' },
  });
  return {
    snapshot(args: unknown[]): Result<Snapshot> {
      if (args.length !== 0) return invalid();
      return { ok: true, value: { version, stage: 'mvp-0', settings: { ...settings } } };
    },
    update(args: unknown[]): Result<Settings> {
      if (args.length !== 1 || !isSettings(args[0])) return invalid();
      settings = { ...args[0] };
      return { ok: true, value: { ...settings } };
    },
  };
}

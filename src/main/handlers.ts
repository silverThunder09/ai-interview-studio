import { DEFAULT_SETTINGS, isSettings, type AvatarQuality, type Result, type Settings, type Snapshot } from '../shared/contracts';
import { isLocalSpeechVoices, type LocalSpeechVoices } from '../shared/local-speech';

export function createHandlers(version: string, persistence?: { settings(): Settings; updateSettings(settings: Settings): void }) {
  let settings: Settings = persistence?.settings() ?? { ...DEFAULT_SETTINGS };
  const invalid = (): Result<never> => ({
    ok: false, error: { code: 'INVALID_REQUEST', message: '설정 요청 형식이 올바르지 않습니다.' },
  });
  return {
    snapshot(args: unknown[]): Result<Snapshot> {
      if (args.length !== 0) return invalid();
      return { ok: true, value: { version, stage: 'mvp-1-local', settings: { ...settings } } };
    },
    update(args: unknown[]): Result<Settings> {
      if (args.length !== 1 || !isSettings(args[0])) return invalid();
      // Theme callers can hold an older snapshot. They must not overwrite quality.
      const next = { ...settings, locale: args[0].locale, theme: args[0].theme, interviewRole: args[0].interviewRole };
      try { persistence?.updateSettings(next); }
      catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '설정을 저장하지 못했습니다. 이전 설정은 유지됩니다.' } }; }
      settings = next;
      return { ok: true, value: { ...settings } };
    },
    avatarQuality(args: unknown[]): Result<AvatarQuality> {
      if (args.length !== 1 || args[0] !== 'low' && args[0] !== 'standard') return invalid();
      const next: Settings = { ...settings, avatarQuality: args[0] };
      try { persistence?.updateSettings(next); }
      catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '품질 설정을 저장하지 못했습니다. 이전 저장값은 유지됩니다.' } }; }
      settings = next;
      return { ok: true, value: args[0] };
    },
    localSpeechVoices(args: unknown[]): Result<LocalSpeechVoices> {
      if (args.length !== 1 || !isLocalSpeechVoices(args[0])) return invalid();
      const voices = { ...args[0] }, next: Settings = { ...settings, localSpeechVoices: voices };
      try { persistence?.updateSettings(next); }
      catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '목소리 설정을 저장하지 못했습니다. 이전 저장값은 유지됩니다.' } }; }
      settings = next;
      return { ok: true, value: voices };
    },
  };
}

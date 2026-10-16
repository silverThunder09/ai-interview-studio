import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isSettings, THEMES } from '../../src/shared/contracts';
import { createHandlers } from '../../src/main/handlers';

describe('settings trust boundary', () => {
  it.each(THEMES)('accepts the supported %s theme', (theme) => {
    expect(isSettings({ ...DEFAULT_SETTINGS, theme })).toBe(true);
  });
  it.each([null, undefined, [], '', 12, {},
    { ...DEFAULT_SETTINGS, theme: 'remote' }, { ...DEFAULT_SETTINGS, locale: 'en-US' },
    { ...DEFAULT_SETTINGS, interviewRole: 'admin' }, { ...DEFAULT_SETTINGS, apiKey: 'synthetic' },
    { locale: 'ko-KR', theme: 'system' },
  ])('rejects malformed or expanded settings: %j', (value) => {
    expect(isSettings(value)).toBe(false);
  });
  it('rejects invalid argument counts and does not mutate state on failure', () => {
    const handlers = createHandlers('0.1.0');
    expect(handlers.snapshot([{}]).ok).toBe(false);
    expect(handlers.update([]).ok).toBe(false);
    expect(handlers.update([DEFAULT_SETTINGS, 'extra']).ok).toBe(false);
    expect(handlers.update([{ ...DEFAULT_SETTINGS, theme: 'invalid' }]).ok).toBe(false);
    expect(handlers.snapshot([])).toEqual({ ok: true, value: { version: '0.1.0', stage: 'mvp-1-local', settings: DEFAULT_SETTINGS } });
  });
  it('does not accept expected values inherited from a prototype', () => {
    const payload = Object.assign(Object.create(DEFAULT_SETTINGS), { extra1: 1, extra2: 2, extra3: 3 });
    expect(isSettings(payload)).toBe(false);
  });
  it('copies settings and resets them when the app service restarts', () => {
    const handlers = createHandlers('0.1.0');
    const input = { ...DEFAULT_SETTINGS, theme: 'dark' as const };
    const updated = handlers.update([input]);
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error('Expected success');
    updated.value.theme = 'light';
    expect(handlers.snapshot([])).toMatchObject({ ok: true, value: { settings: { theme: 'dark' } } });
    expect(createHandlers('0.1.0').snapshot([])).toMatchObject({ ok: true, value: { settings: { theme: 'system' } } });
  });
});

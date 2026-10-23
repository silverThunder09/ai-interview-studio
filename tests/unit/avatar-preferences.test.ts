import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, isSettings } from '../../src/shared/contracts';
import { DEFAULT_AI_PREFERENCES } from '../../src/shared/ai';
import { LocalSettings } from '../../src/main/local-settings';
import { createHandlers } from '../../src/main/handlers';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'avatar-preferences-')); directories.push(directory);
  const path = join(directory, 'settings.json');
  const crypto = { isEncryptionAvailable: () => true, encryptString: () => Buffer.from('synthetic ciphertext'), decryptString: () => 'synthetic-key-123' };
  const open = () => new LocalSettings(() => path, crypto);
  return { path, open };
}
describe('main-owned avatar quality preferences', () => {
  it('accepts the old settings schema and only the optional bounded quality enum', () => {
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
    for (const avatarQuality of ['low', 'standard']) expect(isSettings({ ...DEFAULT_SETTINGS, avatarQuality })).toBe(true);
    for (const avatarQuality of [undefined, null, 'high', {}, [], 1]) expect(isSettings({ ...DEFAULT_SETTINGS, avatarQuality })).toBe(false);
    expect(isSettings({ ...DEFAULT_SETTINGS, avatarQuality: 'low', extra: true })).toBe(false);
  });
  it('restores quality across main services while preserving model, protected key and later theme changes', () => {
    const { path, open } = fixture(), storage = open();
    const preferences = { ...DEFAULT_AI_PREFERENCES, provider: 'gemini' as const };
    storage.updatePreferences(preferences); storage.setKey('gemini', 'synthetic-key-123', true);
    const beforeKeys = JSON.parse(readFileSync(path, 'utf8')).keys;
    const h = createHandlers('test', storage);
    expect(h.avatarQuality(['standard'])).toEqual({ ok: true, value: 'standard' });
    expect(h.update([{ ...DEFAULT_SETTINGS, theme: 'dark' }])).toMatchObject({ ok: true, value: { theme: 'dark', avatarQuality: 'standard' } });
    // A stale UI snapshot cannot roll quality back when changing the theme.
    expect(h.update([{ ...DEFAULT_SETTINGS, theme: 'light', avatarQuality: 'low' }])).toMatchObject({ ok: true, value: { theme: 'light', avatarQuality: 'standard' } });
    const restart = open(); expect(restart.settings()).toMatchObject({ avatarQuality: 'standard', theme: 'light' });
    expect(restart.preferences()).toEqual(preferences);
    expect(JSON.parse(readFileSync(path, 'utf8')).keys).toEqual(beforeKeys);
    expect(readFileSync(path, 'utf8')).not.toContain('synthetic-key-123');
  });
  it('rejects wrong IPC arity and values without changing the persisted state', () => {
    const { path, open } = fixture(), h = createHandlers('test', open()); h.avatarQuality(['standard']);
    const before = readFileSync(path, 'utf8');
    for (const args of [[], [undefined], ['high'], [{ quality: 'low' }], ['low', 'extra']]) expect(h.avatarQuality(args)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(readFileSync(path, 'utf8')).toBe(before); expect(h.snapshot([])).toMatchObject({ ok: true, value: { settings: { avatarQuality: 'standard' } } });
  });
  it('keeps the previous quality and conflicting file on a failed write, then retries safely', () => {
    const { path, open } = fixture(), h = createHandlers('test', open()); h.avatarQuality(['standard']);
    const before = readFileSync(path, 'utf8'); writeFileSync(path + '.tmp', 'existing conflict');
    expect(h.avatarQuality(['low'])).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(readFileSync(path, 'utf8')).toBe(before); expect(readFileSync(path + '.tmp', 'utf8')).toBe('existing conflict');
    expect(h.snapshot([])).toMatchObject({ ok: true, value: { settings: { avatarQuality: 'standard' } } });
    unlinkSync(path + '.tmp'); expect(h.avatarQuality(['low'])).toEqual({ ok: true, value: 'low' }); expect(open().settings().avatarQuality).toBe('low');
  });
  it('preserves malformed or unknown-version settings rather than overwriting keys to save quality', () => {
    const { path, open } = fixture();
    for (const text of ['{broken', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, avatarQuality: 'high' }, preferences: DEFAULT_AI_PREFERENCES, keys: {} })]) {
      writeFileSync(path, text); const h = createHandlers('test', open());
      expect(h.snapshot([])).toMatchObject({ ok: true, value: { settings: DEFAULT_SETTINGS } });
      expect(h.avatarQuality(['standard'])).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } }); expect(readFileSync(path, 'utf8')).toBe(text);
    }
  });
});

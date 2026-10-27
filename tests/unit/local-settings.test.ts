import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { LocalSettings, type SecretStorage } from '../../src/main/local-settings';
import { AICredentials, createAIHandlers } from '../../src/main/external-ai';
import { createHandlers } from '../../src/main/handlers';
import { DEFAULT_SETTINGS } from '../../src/shared/contracts';
import { DEFAULT_AI_PREFERENCES } from '../../src/shared/ai';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'studio-settings-unit-')); directories.push(directory);
  const file = join(directory, 'settings.json'), secret = randomBytes(32);
  // Synthetic crypto adapter exercises persistence/failure contracts; actual safeStorage is Windows smoke tested.
  const crypto: SecretStorage = {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'dpapi',
    encryptString: value => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decryptString: value => { const cipher = createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'); },
  };
  const open = () => new LocalSettings(() => file, crypto);
  return { directory, file, crypto, open };
}
const key = 'synthetic-protected-api-key';
const preferences = { ...DEFAULT_AI_PREFERENCES, provider: 'gemini' as const, models: { ...DEFAULT_AI_PREFERENCES.models, gemini: 'synthetic-gemini-model' } };

describe('protected local settings', () => {
  it('persists valid profiles across restart without changing saved credentials', () => {
    const { open } = setup(), storage = open();
    storage.setKey('gemini', key, true);
    storage.updatePreferences({ ...preferences, profiles: { a: 'balanced', b: 'supportive' } });
    const restored = open();
    expect(restored.preferences().profiles).toEqual({ a: 'balanced', b: 'supportive' });
    expect(restored.restore().gemini).toBe(key);
    const handlers = createAIHandlers(new AICredentials(restored), vi.fn());
    expect(handlers.preferences([{ ...preferences, profiles: { a: 'invalid', b: 'calm' } }]).ok).toBe(false);
    expect(open().preferences().profiles).toEqual({ a: 'balanced', b: 'supportive' });
  });
  it('restores theme, model and opt-in key across services, without returning or persisting plaintext keys', () => {
    const { open, file } = setup(), storage = open();
    const handlers = createHandlers('test', storage), credentials = new AICredentials(storage), ai = createAIHandlers(credentials, vi.fn());
    expect(handlers.update([{ ...DEFAULT_SETTINGS, theme: 'dark' }]).ok).toBe(true);
    expect(ai.preferences([preferences]).ok).toBe(true);
    expect(ai.set([{ provider: 'gemini', key, remember: true }]).ok).toBe(true);
    expect(JSON.stringify(ai.status([]))).not.toContain(key);
    expect(readFileSync(file, 'utf8')).not.toContain(key);
    expect(readFileSync(file, 'utf8')).not.toContain(Buffer.from(key).toString('base64'));
    const restarted = open(), vault = new AICredentials(restarted);
    expect(createHandlers('test', restarted).snapshot([])).toMatchObject({ ok: true, value: { settings: { theme: 'dark' } } });
    expect(vault.status()).toMatchObject({ preferences, providers: expect.arrayContaining([{ provider: 'gemini', configured: true, saved: true }]), remainingRequests: 36 });
    expect(vault.acquire('gemini')).toBe(key);
    expect(restarted.preferences().models.gemini).toBe('synthetic-gemini-model');
    restarted.preferences().models.gemini = 'mutation';
    expect(restarted.preferences().models.gemini).toBe('synthetic-gemini-model');
  });
  it('explicitly deletes saved and in-memory keys, and temporary replacement removes the previous persistent key', () => {
    const { open } = setup(), vault = new AICredentials(open()), handlers = createAIHandlers(vault, vi.fn());
    handlers.set([{ provider: 'openai', key, remember: true }]);
    vault.acquire('openai');
    expect(handlers.clear([{ provider: 'openai' }]).ok).toBe(true);
    expect(vault.status().remainingRequests).toBe(35);
    expect(new AICredentials(open()).status().providers[0]).toMatchObject({ configured: false, saved: false });
    handlers.set([{ provider: 'openai', key, remember: true }]);
    handlers.set([{ provider: 'openai', key: key + '-temporary', remember: false }]);
    expect(vault.acquire('openai')).toBe(key + '-temporary');
    expect(new AICredentials(open()).status().providers[0]?.configured).toBe(false);
  });
  it.each(['basic_text', 'unavailable'])('refuses insecure persistence with %s while allowing explicitly temporary registration', backend => {
    const { open, crypto, file } = setup();
    crypto.getSelectedStorageBackend = () => backend; crypto.isEncryptionAvailable = () => backend !== 'unavailable';
    const vault = new AICredentials(open()), handlers = createAIHandlers(vault, vi.fn());
    expect(vault.status().storage?.available).toBe(false);
    expect(handlers.set([{ provider: 'openai', key, remember: true }]).ok).toBe(false);
    expect(handlers.set([{ provider: 'openai', key, remember: false }]).ok).toBe(true);
    expect(vault.acquire('openai')).toBe(key);
    expect(readFileSync(file, 'utf8')).not.toContain(key);
    expect(new AICredentials(open()).status().providers[0]?.configured).toBe(false);
  });
  it('keeps previous values and ciphertext on disk failures, including deletion failure', () => {
    const { open, file } = setup(), storage = open(), vault = new AICredentials(storage), ai = createAIHandlers(vault, vi.fn());
    ai.set([{ provider: 'openai', key, remember: true }]);
    const previous = readFileSync(file, 'utf8');
    writeFileSync(file + '.tmp', 'conflicting temporary file');
    expect(ai.set([{ provider: 'openai', key: key + '-new', remember: true }]).ok).toBe(false);
    expect(ai.clear([{ provider: 'openai' }]).ok).toBe(false);
    expect(createHandlers('test', storage).update([{ ...DEFAULT_SETTINGS, theme: 'dark' }]).ok).toBe(false);
    expect(vault.acquire('openai')).toBe(key);
    expect(readFileSync(file, 'utf8')).toBe(previous);
    expect(readFileSync(file + '.tmp', 'utf8')).toBe('conflicting temporary file');
    expect(storage.settings().theme).toBe('system');
  });
  it('does not overwrite corrupted/future/oversized files or expose their contents', () => {
    const { open, file } = setup();
    for (const raw of ['{private broken data', JSON.stringify({ version: 500 }), 'x'.repeat(32_769)]) {
      writeFileSync(file, raw);
      const storage = open(), vault = new AICredentials(storage), ai = createAIHandlers(vault, vi.fn());
      expect(vault.status().storage?.warning).toContain('덮어쓰지 않습니다');
      expect(JSON.stringify(vault.status())).not.toContain(raw);
      expect(ai.preferences([preferences]).ok).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe(raw);
    }
  });
  it('treats decryption failure as unconfigured without discarding preferences or ciphertext', () => {
    const { open, crypto, file } = setup(), storage = open();
    storage.updatePreferences(preferences); storage.setKey('gemini', key, true);
    const previous = readFileSync(file, 'utf8');
    crypto.decryptString = () => { throw new Error(key); };
    const vault = new AICredentials(open());
    expect(vault.status()).toMatchObject({ preferences, storage: { warning: expect.stringContaining('복원하지 못했습니다') }, providers: expect.arrayContaining([{ provider: 'gemini', configured: false, saved: true }]) });
    expect(JSON.stringify(vault.status())).not.toContain(key);
    expect(readFileSync(file, 'utf8')).toBe(previous);
  });
  it('rejects malformed preference IPC and key storage flags before modifying state', () => {
    const { open } = setup(), vault = new AICredentials(open()), handlers = createAIHandlers(vault, vi.fn());
    for (const value of [null, { ...preferences, consent: true }, { ...preferences, models: { ...preferences.models, gemini: 'bad model' } }, { ...preferences, provider: 'other' }, { ...preferences, models: {} }]) expect(handlers.preferences([value]).ok).toBe(false);
    expect(handlers.preferences([preferences, {}]).ok).toBe(false);
    expect(handlers.set([{ provider: 'openai', key, remember: 'true' }]).ok).toBe(false);
    expect(vault.status().preferences).toEqual(DEFAULT_AI_PREFERENCES);
  });
});

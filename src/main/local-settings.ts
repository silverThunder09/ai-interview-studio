import { existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, isSettings, type Settings } from '../shared/contracts';
import { AI_PROVIDERS, DEFAULT_AI_PREFERENCES, exactRecord, isAIPreferences, isAIKeyRequest, type AIPreferences, type AIProvider } from '../shared/ai';

export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
interface SavedSettings { version: 1; settings: Settings; preferences: AIPreferences; keys: Partial<Record<AIProvider, string>> }
const fresh = (): SavedSettings => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, preferences: structuredClone(DEFAULT_AI_PREFERENCES), keys: {} });

// Only main can read this bounded, versioned file. Keys use OS encryption; never plaintext fallback.
export class LocalSettings {
  private state = fresh();
  private damaged = false;
  private warning = '';
  constructor(private readonly path: () => string, private readonly crypto: SecretStorage) {
    try {
      if (!existsSync(path())) return;
      if (statSync(path()).size > 32_768) throw new Error('Invalid settings');
      const value: unknown = JSON.parse(readFileSync(path(), 'utf8'));
      if (!exactRecord(value, ['version', 'settings', 'preferences', 'keys']) || value.version !== 1 || !isSettings(value.settings) || !isAIPreferences(value.preferences) ||
        typeof value.keys !== 'object' || value.keys === null || Array.isArray(value.keys) || Object.keys(value.keys).some(p => !AI_PROVIDERS.includes(p as AIProvider)) ||
        Object.values(value.keys).some(v => typeof v !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v) || v.length > 16_384)) throw new Error('Invalid settings');
      this.state = value as unknown as SavedSettings;
    } catch { this.damaged = true; this.warning = '저장된 설정을 읽지 못했습니다. 기존 파일은 보존했으며 덮어쓰지 않습니다.'; }
  }
  available(): boolean {
    try { return !this.damaged && this.crypto.isEncryptionAvailable() && this.crypto.getSelectedStorageBackend?.() !== 'basic_text'; }
    catch { return false; }
  }
  status() { return { available: this.available(), warning: this.warning }; }
  settings(): Settings { return { ...this.state.settings }; }
  preferences(): AIPreferences { return structuredClone(this.state.preferences); }
  saved(provider: AIProvider): boolean { return Object.hasOwn(this.state.keys, provider); }
  restore(): Partial<Record<AIProvider, string>> {
    const restored: Partial<Record<AIProvider, string>> = {};
    if (!this.available()) {
      if (Object.keys(this.state.keys).length) this.warning = 'OS 암호화를 사용할 수 없어 저장된 키를 복원하지 못했습니다. 키를 다시 등록해 주세요.';
      return restored;
    }
    for (const provider of AI_PROVIDERS) {
      const encrypted = this.state.keys[provider]; if (!encrypted) continue;
      try {
        const key = this.crypto.decryptString(Buffer.from(encrypted, 'base64'));
        if (!isAIKeyRequest({ provider, key })) throw new Error('Invalid key');
        restored[provider] = key;
      } catch { this.warning = '일부 저장된 키를 복원하지 못했습니다. 해당 서비스 키를 다시 등록하거나 삭제해 주세요.'; }
    }
    return restored;
  }
  updateSettings(settings: Settings): void { this.write({ ...this.state, settings: { ...settings } }); }
  updatePreferences(preferences: AIPreferences): void { this.write({ ...this.state, preferences: structuredClone(preferences) }); }
  setKey(provider: AIProvider, key: string, remember: boolean): void {
    const keys = { ...this.state.keys };
    if (remember) {
      if (!this.available()) throw new Error('Protected storage unavailable');
      keys[provider] = this.crypto.encryptString(key).toString('base64');
    } else delete keys[provider];
    this.write({ ...this.state, keys });
  }
  clearKey(provider: AIProvider): void { const keys = { ...this.state.keys }; delete keys[provider]; this.write({ ...this.state, keys }); }
  private write(next: SavedSettings): void {
    if (this.damaged) throw new Error('Invalid settings');
    const file = this.path(), temporary = `${file}.tmp`;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    let descriptor: number | undefined; let created = false;
    try {
      descriptor = openSync(temporary, 'wx', 0o600); created = true;
      writeFileSync(descriptor, JSON.stringify(next)); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, file); this.state = next;
    } catch {
      if (descriptor !== undefined) closeSync(descriptor);
      // Remove only a temp file created by this call, never an existing conflicting file.
      if (created) { try { unlinkSync(temporary); } catch { /* Preserve original file. */ } }
      throw new Error('Settings write failed');
    }
  }
}

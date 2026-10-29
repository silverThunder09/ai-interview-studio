import { describe, expect, it, vi } from 'vitest';
import { probeWriter } from '../../scripts/review/writer-readiness.mjs';

describe('existing App readiness probe', () => {
  it('checks trusted main around credential validation and revokes on success', async () => {
    const events: string[] = [];
    const credentials = { client: async () => { events.push('client'); }, dispose: async () => { events.push('dispose'); } };
    expect(await probeWriter({ credentials, checkMain: async () => { events.push('main'); } })).toEqual({ state: 'ready' });
    expect(events).toEqual(['main', 'client', 'main', 'dispose']);
  });
  it('revokes after failure and never prints untrusted error data', async () => {
    const dispose = vi.fn(async () => {}), credentials = { client: async () => { throw new Error('private input should not appear'); }, dispose };
    expect(await probeWriter({ credentials, checkMain: async () => {} })).toEqual({ state: 'hold', reason: 'writer_unavailable' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('reports unconfirmed cleanup and refuses readiness if main moved', async () => {
    const credentials = { client: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    expect(await probeWriter({ credentials, checkMain: async () => { throw new Error('trusted_main_moved'); } })).toEqual({ state: 'hold', reason: 'trusted_main_moved' });
    expect(credentials.client).not.toHaveBeenCalled(); expect(credentials.dispose).toHaveBeenCalledTimes(1);
    const broken = { client: async () => {}, dispose: async () => { throw new Error('unknown'); } };
    expect(await probeWriter({ credentials: broken, checkMain: async () => {} })).toEqual({ state: 'hold', reason: 'credential_cleanup_unconfirmed' });
  });
});

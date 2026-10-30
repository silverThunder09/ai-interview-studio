import { describe, expect, it, vi } from 'vitest';
import { runDaemon } from '../../scripts/review/direct-daemon.mjs';

describe('foreground supervisor loop', () => {
  it('continues observing a handed-off task and stops at a later hold', async () => {
    const supervise = vi.fn().mockResolvedValueOnce({ state: 'wakeup-sent' }).mockResolvedValueOnce({ state: 'wakeup-pending' }).mockResolvedValueOnce({ state: 'waiting-actions' }).mockResolvedValueOnce({ state: 'resumption-hold' });
    const wait = vi.fn(async () => {});
    await expect(runDaemon({ token: 'synthetic', environment: 'env_1', supervise, wait })).resolves.toEqual({ state: 'resumption-hold' });
    expect(supervise).toHaveBeenCalledTimes(4); expect(wait).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledWith(300000);
  });
  it('checks again after an idle queue without guessing a quota reset', async () => {
    const supervise = vi.fn().mockResolvedValueOnce({ state: 'idle' }).mockResolvedValueOnce({ state: 'needs-user' });
    const wait = vi.fn(async () => {});
    await expect(runDaemon({ token: 'synthetic', environment: 'env_1', supervise, wait })).resolves.toEqual({ state: 'needs-user' });
    expect(wait).toHaveBeenCalledTimes(1);
  });
  it.each(['ambiguous_delivery', 'receipt_persistence_unknown', 'wakeup-unknown', 'direct-hold_unknown_failure', 'writer-hold'])('never re-enters after %s', async state => {
    const supervise = vi.fn(async () => ({ state })), wait = vi.fn(async () => {});
    await expect(runDaemon({ token: 'synthetic', environment: 'env_1', supervise, wait })).resolves.toEqual({ state });
    expect(supervise).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
  it('stops if credential cleanup is unconfirmed', async () => {
    const supervise = vi.fn(async () => ({ state: 'idle', credential_cleanup: 'unconfirmed' })), wait = vi.fn(async () => {});
    await runDaemon({ token: 'synthetic', environment: 'env_1', supervise, wait });
    expect(wait).not.toHaveBeenCalled();
  });
});

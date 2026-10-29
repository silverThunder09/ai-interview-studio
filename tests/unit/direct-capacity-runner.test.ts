import { describe, expect, it, vi } from 'vitest';
import { runCapacityRunner } from '../../scripts/review/direct-capacity-runner.mjs';

const key = 'a'.repeat(64);

describe('capacity-limited request resumption', () => {
  it('rechecks the exact original request after a fixed interval and stops after a sent result', async () => {
    const tick = vi.fn().mockResolvedValueOnce({ state: 'limits-hold', reason: 'limited', request_key: key }).mockResolvedValueOnce({ state: 'sent', task_id: 'task_one' });
    const wait = vi.fn(async () => {}), report = vi.fn();
    await expect(runCapacityRunner({ token: 'synthetic', environment: 'env_1', tick, wait, report })).resolves.toEqual({ state: 'sent', task_id: 'task_one' });
    expect(tick).toHaveBeenCalledTimes(2); expect(tick.mock.calls[1]![0]).toMatchObject({ expectedRequestKey: key });
    expect(wait).toHaveBeenCalledWith(300000);
  });
  it.each([
    { state: 'limits-hold', reason: 'unknown' },
    { state: 'limits-hold', reason: 'unavailable' },
    { state: 'ambiguous_delivery' },
    { state: 'receipt_persistence_unknown' },
    { state: 'waiting-direct-cloud' },
    { state: 'history-hold' },
    { state: 'limits-hold', reason: 'limited' },
    { state: 'limits-hold', reason: 'limited', request_key: key, credential_cleanup: 'unconfirmed' },
  ])('does not poll again for an ambiguous or unsafe state %#', async result => {
    const tick = vi.fn(async () => result), wait = vi.fn(async () => {});
    await expect(runCapacityRunner({ token: 'synthetic', environment: 'env_1', tick, wait })).resolves.toEqual(result);
    expect(tick).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
  it('stops if the returned request identity changes while waiting', async () => {
    const tick = vi.fn().mockResolvedValueOnce({ state: 'limits-hold', reason: 'limited', request_key: key }).mockResolvedValueOnce({ state: 'limits-hold', reason: 'limited', request_key: 'b'.repeat(64) });
    const wait = vi.fn(async () => {});
    await expect(runCapacityRunner({ token: 'synthetic', environment: 'env_1', tick, wait })).resolves.toEqual({ state: 'resumption-hold' });
    expect(tick).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledTimes(1);
  });
  it('does not retry an exception whose delivery outcome might be unknown', async () => {
    const tick = vi.fn(async () => { throw new Error('unknown'); }), wait = vi.fn(async () => {});
    await expect(runCapacityRunner({ token: 'synthetic', environment: 'env_1', tick, wait })).rejects.toThrow('unknown');
    expect(tick).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
});

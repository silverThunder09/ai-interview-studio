import { describe, expect, it, vi } from 'vitest';
import { runResultRunner } from '../../scripts/review/direct-result-runner.mjs';

describe('resume a recorded Cloud result', () => {
  it('polls only the original task and stops after handing it to Actions', async () => {
    const tick = vi.fn().mockResolvedValueOnce({ state: 'direct-waiting' }).mockResolvedValueOnce({ state: 'wakeup-sent' });
    const wait = vi.fn(async () => {});
    await expect(runResultRunner({ token: 'synthetic', environment: 'env_1', taskId: 'task_one', tick, wait })).resolves.toEqual({ state: 'wakeup-sent' });
    expect(tick).toHaveBeenCalledTimes(2);
    expect(tick.mock.calls.every(call => call[0].expectedCloudTaskId === 'task_one')).toBe(true);
    expect(wait).toHaveBeenCalledWith(300000);
  });
  it.each(['direct-hold_unknown_failure', 'wakeup-unknown', 'wakeup-pending', 'resumption-hold'])('does not retry an unsafe state %s', async state => {
    const tick = vi.fn(async () => ({ state })), wait = vi.fn(async () => {});
    await expect(runResultRunner({ token: 'synthetic', environment: 'env_1', taskId: 'task_one', tick, wait })).resolves.toEqual({ state });
    expect(tick).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
  it('rejects an invalid task identity before invoking the runner', async () => {
    const tick = vi.fn();
    await expect(runResultRunner({ token: 'synthetic', environment: 'env_1', taskId: '../other', tick })).rejects.toThrow('invalid_cloud_task');
    expect(tick).not.toHaveBeenCalled();
  });
});

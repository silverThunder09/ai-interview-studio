import { describe, expect, it, vi } from 'vitest';
import { runSupervisor } from '../../scripts/review/direct-supervisor.mjs';

describe('Cloud supervisor restart', () => {
  it('resumes the saved task without starting another one', async () => {
    const discover = vi.fn(async () => ({ state: 'sent', task_id: 'task_saved' }));
    const capacity = vi.fn(), resultRunner = vi.fn(async () => ({ state: 'wakeup-sent' }));
    await expect(runSupervisor({ token: 'synthetic', environment: 'env_1', discover, capacity, resultRunner })).resolves.toEqual({ state: 'wakeup-sent' });
    expect(capacity).not.toHaveBeenCalled();
    expect(resultRunner).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task_saved' }));
  });
  it('hands a newly recorded receipt to the result observer', async () => {
    const discover = vi.fn(async () => ({ state: 'none' }));
    const capacity = vi.fn(async () => ({ state: 'sent', task_id: 'task_new' }));
    const resultRunner = vi.fn(async () => ({ state: 'wakeup-sent' }));
    await runSupervisor({ token: 'synthetic', environment: 'env_1', discover, capacity, resultRunner });
    expect(resultRunner).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task_new' }));
  });
  it('holds an ambiguous previous attempt without starting or observing another', async () => {
    const capacity = vi.fn(), resultRunner = vi.fn();
    await expect(runSupervisor({ token: 'synthetic', environment: 'env_1', discover: async () => ({ state: 'hold' }), capacity, resultRunner })).resolves.toEqual({ state: 'resumption-hold' });
    expect(capacity).not.toHaveBeenCalled(); expect(resultRunner).not.toHaveBeenCalled();
  });
});

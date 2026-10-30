import { describe, expect, it, vi } from 'vitest';
import { runSupervisor } from '../../scripts/review/direct-supervisor.mjs';
import { recordedCloudTask } from '../../scripts/review/direct-runner.mjs';

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
  it('waits while Actions is processing instead of starting new work', async () => {
    const capacity = vi.fn(), resultRunner = vi.fn();
    await expect(runSupervisor({ token: 'synthetic', environment: 'env_1', discover: async () => ({ state: 'processing' }), capacity, resultRunner })).resolves.toEqual({ state: 'waiting-actions' });
    expect(capacity).not.toHaveBeenCalled(); expect(resultRunner).not.toHaveBeenCalled();
  });
  it.each(['apply', 'ci', 'review', 'merge', 'main-ci'])('recognizes %s as in-progress even after the Cloud receipt was archived', phase => {
    expect(recordedCloudTask({ tasks: [{ phase: 'completed' }, { phase }] })).toEqual({ state: 'processing' });
  });
  it('holds an attempted but unconfirmed Cloud submission', () => {
    expect(recordedCloudTask({ tasks: [{ phase: 'development', direct_cloud: { phase: 'attempting', task_id: null } }] })).toEqual({ state: 'hold' });
  });
});

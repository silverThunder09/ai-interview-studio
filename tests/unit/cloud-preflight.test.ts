import { describe, expect, it } from 'vitest';
import { diagnose, readTaskPages } from '../../scripts/review/cloud-preflight.mjs';

describe('Cloud read-only preflight', () => {
  it('reads all pages but never treats the listing as permission to dispatch', async () => {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      return JSON.stringify(calls.length === 1 ? { tasks: [{ id: 'task_1', status: 'running' }], cursor: 'next' } : { tasks: [{ id: 'task_2', status: 'ready' }] });
    };
    const tasks = await readTaskPages(run);
    expect(calls[1]).toContain('next');
    expect(tasks).toEqual([{ id: 'task_1', status: 'running', known_status: true }, { id: 'task_2', status: 'ready', known_status: true }]);
    expect((await diagnose({ list: async () => tasks, limits: async () => ({}) })).dispatch_authorized).toBe(false);
  });
  it('rejects duplicate tasks, pagination loops and truncated listings', async () => {
    const page = JSON.stringify({ tasks: [{ id: 'task_1', status: 'ready' }], cursor: 'same' });
    await expect(readTaskPages(async () => page)).rejects.toThrow('invalid_cloud_task');
    await expect(readTaskPages(async () => JSON.stringify({ tasks: [], cursor: 'same' }))).rejects.toThrow('invalid_cloud_cursor');
    await expect(readTaskPages(async () => JSON.stringify({ tasks: [], cursor: 'more' }), 1)).rejects.toThrow('cloud_list_incomplete');
  });
  it('reports unavailable services and unknown task states without enabling dispatch', async () => {
    const tasks = await readTaskPages(async () => JSON.stringify({ tasks: [{ id: 'task_1', status: 'new_state' }] }));
    expect(tasks[0]?.known_status).toBe(false);
    const result = await diagnose({ list: async () => { throw new Error('denied'); }, limits: async () => { throw new Error('denied'); } });
    expect(result).toEqual({ cloud: { state: 'unavailable' }, limits: { state: 'unavailable' }, dispatch_authorized: false });
  });
});

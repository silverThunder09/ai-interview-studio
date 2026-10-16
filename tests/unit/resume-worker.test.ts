import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseResume } from '../../src/renderer/src/resume/parse';
import { RESUME_LIMITS } from '../../src/shared/resume';

class StalledWorker {
  static instances: StalledWorker[] = [];
  terminate = vi.fn();
  postMessage = vi.fn();
  onmessage: unknown;
  onerror: unknown;
  constructor() { StalledWorker.instances.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); StalledWorker.instances = []; });
describe('untrusted parser lifecycle', () => {
  it('terminates parsing after the approved deadline instead of leaving a worker alive', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', StalledWorker);
    const parse = parseResume({ name: 'synthetic.pdf', format: 'pdf', bytes: new Uint8Array() }, new AbortController().signal);
    const outcome = expect(parse).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(RESUME_LIMITS.timeoutMs);
    await outcome;
    expect(StalledWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
  });
  it('terminates active parsing on cancellation and does not start for an aborted request', async () => {
    vi.stubGlobal('Worker', StalledWorker);
    const controller = new AbortController();
    const file = { name: 'synthetic.pdf', format: 'pdf' as const, bytes: new Uint8Array() };
    const parse = parseResume(file, controller.signal);
    controller.abort();
    await expect(parse).rejects.toMatchObject({ name: 'AbortError' });
    expect(StalledWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
    await expect(parseResume(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(StalledWorker.instances).toHaveLength(1);
  });
});

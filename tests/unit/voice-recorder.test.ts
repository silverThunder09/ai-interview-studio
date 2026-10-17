import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from '../../src/renderer/src/voice-recorder';
import { VOICE_LIMITS } from '../../src/shared/voice';

function fixture(acquire?: () => Promise<MediaStream>) {
  const track = { stop: vi.fn(), onended: null as (() => void) | null };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const recorder = { state: 'inactive', ondataavailable: null as ((event: { data: Blob }) => void) | null, onstop: null as (() => void) | null, onerror: null as (() => void) | null,
    start: vi.fn(() => { recorder.state = 'recording'; }), stop: vi.fn(() => { recorder.state = 'inactive'; queueMicrotask(() => { recorder.ondataavailable?.({ data: new Blob(['synthetic audio']) }); recorder.onstop?.(); }); }) };
  const ready = vi.fn(), failed = vi.fn();
  const capture = new VoiceRecorder(ready, failed, acquire ?? (async () => stream), () => recorder as unknown as MediaRecorder);
  return { capture, ready, failed, track, stream, recorder };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('recording resources and user cancellation', () => {
  it('stops tracks immediately, collects final data and releases recorder handlers and timer', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.capture.start(); f.capture.stop();
    expect(f.track.stop).toHaveBeenCalledOnce(); await vi.runAllTimersAsync();
    expect(f.ready).toHaveBeenCalledOnce(); expect(await (f.ready.mock.calls[0]![0] as Blob).text()).toBe('synthetic audio');
    expect(f.recorder.ondataavailable).toBeNull(); expect(f.recorder.onstop).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('releases a stream that arrives after cancellation of a pending permission request', async () => {
    let resolve!: (stream: MediaStream) => void; const f = fixture(() => new Promise(done => { resolve = done; }));
    const pending = f.capture.start(); f.capture.dispose(); resolve(f.stream);
    expect(await pending).toBe(false); expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.recorder.start).not.toHaveBeenCalled(); expect(f.ready).not.toHaveBeenCalled();
  });
  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError'])('keeps %s distinct from a successful empty recording', async name => {
    const f = fixture(async () => { const error = new Error('synthetic secret'); error.name = name; throw error; });
    expect(await f.capture.start()).toBe(false); expect(f.ready).not.toHaveBeenCalled(); expect(f.failed).toHaveBeenCalledOnce(); expect(f.failed.mock.calls[0]![0]).not.toContain('synthetic secret');
  });
  it('bounds recording duration and does not upload or restart the device automatically', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.capture.start(); await vi.advanceTimersByTimeAsync(VOICE_LIMITS.recordingMs);
    expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.ready).toHaveBeenCalledOnce(); expect(f.recorder.start).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('discards over-limit or interrupted recordings and never returns partial success', async () => {
    const f = fixture(); await f.capture.start(); f.recorder.ondataavailable!({ data: new Blob([new Uint8Array(VOICE_LIMITS.bytes + 1)]) });
    await Promise.resolve(); expect(f.failed).toHaveBeenCalledOnce(); expect(f.ready).not.toHaveBeenCalled(); expect(f.track.stop).toHaveBeenCalledOnce();
    const g = fixture(); await g.capture.start(); g.track.onended!(); await Promise.resolve(); expect(g.ready).not.toHaveBeenCalled(); expect(g.failed).toHaveBeenCalledOnce();
  });
});

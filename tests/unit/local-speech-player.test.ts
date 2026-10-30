import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalSpeechPlayer } from '../../src/renderer/src/local-speech-player';

afterEach(() => { vi.unstubAllGlobals(); });
describe('local speech playback', () => {
  it('does not start audio after cancellation while the audio context is resuming', async () => {
    let resume!: () => void;
    const play = vi.fn(async () => {}), close = vi.fn(async () => {}), amplitude = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('AudioContext', class {
      destination = {};
      createMediaElementSource() { return { connect: vi.fn() }; }
      createAnalyser() { return { fftSize: 256, smoothingTimeConstant: 0, connect: vi.fn(), getFloatTimeDomainData: (a: Float32Array) => a.fill(0) }; }
      resume() { return new Promise<void>(resolve => { resume = resolve; }); }
      close = close;
    });
    const audio = { src: '', play, pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), onended: null, onerror: null };
    const revoke = vi.fn();
    const player = new LocalSpeechPlayer(vi.fn(), vi.fn(), () => audio as unknown as HTMLAudioElement, () => 'blob:local', revoke, amplitude);
    player.load(new Uint8Array(44)); const pending = player.play();
    player.stop(); resume(); await pending;
    expect(play).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce();
    expect(amplitude).toHaveBeenLastCalledWith(0);
  });
});

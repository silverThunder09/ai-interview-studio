import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechPlayer } from '../../src/renderer/src/speech-player';
import { SPEECH_LIMITS } from '../../src/shared/speech';
import { mp3Fixture } from '../fixtures/speech';
function fixture(play = vi.fn(async () => {})) {
  const elements: { src: string; play: typeof play; pause: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn>; onended: (() => void) | null; onerror: (() => void) | null }[] = [];
  const playing = vi.fn(), failed = vi.fn(), makeURL = vi.fn(() => 'blob:synthetic-audio'), revoke = vi.fn();
  const create = () => { const audio = { src: '', play, pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), onended: null, onerror: null }; elements.push(audio); return audio as unknown as HTMLAudioElement; };
  return { player: new SpeechPlayer(playing, failed, create, makeURL, revoke), playing, failed, makeURL, revoke, elements, play };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('memory-only playback resource lifetime', () => {
  it('does not autoplay and releases URLs/elements on stop while allowing replay from cached bytes', async () => {
    const f = fixture(); f.player.load(mp3Fixture()); expect(f.play).not.toHaveBeenCalled();
    await f.player.play(); expect(f.playing).toHaveBeenLastCalledWith(true); f.player.stop();
    expect(f.revoke).toHaveBeenCalledOnce(); expect(f.elements[0]!.pause).toHaveBeenCalledOnce(); expect(f.elements[0]!.removeAttribute).toHaveBeenCalledWith('src'); expect(f.elements[0]!.onended).toBeNull();
    await f.player.play(); expect(f.elements).toHaveLength(2); expect(f.makeURL).toHaveBeenCalledTimes(2); f.player.dispose();
    await f.player.play(); expect(f.elements).toHaveLength(2);
  });
  it('releases resources at the duration cap and on natural completion', async () => {
    vi.useFakeTimers(); const f = fixture(); f.player.load(mp3Fixture()); await f.player.play();
    await vi.advanceTimersByTimeAsync(SPEECH_LIMITS.playbackMs); expect(f.playing).toHaveBeenLastCalledWith(false); expect(vi.getTimerCount()).toBe(0);
    await f.player.play(); f.elements.at(-1)!.onended!(); expect(f.revoke).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('sanitizes decoder errors and ignores a rejected play promise after disposal', async () => {
    const f = fixture(vi.fn(async () => { throw new Error('synthetic secret decoder data'); })); f.player.load(mp3Fixture()); await f.player.play();
    expect(f.failed).toHaveBeenCalledOnce(); expect(f.failed.mock.calls[0]![0]).not.toContain('synthetic secret'); expect(f.revoke).toHaveBeenCalledOnce();
    let reject!: (e: Error) => void; const g = fixture(vi.fn(() => new Promise<void>((_yes, no) => { reject = no; })));
    g.player.load(mp3Fixture()); const pending = g.player.play(); g.player.dispose(); reject(new Error('late')); await pending;
    expect(g.failed).not.toHaveBeenCalled(); expect(g.playing).toHaveBeenLastCalledWith(false);
  });
});

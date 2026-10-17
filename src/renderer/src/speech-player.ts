import { SPEECH_LIMITS } from '../../shared/speech';

export class SpeechPlayer {
  private bytes: Uint8Array | undefined;
  private audio: HTMLAudioElement | undefined;
  private url: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  constructor(private readonly playing: (active: boolean) => void, private readonly failed: (message: string) => void,
    private readonly create = () => new Audio(), private readonly makeURL = (blob: Blob) => URL.createObjectURL(blob), private readonly revoke = (url: string) => URL.revokeObjectURL(url)) {}
  load(bytes: Uint8Array): void {
    this.dispose();
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > SPEECH_LIMITS.bytes) throw new Error('Invalid audio');
    this.bytes = new Uint8Array(bytes);
  }
  async play(): Promise<void> {
    this.stop(); if (!this.bytes) return;
    const generation = this.generation;
    try {
      this.url = this.makeURL(new Blob([new Uint8Array(this.bytes)], { type: 'audio/mpeg' }));
      const audio = this.create(); this.audio = audio; audio.src = this.url;
      const failed = () => { if (generation !== this.generation) return; this.stop(); this.failed('질문 음성을 재생하지 못했습니다. 텍스트 질문으로 계속할 수 있습니다.'); };
      audio.onended = () => { if (generation === this.generation) this.stop(); }; audio.onerror = failed;
      this.playing(true); this.timer = setTimeout(() => this.stop(), SPEECH_LIMITS.playbackMs);
      await audio.play();
    } catch { if (generation === this.generation) { this.stop(); this.failed('질문 음성을 재생하지 못했습니다. 텍스트 질문으로 계속할 수 있습니다.'); } }
  }
  stop(): void {
    this.generation++; clearTimeout(this.timer); this.timer = undefined;
    if (this.audio) {
      this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = undefined;
    }
    if (this.url) { this.revoke(this.url); this.url = undefined; }
    this.playing(false);
  }
  dispose(): void { this.stop(); this.bytes = undefined; }
}

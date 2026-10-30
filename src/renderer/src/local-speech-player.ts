import { SPEECH_LIMITS } from '../../shared/local-speech';
import { audioMouthLevel } from './avatar/audio-level';
export class LocalSpeechPlayer {
  private bytes: Uint8Array | undefined; private audio: HTMLAudioElement | undefined; private url: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined; private generation = 0; private context: AudioContext | undefined; private frame = 0;
  constructor(private readonly playing: (active: boolean) => void, private readonly failed: (message: string) => void,
    private readonly create = () => new Audio(), private readonly makeURL = (blob: Blob) => URL.createObjectURL(blob),
    private readonly revoke = (url: string) => URL.revokeObjectURL(url), private readonly amplitude: (level: number) => void = () => {}) {}
  load(bytes: Uint8Array): void { this.dispose(); if (!(bytes instanceof Uint8Array) || bytes.byteLength < 44 || bytes.byteLength > SPEECH_LIMITS.bytes) throw new Error('Invalid audio'); this.bytes = new Uint8Array(bytes); }
  async play(): Promise<void> {
    this.stop(); if (!this.bytes) return; const generation = this.generation;
    try {
      this.url = this.makeURL(new Blob([new Uint8Array(this.bytes)], { type: 'audio/wav' })); const audio = this.create(); this.audio = audio; audio.src = this.url;
      const Context = globalThis.AudioContext; if (!Context) throw new Error('Web Audio unavailable');
      const context = new Context(), source = context.createMediaElementSource(audio), analyser = context.createAnalyser(); this.context = context; analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.35; source.connect(analyser); analyser.connect(context.destination);
      const samples = new Float32Array(analyser.fftSize); const measure = () => { if (generation !== this.generation) return; analyser.getFloatTimeDomainData(samples); this.amplitude(audioMouthLevel(samples)); this.frame = requestAnimationFrame(measure); }; measure();
      const failed = () => { if (generation !== this.generation) return; this.stop(); this.failed('질문 음성을 재생하지 못했습니다. 텍스트 질문으로 계속할 수 있습니다.'); };
      audio.onended = () => { if (generation === this.generation) this.stop(); }; audio.onerror = failed; this.playing(true); this.timer = setTimeout(() => this.stop(), SPEECH_LIMITS.playbackMs); await context.resume(); if (generation !== this.generation) return; await audio.play();
    } catch { if (generation === this.generation) { this.stop(); this.failed('질문 음성을 재생하지 못했습니다. 텍스트 질문으로 계속할 수 있습니다.'); } }
  }
  stop(): void { this.generation++; clearTimeout(this.timer); this.timer = undefined; if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame); this.frame = 0; this.amplitude(0); if (this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = undefined; } if (this.context) { void this.context.close().catch(() => {}); this.context = undefined; } if (this.url) { this.revoke(this.url); this.url = undefined; } this.playing(false); }
  dispose(): void { this.stop(); this.bytes = undefined; }
}

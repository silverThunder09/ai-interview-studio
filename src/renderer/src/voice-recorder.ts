import { VOICE_LIMITS, VOICE_MIME } from '../../shared/voice';

export class VoiceRecorder {
  private generation = 0;
  private stream: MediaStream | undefined;
  private recorder: MediaRecorder | undefined;
  private chunks: Blob[] = [];
  private size = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly ready: (audio: Blob) => void, private readonly failed: (message: string) => void,
    private readonly acquire = () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
    private readonly create = (stream: MediaStream) => new MediaRecorder(stream, { mimeType: VOICE_MIME })) {}
  async start(): Promise<boolean> {
    this.dispose(); const generation = this.generation;
    try {
      const stream = await this.acquire();
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream;
      const recorder = this.create(stream); this.recorder = recorder;
      for (const track of stream.getTracks()) track.onended = () => this.fail('마이크 연결이 끊겼습니다. 텍스트 입력을 사용하거나 다시 녹음하세요.');
      recorder.ondataavailable = event => {
        if (generation !== this.generation) return;
        this.size += event.data.size;
        if (this.size > VOICE_LIMITS.bytes) { this.fail('녹음이 8MB를 초과했습니다. 더 짧게 다시 녹음하세요.'); return; }
        if (event.data.size) this.chunks.push(event.data);
      };
      recorder.onerror = () => this.fail('녹음을 완료하지 못했습니다. 텍스트 입력을 사용하거나 다시 녹음하세요.');
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        const audio = new Blob(this.chunks, { type: VOICE_MIME });
        this.dispose();
        if (audio.size) this.ready(audio); else this.failed('녹음된 음성이 없습니다. 다시 녹음하세요.');
      };
      recorder.start(250);
      this.timer = setTimeout(() => this.stop(), VOICE_LIMITS.recordingMs);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      const name = error instanceof Error ? error.name : '';
      this.fail(name === 'NotAllowedError' ? '마이크 권한을 허용하지 않았습니다. Windows 권한을 확인하거나 텍스트로 입력하세요.' : name === 'NotFoundError' ? '마이크를 찾지 못했습니다. 장치를 연결하거나 텍스트로 입력하세요.' : name === 'NotReadableError' ? '마이크를 사용할 수 없습니다. 다른 앱의 장치 사용을 확인하거나 텍스트로 입력하세요.' : '음성 녹음을 시작하지 못했습니다. 텍스트로 입력할 수 있습니다.');
      return false;
    }
  }
  private releaseTracks(): void {
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
  }
  stop(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.releaseTracks();
  }
  private fail(message: string): void { this.dispose(); this.failed(message); }
  dispose(): void {
    this.generation++; clearTimeout(this.timer); this.timer = undefined;
    if (this.recorder) {
      this.recorder.ondataavailable = null; this.recorder.onstop = null; this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    }
    this.recorder = undefined; this.releaseTracks(); this.chunks = []; this.size = 0;
  }
}

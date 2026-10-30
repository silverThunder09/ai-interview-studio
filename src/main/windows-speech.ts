import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { win32 } from 'node:path';
import type { LocalSpeechVoice } from '../shared/local-speech';

const common = "[Console]::InputEncoding=[Text.UTF8Encoding]::new();Add-Type -AssemblyName System.Speech;$ErrorActionPreference='Stop';";
const listScript = `${common}$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=@($s.GetInstalledVoices()|%{$i=$_.VoiceInfo;if($_.Enabled -and $i.Culture.Name -like 'ko-*'){@{id=$i.Name;name=$i.Name;culture=$i.Culture.Name}}});[Console]::OutputEncoding=[Text.Encoding]::UTF8;ConvertTo-Json -Compress -InputObject $v`;
const speakScript = `${common}$j=[Console]::In.ReadToEnd()|ConvertFrom-Json;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=@($s.GetInstalledVoices()|?{$_.Enabled -and $_.VoiceInfo.Culture.Name -like 'ko-*' -and $_.VoiceInfo.Name -ceq $j.voice});if($v.Count -ne 1){throw 'voice unavailable'};$s.SelectVoice($j.voice);$m=New-Object IO.MemoryStream;$s.SetOutputToWaveStream($m);$s.Speak([string]$j.text);$s.SetOutputToNull();$b=$m.ToArray();[Console]::OpenStandardOutput().Write($b,0,$b.Length)`;
const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');
export interface SpeechProcess { promise: Promise<Uint8Array>; cancel(): void }
export class WindowsSpeechAdapter {
  constructor(private readonly platform = process.platform, private readonly launch: typeof spawn = spawn) {}
  async voices(): Promise<LocalSpeechVoice[]> {
    if (this.platform !== 'win32') return [];
    const job = this.run(listScript);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { job.cancel(); reject(new Error('voice enumeration timeout')); }, 30_000); });
    let bytes: Uint8Array;
    try { bytes = await Promise.race([job.promise, deadline]); } finally { clearTimeout(timer); }
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return items.filter((v): v is LocalSpeechVoice => !!v && typeof v === 'object' && typeof (v as LocalSpeechVoice).id === 'string' && (v as LocalSpeechVoice).id === (v as LocalSpeechVoice).name && /^ko-[A-Za-z]{2}$/.test((v as LocalSpeechVoice).culture));
  }
  speak(text: string, voice: string): SpeechProcess {
    const job = this.run(speakScript, JSON.stringify({ text, voice }));
    return { promise: job.promise.then(bytes => { if (bytes.length < 44 || Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'RIFF' || Buffer.from(bytes.subarray(8, 12)).toString('ascii') !== 'WAVE') throw new Error('invalid wave'); return bytes; }), cancel: job.cancel };
  }
  private run(script: string, input?: string): SpeechProcess {
    if (this.platform !== 'win32') return { promise: Promise.reject(new Error('unsupported')), cancel() {} };
    let child: ChildProcessWithoutNullStreams | undefined;
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !win32.isAbsolute(systemRoot)) { reject(new Error('Windows system directory unavailable')); return; }
      const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      child = this.launch(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)], { windowsHide: true, shell: false });
      const chunks: Buffer[] = []; let size = 0;
      child.stdout.on('data', (part: Buffer) => { size += part.length; if (size > 8 * 1024 * 1024) { child?.kill(); reject(new Error('too large')); } else chunks.push(part); });
      child.stderr.resume(); child.on('error', reject); child.on('close', code => code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error('speech failed')));
      child.stdin.on('error', () => {}); child.stdin.end(input, 'utf8');
    });
    return { promise, cancel: () => child?.kill() };
  }
}

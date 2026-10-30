import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { spawn } from 'node:child_process';
import { WindowsSpeechAdapter } from '../../src/main/windows-speech';

afterEach(() => { vi.unstubAllEnvs(); });
describe('Windows local synthesis process', () => {
  it('passes question data through stdin, not the PowerShell command', async () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    let input = ''; child.stdin.setEncoding('utf8'); child.stdin.on('data', chunk => { input += String(chunk); });
    const launch = vi.fn(() => child);
    const adapter = new WindowsSpeechAdapter('win32', launch as unknown as typeof spawn);
    const text = '합성 질문; $(secret)'; const job = adapter.speak(text, 'Korean voice');
    const [executable, args, options] = launch.mock.calls[0] as unknown as [string, string[], { shell: boolean }];
    expect(executable).toContain('WindowsPowerShell'); expect(options.shell).toBe(false);
    expect(args.join(' ')).not.toContain(text);
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8); child.stdout.write(wav); child.emit('close', 0);
    expect(await job.promise).toEqual(new Uint8Array(wav)); expect(JSON.parse(input)).toEqual({ text, voice: 'Korean voice' });
  });
});

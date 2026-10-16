import { RESUME_LIMITS, ResumeError, type ExtractedResume, type ParseResumeResult, type SelectedResume } from '../../../shared/resume';

export function parseResume(file: SelectedResume, signal: AbortSignal): Promise<ExtractedResume> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('./resume.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new ResumeError('TIMEOUT')); }, RESUME_LIMITS.timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ParseResumeResult>) => {
      cleanup();
      if (event.data.ok) resolve(event.data.value);
      else reject(new ResumeError(event.data.code));
    };
    worker.onerror = (event) => { event.preventDefault(); cleanup(); reject(new ResumeError('DAMAGED')); };
    worker.postMessage(file, [file.bytes.buffer]);
  });
}

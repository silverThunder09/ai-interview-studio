import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Result } from '../shared/contracts';
import { RESUME_LIMITS, ResumeError, validateResumeBytes, type SelectedResume } from '../shared/resume';

// Only called with a path returned by the native dialog; no renderer-supplied path.
export async function readSelectedResume(path: string): Promise<SelectedResume> {
  const extension = extname(path).toLowerCase();
  if (extension !== '.pdf' && extension !== '.docx') throw new ResumeError('FORMAT');
  const format = extension === '.pdf' ? 'pdf' : 'docx';
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new ResumeError('FORMAT');
    if (stat.size > RESUME_LIMITS.fileBytes) throw new ResumeError('SIZE');
    // A growing file must not cause an unbounded readFile allocation.
    const buffer = new Uint8Array(RESUME_LIMITS.fileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const bytes = buffer.slice(0, length);
    validateResumeBytes(format, bytes);
    return { name: basename(path), format, bytes };
  } finally { await file.close(); }
}

export function createResumeSelector(select: () => Promise<string | undefined>) {
  let busy = false;
  return async (args: unknown[]): Promise<Result<SelectedResume | null>> => {
    if (args.length) return { ok: false, error: { code: 'INVALID_REQUEST', message: '파일 경로를 직접 지정할 수 없습니다.' } };
    if (busy) return { ok: false, error: { code: 'UNAVAILABLE', message: '파일 선택이 이미 진행 중입니다.' } };
    busy = true;
    try {
      const path = await select();
      return { ok: true, value: path ? await readSelectedResume(path) : null };
    } catch (error) {
      return { ok: false, error: { code: 'UNAVAILABLE', message: error instanceof ResumeError ? error.message : '파일을 읽지 못했습니다. 접근 권한을 확인하고 다시 선택해 주세요.' } };
    } finally { busy = false; }
  };
}

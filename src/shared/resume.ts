export const RESUME_LIMITS = Object.freeze({
  fileBytes: 10 * 1024 * 1024, pdfPages: 50, textChars: 100_000,
  expandedBytes: 30 * 1024 * 1024, timeoutMs: 15_000, zipEntries: 512,
});
export type ResumeFormat = 'pdf' | 'docx';
export interface SelectedResume { name: string; format: ResumeFormat; bytes: Uint8Array }
export interface ResumeSection { location: string; text: string }
export interface ExtractedResume { sections: ResumeSection[]; warnings: string[] }
export const RESUME_ERRORS = {
  FORMAT: 'PDF 또는 DOCX 문서를 선택해 주세요. 확장자와 실제 형식이 일치해야 합니다.',
  SIZE: '파일은 10MB 이하만 불러올 수 있습니다.',
  ENCRYPTED: '암호화된 문서는 지원하지 않습니다. 암호를 해제한 사본을 선택해 주세요.',
  DAMAGED: '문서를 읽을 수 없습니다. 손상 여부를 확인하거나 PDF/DOCX로 다시 저장해 주세요.',
  LIMIT: '문서 처리 한도를 초과했습니다. PDF 50페이지, 텍스트 10만 자, DOCX 압축 해제 30MB까지 지원합니다.',
  EMPTY: '추출할 텍스트가 없습니다. 스캔 PDF는 OCR로 텍스트를 추가한 뒤 다시 선택해 주세요.',
  TIMEOUT: '문서 처리 시간이 15초를 초과했습니다. 더 작은 문서로 다시 시도해 주세요.',
} as const;
export type ResumeErrorCode = keyof typeof RESUME_ERRORS;
export class ResumeError extends Error {
  constructor(public readonly code: ResumeErrorCode) { super(RESUME_ERRORS[code]); }
}
export type ParseResumeResult = { ok: true; value: ExtractedResume } | { ok: false; code: ResumeErrorCode };

export function validateResumeBytes(format: ResumeFormat, bytes: Uint8Array): void {
  if (bytes.byteLength > RESUME_LIMITS.fileBytes) throw new ResumeError('SIZE');
  const signature = Array.from(bytes.subarray(0, 8));
  if (signature.join(',') === '208,207,17,224,161,177,26,225') throw new ResumeError('ENCRYPTED');
  const valid = format === 'pdf'
    ? new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'
    : signature.slice(0, 4).join(',') === '80,75,3,4';
  if (!valid) throw new ResumeError('FORMAT');
}

export function appendSection(sections: ResumeSection[], location: string, text: string): void {
  // Remove non-display control characters, retaining tabs and line breaks.
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  const joinedLength = sections.reduce((sum, section) => sum + section.text.length, 0) + clean.length + sections.length * 2;
  if (joinedLength > RESUME_LIMITS.textChars || sections.length >= 2_000) throw new ResumeError('LIMIT');
  if (clean) sections.push({ location, text: clean });
}

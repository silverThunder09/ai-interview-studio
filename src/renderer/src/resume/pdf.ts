import { getDocument, PDFWorker } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { appendSection, RESUME_LIMITS, ResumeError, type ExtractedResume } from '../../../shared/resume';

// Inline local CMaps so parsing CJK PDFs never fetches a URL from a document.
const maps = import.meta.glob<string>('../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', { eager: true, query: '?inline', import: 'default' });
class LocalBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const data = kind === 'cMapUrl' ? maps[`../../../../node_modules/pdfjs-dist/cmaps/${filename}`] : undefined;
    if (!data || !/^[\w-]+\.bcmap$/.test(filename)) throw new Error('Unsupported local font data');
    return Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (char) => char.charCodeAt(0));
  }
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedResume> {
  const port = new Worker(workerURL, { type: 'module' });
  const worker = PDFWorker.create({ port, verbosity: 0 });
  const task = getDocument({
    data: bytes, worker, verbosity: 0, stopAtErrors: true,
    disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
    BinaryDataFactory: LocalBinaryDataFactory, cMapPacked: true,
    useWasm: false, maxImageSize: 0, isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false, enableXfa: false,
  });
  try {
    const document = await task.promise;
    if (document.numPages > RESUME_LIMITS.pdfPages) throw new ResumeError('LIMIT');
    const sections: ExtractedResume['sections'] = [];
    let emptyPages = 0, total = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const reader = page.streamTextContent().getReader();
      let text = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!('str' in item)) continue;
            const part = item.str + (item.hasEOL ? '\n' : ' ');
            total += part.length;
            if (total > RESUME_LIMITS.textChars) throw new ResumeError('LIMIT');
            text += part;
          }
        }
      } finally { reader.releaseLock(); page.cleanup(); }
      if (!text.trim()) emptyPages++;
      appendSection(sections, `${pageNumber}페이지`, text);
    }
    if (!sections.length) throw new ResumeError('EMPTY');
    return { sections, warnings: [
      'PDF의 읽기 순서·표·줄바꿈이 원문과 다를 수 있습니다. 원본과 비교해 확인해 주세요.',
      ...(emptyPages ? [`텍스트가 없는 ${emptyPages}개 페이지가 있습니다. 이미지나 스캔 영역에는 OCR이 필요할 수 있습니다.`] : []),
    ] };
  } catch (error) {
    if (error instanceof ResumeError) throw error;
    if (error instanceof Error && error.name === 'PasswordException') throw new ResumeError('ENCRYPTED');
    throw new ResumeError('DAMAGED');
  } finally {
    // The caller also terminates the outer worker on cancel/deadline.
    await task.destroy().catch(() => undefined);
    worker.destroy(); port.terminate();
  }
}

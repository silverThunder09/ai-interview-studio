import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { ResumeError, validateResumeBytes, type ParseResumeResult, type SelectedResume } from '../../../shared/resume';

// No preload bridge, Node, file paths, document scripting or external requests.
self.onmessage = async (event: MessageEvent<SelectedResume>) => {
  let result: ParseResumeResult;
  try {
    const { format, bytes } = event.data;
    validateResumeBytes(format, bytes);
    const value = format === 'pdf' ? await extractPdf(bytes) : extractDocx(bytes);
    result = { ok: true, value };
  } catch (error) {
    result = { ok: false, code: error instanceof ResumeError ? error.code : 'DAMAGED' };
  }
  self.postMessage(result);
};

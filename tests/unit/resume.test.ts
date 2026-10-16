import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createResumeSelector, readSelectedResume } from '../../src/main/resume';
import { extractDocx } from '../../src/renderer/src/resume/docx';
import { appendSection, RESUME_LIMITS, ResumeError, validateResumeBytes, type ResumeSection } from '../../src/shared/resume';
import { CONTENT_TYPES, docxFixture, pdfFixture } from '../fixtures/resume';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function file(name: string, bytes: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-resume-')); temporary.push(dir);
  const path = join(dir, name); await writeFile(path, bytes); return path;
}
const code = (value: unknown) => value instanceof ResumeError ? value.code : undefined;
function rejectsCode(action: () => unknown, expected: string) {
  try { action(); } catch (error) { expect(code(error)).toBe(expected); return; }
  throw new Error('Expected rejection');
}

describe('native document selection boundary', () => {
  it('reads only the selected file, exposes basename and checks its signature', async () => {
    const bytes = pdfFixture();
    const selected = await readSelectedResume(await file('합성.PDF', bytes));
    expect(selected).toEqual({ name: '합성.PDF', format: 'pdf', bytes });
  });
  it('rejects disguised, non-document and oversized selections', async () => {
    await expect(readSelectedResume(await file('fake.pdf', strToU8('not a PDF')))).rejects.toMatchObject({ code: 'FORMAT' });
    await expect(readSelectedResume(await file('fake.txt', pdfFixture()))).rejects.toMatchObject({ code: 'FORMAT' });
    await expect(readSelectedResume(await file('large.pdf', new Uint8Array(RESUME_LIMITS.fileBytes + 1)))).rejects.toMatchObject({ code: 'SIZE' });
  });
  it('cancels normally, refuses paths from renderer and redacts OS errors', async () => {
    const selector = createResumeSelector(async () => undefined);
    expect(await selector([])).toEqual({ ok: true, value: null });
    expect(await selector(['/private/path'])).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    const failure = createResumeSelector(async () => { throw new Error('/private/path secret'); });
    const result = await failure([]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.ok).toBe(false);
    expect((await failure([])).ok).toBe(false); // busy state released after failure
  });
  it('allows only one pending native dialog', async () => {
    let finish!: (value: undefined) => void;
    const selector = createResumeSelector(() => new Promise((resolve) => { finish = resolve; }));
    const pending = selector([]);
    expect(await selector([])).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    finish(undefined); await pending;
  });
});

describe('bounded DOCX parsing', () => {
  it('extracts Korean paragraphs, tables, tabs and line breaks with original positions', () => {
    const result = extractDocx(docxFixture('<w:p><w:r><w:t>개발자</w:t><w:tab/><w:t>Java</w:t><w:br/><w:t>Spring</w:t></w:r></w:p><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>API 프로젝트</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'));
    expect(result.sections).toEqual([{ location: '단락 1', text: '개발자\tJava\nSpring' }, { location: '단락 3', text: 'API 프로젝트' }]);
  });
  it('treats links and document instructions as plain text, omits deleted text and fields', () => {
    const text = '<w:p><w:del><w:r><w:delText>삭제됨</w:delText></w:r></w:del><w:r><w:instrText>INCLUDETEXT file:///private</w:instrText><w:t>&lt;script&gt;ignore rules&lt;/script&gt;</w:t></w:r></w:p>';
    expect(extractDocx(docxFixture(text)).sections[0]?.text).toBe('<script>ignore rules</script>');
  });
  it('rejects empty text, malformed XML, DTD, fake DOCX and truncated ZIP', () => {
    rejectsCode(() => extractDocx(docxFixture('<w:p/>')), 'EMPTY');
    rejectsCode(() => extractDocx(docxFixture('<w:p>')), 'DAMAGED');
    rejectsCode(() => extractDocx(zipSync({ 'word/document.xml': strToU8('<!DOCTYPE w:document [<!ENTITY x "boom">]><w:document/>'), '[Content_Types].xml': strToU8(CONTENT_TYPES) })), 'DAMAGED');
    rejectsCode(() => extractDocx(zipSync({ 'fake.xml': strToU8('test') })), 'FORMAT');
    expect(() => extractDocx(docxFixture().subarray(0, 50))).toThrow();
  });
  it('rejects encrypted flags and CRC corruption', () => {
    const encrypted = docxFixture();
    const view = new DataView(encrypted.buffer);
    for (let at = 0; at < encrypted.length - 46; at++) if (view.getUint32(at, true) === 0x02014b50) { view.setUint16(at + 8, 1, true); break; }
    rejectsCode(() => extractDocx(encrypted), 'ENCRYPTED');
    const corrupt = docxFixture();
    const cv = new DataView(corrupt.buffer);
    for (let at = 0; at < corrupt.length - 46; at++) if (cv.getUint32(at, true) === 0x02014b50) { cv.setUint32(at + 16, 0, true); break; }
    rejectsCode(() => extractDocx(corrupt), 'DAMAGED');
  });
  it('rejects oversized declared and actually inflated XML before accepting content', () => {
    const bytes = docxFixture();
    const view = new DataView(bytes.buffer);
    for (let at = 0; at < bytes.length - 46; at++) if (view.getUint32(at, true) === 0x02014b50) { view.setUint32(at + 24, RESUME_LIMITS.expandedBytes + 1, true); break; }
    rejectsCode(() => extractDocx(bytes), 'LIMIT');
    const lied = docxFixture();
    const lv = new DataView(lied.buffer);
    for (let at = 0; at < lied.length - 46; at++) if (lv.getUint32(at, true) === 0x02014b50) { lv.setUint32(at + 24, 1, true); break; }
    rejectsCode(() => extractDocx(lied), 'LIMIT');
    rejectsCode(() => extractDocx(docxFixture(`<w:p><w:r><w:t>${'x'.repeat(100_001)}</w:t></w:r></w:p>`)), 'LIMIT');
  });
  it('rejects excessive ZIP entries and XML nesting', () => {
    rejectsCode(() => extractDocx(docxFixture(undefined, Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`part${i}`, new Uint8Array()])))), 'LIMIT');
    rejectsCode(() => extractDocx(docxFixture('<w:sdt>'.repeat(130) + '</w:sdt>'.repeat(130))), 'LIMIT');
  });
});

describe('document contracts', () => {
  it('rejects extension spoofing and Office encryption container', () => {
    rejectsCode(() => validateResumeBytes('pdf', docxFixture()), 'FORMAT');
    rejectsCode(() => validateResumeBytes('docx', pdfFixture()), 'FORMAT');
    rejectsCode(() => validateResumeBytes('docx', new Uint8Array([208,207,17,224,161,177,26,225])), 'ENCRYPTED');
  });
  it('caps cumulative text and strips display control characters', () => {
    const sections: ResumeSection[] = [];
    appendSection(sections, '1페이지', '\0Java\r\nSpring');
    expect(sections[0]?.text).toBe('Java\nSpring');
    rejectsCode(() => appendSection(sections, '2페이지', 'a'.repeat(100_000)), 'LIMIT');
  });
});

import { Inflate } from 'fflate';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import { appendSection, RESUME_LIMITS, ResumeError, type ExtractedResume } from '../../../shared/resume';

const WORD_NAMESPACES = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MAIN_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

// Validate the central directory before allocating output, then count actual
// inflated bytes in small chunks too: archive size fields are untrusted.
function documentParts(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65_557); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  }
  if (end < 0 || u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw new ResumeError('DAMAGED');
  const count = u16(end + 10);
  if (count > RESUME_LIMITS.zipEntries) throw new ResumeError('LIMIT');
  const centralEnd = u32(end + 16) + u32(end + 12);
  if (centralEnd !== end) throw new ResumeError('DAMAGED');
  let cursor = u32(end + 16), total = 0;
  const names = new Set<string>();
  const parts = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > centralEnd || u32(cursor) !== 0x02014b50) throw new ResumeError('DAMAGED');
    const flags = u16(cursor + 8), method = u16(cursor + 10);
    if (flags & 0x41) throw new ResumeError('ENCRYPTED');
    if (method !== 0 && method !== 8) throw new ResumeError('DAMAGED');
    const compressed = u32(cursor + 20), expanded = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd || u16(cursor + 34)) throw new ResumeError('DAMAGED');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    if (names.has(name) || name.includes('..') || name.includes('\\') || name.startsWith('/')) throw new ResumeError('DAMAGED');
    names.add(name);
    total += expanded;
    if (total > RESUME_LIMITS.expandedBytes) throw new ResumeError('LIMIT');
    const local = u32(cursor + 42);
    if (local + 30 > u32(end + 16) || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 26) !== nameLength) throw new ResumeError('DAMAGED');
    const start = local + 30 + nameLength + u16(local + 28);
    if (start + compressed > u32(end + 16) || !nameBytes.every((value, at) => bytes[local + 30 + at] === value)) throw new ResumeError('DAMAGED');
    if (name === 'word/document.xml' || name === '[Content_Types].xml') {
      let actual = 0, crc = 0xffffffff;
      const chunks: Uint8Array[] = [];
      const accept = (chunk: Uint8Array) => {
        actual += chunk.length;
        if (actual > expanded || actual > RESUME_LIMITS.expandedBytes) throw new ResumeError('LIMIT');
        for (const value of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 255]!;
        chunks.push(chunk.slice());
      };
      if (method === 0) accept(bytes.subarray(start, start + compressed));
      else {
        const inflate = new Inflate(accept);
        for (let offset = 0; offset < compressed; offset += 1024) inflate.push(bytes.subarray(start + offset, start + Math.min(offset + 1024, compressed)), offset + 1024 >= compressed);
      }
      if (actual !== expanded || ((crc ^ 0xffffffff) >>> 0) !== u32(cursor + 16)) throw new ResumeError('DAMAGED');
      const output = new Uint8Array(actual);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      parts.set(name, output);
    }
    cursor = next;
  }
  if (cursor !== centralEnd || !parts.has('word/document.xml') || !parts.has('[Content_Types].xml')) throw new ResumeError('FORMAT');
  return parts;
}

interface XmlVisitor {
  open?: (element: Element, depth: number) => void;
  close?: (element: Element) => void;
  text?: (value: string) => void;
}
function visitXml(bytes: Uint8Array, visitor: XmlVisitor): void {
  // OOXML permits both UTF-8 and UTF-16. Detect the BOM/XML opening bytes.
  const utf16le = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0);
  const utf16be = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c);
  const source = utf16le || utf16be ? new TextDecoder(utf16le ? 'utf-16le' : 'utf-16be', { fatal: true }).decode(bytes) : decoder.decode(bytes);
  // No DTD, entities, external resources or parser error recovery.
  if (source.includes('<!DOCTYPE')) throw new ResumeError('DAMAGED');
  let document;
  try {
    document = new DOMParser({ onError: () => { throw new Error('Invalid XML'); } }).parseFromString(source, 'application/xml');
  } catch { throw new ResumeError('DAMAGED'); }
  const root = document.documentElement;
  if (!root) throw new ResumeError('DAMAGED');
  // Iterative traversal avoids recursion on hostile documents. Do not build a
  // stack of all siblings; retain at most one frame per ancestor.
  let node: Node | null = root;
  let depth = 0, nodes = 0;
  while (node) {
    if (++nodes > 100_000) throw new ResumeError('LIMIT');
    if (node.nodeType === 1) {
      const element = node as Element;
      depth++;
      if (depth > 128 || element.attributes.length > 64) throw new ResumeError('LIMIT');
      visitor.open?.(element, depth);
    } else if (node.nodeType === 3 || node.nodeType === 4) visitor.text?.(node.nodeValue ?? '');
    if (node.firstChild) { node = node.firstChild; continue; }
    for (;;) {
      if (node.nodeType === 1) { visitor.close?.(node as Element); depth--; }
      if (node === root) return;
      if (node.nextSibling) { node = node.nextSibling; break; }
      node = node.parentNode;
      if (!node) return;
    }
  }
}

export function extractDocx(bytes: Uint8Array): ExtractedResume {
  const parts = documentParts(bytes);
  let validType = false;
  visitXml(parts.get('[Content_Types].xml')!, { open: (element) => {
    if (element.namespaceURI === CONTENT_TYPES_NS && element.localName === 'Override' && element.getAttribute('PartName') === '/word/document.xml' && element.getAttribute('ContentType') === MAIN_CONTENT_TYPE) validType = true;
  } });
  if (!validType) throw new ResumeError('FORMAT');
  const sections: ExtractedResume['sections'] = [];
  let paragraph = 0, inParagraph = false, inText = false, deletedDepth = 0, text = '', rootValid = false;
  visitXml(parts.get('word/document.xml')!, {
    open: (element, depth) => {
      const local = element.localName;
      if (depth === 1) rootValid = local === 'document' && WORD_NAMESPACES.has(element.namespaceURI ?? '');
      if (!WORD_NAMESPACES.has(element.namespaceURI ?? '')) return;
      if (local === 'del') deletedDepth++;
      if (local === 'p') {
        if (inParagraph) throw new ResumeError('DAMAGED');
        paragraph++; inParagraph = true; text = '';
      }
      if (inParagraph && !deletedDepth) {
        if (local === 't') inText = true;
        if (local === 'tab') text += '\t';
        if (local === 'br' || local === 'cr') text += '\n';
      }
    },
    text: (value) => {
      if (inText && !deletedDepth) {
        text += value;
        if (text.length > RESUME_LIMITS.textChars) throw new ResumeError('LIMIT');
      }
    },
    close: (element) => {
      if (!WORD_NAMESPACES.has(element.namespaceURI ?? '')) return;
      if (element.localName === 't') inText = false;
      if (element.localName === 'del') deletedDepth--;
      if (element.localName === 'p') { appendSection(sections, `단락 ${paragraph}`, text); inParagraph = false; }
    },
  });
  if (!rootValid) throw new ResumeError('FORMAT');
  if (!sections.length) throw new ResumeError('EMPTY');
  return { sections, warnings: ['DOCX 본문 단락과 표의 텍스트만 추출합니다. 머리글·바닥글·이미지·주석은 포함되지 않을 수 있습니다.'] };
}

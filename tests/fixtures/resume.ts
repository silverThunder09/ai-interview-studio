import { strToU8, zipSync } from 'fflate';

export const CONTENT_TYPES = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
export function docxFixture(body = '<w:p><w:r><w:t>합성 이력서 Java Spring</w:t></w:r></w:p>', extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
    ...extra,
  });
}

// Generated fixtures contain no real resume data and need no PDF-writing dependency.
export function pdfFixture({ pages = 1, text = 'Synthetic Java Spring resume', korean = false, encrypted = false }: { pages?: number; text?: string; korean?: boolean; encrypted?: boolean } = {}): Uint8Array {
  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const font = korean
    ? add('<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [4 0 R] >>')
    : add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  if (korean) add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> >>');
  const pageRefs: number[] = [];
  for (let page = 0; page < pages; page++) {
    const value = korean ? `<${Array.from(text, (char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>` : `(${text.replace(/[\\()]/g, '\\$&')})`;
    const stream = text ? `BT /F1 12 Tf 50 700 Td ${value} Tj ET` : '';
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageRefs.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pages} >>`;
  const encrypt = encrypted ? add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`) : undefined;
  let source = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R /ID [<${'11'.repeat(16)}><${'11'.repeat(16)}>]` : ''} >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(source);
}

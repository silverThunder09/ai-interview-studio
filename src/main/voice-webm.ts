// Inspect the bounded EBML header/tracks without decoding untrusted audio in main.
// This is a container gate, not a claim that every encoded packet is playable.
export function isOpusWebM(bytes: Uint8Array): boolean {
  type Element = { id: number; start: number; end: number };
  let count = 0;
  function element(offset: number, limit: number): Element {
    if (++count > 2048 || offset >= limit) throw new Error('Invalid EBML');
    function vint(at: number, id: boolean): { value: number; width: number; unknown: boolean } {
      const first = bytes[at];
      if (!first) throw new Error('Invalid EBML');
      let width = 1, mask = 0x80;
      while (!(first & mask)) { width++; mask >>= 1; }
      if (width > (id ? 4 : 8) || at + width > limit) throw new Error('Invalid EBML');
      let value = id ? first : first & (mask - 1);
      let unknown = !id && (first & (mask - 1)) === mask - 1;
      for (let i = 1; i < width; i++) { value = value * 256 + bytes[at + i]!; unknown &&= bytes[at + i] === 255; }
      if (!unknown && !Number.isSafeInteger(value)) throw new Error('Invalid EBML');
      return { value, width, unknown };
    }
    const id = vint(offset, true), size = vint(offset + id.width, false);
    const start = offset + id.width + size.width;
    // MediaRecorder may leave Segment and Cluster sizes unknown until shutdown.
    if (size.unknown && id.value !== 0x18538067 && id.value !== 0x1f43b675) throw new Error('Invalid EBML');
    const end = size.unknown ? limit : start + size.value;
    if (end > limit) throw new Error('Invalid EBML');
    return { id: id.value, start, end };
  }
  function children(start: number, end: number): Element[] {
    const result: Element[] = [];
    for (let at = start; at < end;) { const item = element(at, end); result.push(item); at = item.end; }
    return result;
  }
  const text = (item: Element) => new TextDecoder().decode(bytes.subarray(item.start, item.end));
  try {
    const header = element(0, bytes.length);
    if (header.id !== 0x1a45dfa3 || !children(header.start, header.end).some(x => x.id === 0x4282 && text(x) === 'webm')) return false;
    const segment = element(header.end, bytes.length);
    if (segment.id !== 0x18538067 || segment.end !== bytes.length) return false;
    let audio = false, cluster = false;
    for (const item of children(segment.start, segment.end)) {
      if (item.id === 0x1f43b675) { cluster ||= item.end > item.start; continue; }
      if (item.id !== 0x1654ae6b) continue;
      for (const track of children(item.start, item.end).filter(x => x.id === 0xae)) {
        const fields = children(track.start, track.end);
        const type = fields.find(x => x.id === 0x83), codec = fields.find(x => x.id === 0x86);
        if (audio || !type || type.end - type.start !== 1 || bytes[type.start] !== 2 || !codec || text(codec) !== 'A_OPUS') return false;
        audio = true;
      }
    }
    return audio && cluster;
  } catch { return false; }
}

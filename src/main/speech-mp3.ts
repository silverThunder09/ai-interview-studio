// Check a bounded MP3 container before returning bytes; Chromium handles decoding.
export function isMP3(bytes: Uint8Array): boolean {
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if (bytes.length < 10 || bytes.slice(6, 10).some(b => b > 127)) return false;
    offset = 10 + bytes[6]! * 2097152 + bytes[7]! * 16384 + bytes[8]! * 128 + bytes[9]!;
    if (bytes[5]! & 0x10) offset += 10;
  }
  function frame(at: number): number {
    if (at + 4 > bytes.length || bytes[at] !== 255 || (bytes[at + 1]! & 0xe0) !== 0xe0) return 0;
    const version = (bytes[at + 1]! >> 3) & 3, layer = (bytes[at + 1]! >> 1) & 3;
    const rateIndex = (bytes[at + 2]! >> 2) & 3, bitIndex = bytes[at + 2]! >> 4;
    if (version === 1 || layer !== 1 || rateIndex === 3 || bitIndex === 0 || bitIndex === 15) return 0;
    const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitIndex]! * 1000;
    const rate = [44100,48000,32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const size = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + ((bytes[at + 2]! >> 1) & 1);
    return at + size <= bytes.length ? size : 0;
  }
  const first = frame(offset);
  return first > 0 && frame(offset + first) > 0;
}

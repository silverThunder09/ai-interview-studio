export function webmFixture(trackType = 2): Uint8Array {
  const encode = (id: number[], data: number[]): number[] => [...id, 0x80 | data.length, ...data];
  const text = (value: string) => Array.from(new TextEncoder().encode(value));
  const header = encode([0x1a, 0x45, 0xdf, 0xa3], encode([0x42, 0x82], text('webm')));
  const track = encode([0xae], [...encode([0x83], [trackType]), ...encode([0x86], text('A_OPUS'))]);
  const tracks = encode([0x16, 0x54, 0xae, 0x6b], track);
  const cluster = encode([0x1f, 0x43, 0xb6, 0x75], encode([0xa3], [0x81, 0, 0, 0x80, 0xf8, 0xff, 0xfe]));
  return new Uint8Array([...header, ...encode([0x18, 0x53, 0x80, 0x67], [...tracks, ...cluster])]);
}

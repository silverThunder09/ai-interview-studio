// Generated silent MPEG-1 Layer III frames; no recorded voice or third-party asset.
export function mp3Fixture(frames = 400) {
  const bytes = new Uint8Array(417 * frames);
  for (let n = 0; n < frames; n++) bytes.set([0xff, 0xfb, 0x90, 0xc0], n * 417);
  return bytes;
}

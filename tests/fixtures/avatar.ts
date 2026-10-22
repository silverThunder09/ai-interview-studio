import type { AvatarAsset } from '../../src/shared/avatar';
import { deflateSync } from 'node:zlib';

export function texturedAvatarFixture(): AvatarAsset {
  function chunk(name: string, bytes: Buffer) {
    const type = Buffer.from(name), crcBytes = Buffer.concat([type, bytes]); let crc = 0xffffffff;
    for (const byte of crcBytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    const header = Buffer.alloc(4), checksum = Buffer.alloc(4); header.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, type, bytes, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 40, 180, 160, 255]))), chunk('IEND', Buffer.alloc(0))]);
  return avatarFixture('glb', json => {
    json.images = [{ uri: `data:image/png;base64,${png.toString('base64')}` }]; json.textures = [{ source: 0 }];
    json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }];
    const meshes = json.meshes as { primitives: { material?: number }[] }[]; meshes[0]!.primitives[0]!.material = 0;
  });
}

// Original synthetic geometry, no third-party character or personal data.
export function avatarFixture(format: 'glb' | 'gltf' = 'glb', change: (json: Record<string, unknown>) => void = () => {}): AvatarAsset {
  const binary = new Uint8Array(new Float32Array([-0.4, 0, 0, 0.4, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, -0.1, 0, 0, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 1, 0, 0.5, 1]).buffer);
  const json: Record<string, unknown> = {
    asset: { version: '2.0' }, buffers: [{ byteLength: binary.byteLength, ...(format === 'gltf' ? { uri: `data:application/octet-stream;base64,${Buffer.from(binary).toString('base64')}` } : {}) }],
    bufferViews: [...[0, 36, 72].map(offset => ({ buffer: 0, byteOffset: offset, byteLength: 36 })), { buffer: 0, byteOffset: 108, byteLength: 24 }],
    accessors: [...[0, 1, 2].map(bufferView => ({ bufferView, componentType: 5126, count: 3, type: 'VEC3', min: [-0.4, 0, 0], max: [0.4, 1, 0] })), { bufferView: 3, componentType: 5126, count: 3, type: 'VEC2' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 3 }, targets: [{ POSITION: 1 }, { POSITION: 2 }] }], weights: [0, 0], extras: { targetNames: ['blink', 'jawOpen'] } }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
  change(json);
  const text = new TextEncoder().encode(JSON.stringify(json));
  if (format === 'gltf') return { name: 'synthetic.gltf', format, bytes: text };
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(32); padded.set(text);
  const bytes = new Uint8Array(12 + 8 + padded.length + 8 + binary.length), v = new DataView(bytes.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, bytes.length, true);
  v.setUint32(12, padded.length, true); v.setUint32(16, 0x4e4f534a, true); bytes.set(padded, 20);
  const offset = 20 + padded.length; v.setUint32(offset, binary.length, true); v.setUint32(offset + 4, 0x004e4942, true); bytes.set(binary, offset + 8);
  return { name: 'synthetic.glb', format, bytes };
}

export const AVATAR_SLOTS = ['a', 'b'] as const;
export type AvatarSlot = typeof AVATAR_SLOTS[number];
export interface AvatarAsset { name: string; format: 'glb' | 'gltf'; bytes: Uint8Array }
export interface StagedAvatar extends AvatarAsset { token: string }
export const AVATAR_LIMITS = Object.freeze({ file: 20 * 1024 * 1024, json: 1024 * 1024, nodes: 256, vertices: 200_000, pixels: 8_388_608 });
export class AvatarError extends Error {}
const fail = (): never => { throw new AvatarError('지원 범위를 벗어난 모델입니다. 20MB 이하의 자기 포함 GLB/glTF 2.0, PNG/JPEG 텍스처(최대 2048px), 압축 확장 없는 모델을 선택하세요.'); };
export const isAvatarSlot = (value: unknown): value is AvatarSlot => value === 'a' || value === 'b';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return fail();
  return value.map(object);
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) return fail();
  return value as number;
}
function inline(uri: unknown, image = false): Uint8Array {
  if (typeof uri !== 'string') return fail();
  const match = uri.match(image ? /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/ : /^data:application\/(octet-stream|gltf-buffer);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || match[2]!.length % 4 || match[2]!.length > AVATAR_LIMITS.file * 4 / 3 + 4) return fail();
  try { return Uint8Array.from(atob(match[2]!), c => c.charCodeAt(0)); } catch { return fail(); }
}
function dimensions(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i++] !== 0xff) return fail();
      const marker = bytes[i++]!;
      if (marker === 0xff) { i--; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(i);
      if (length < 2 || i + length > bytes.length) return fail();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) { height = view.getUint16(i + 3); width = view.getUint16(i + 5); break; }
      i += length;
    }
  }
  if (!width || !height || width > 2048 || height > 2048) return fail();
  return width * height;
}
export interface PreparedAvatar {
  json: Record<string, unknown>;
  buffers: ArrayBuffer[];
  images: Uint8Array[];
  textures: { source: number }[];
}

// Validate before any Three.js parser/decoder. Only embedded resources: never fetch a URL or resolve a path.
export function prepareAvatar(asset: AvatarAsset): PreparedAvatar {
  if (!(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength > AVATAR_LIMITS.file || !asset.bytes.byteLength) return fail();
  const bytes = asset.bytes;
  let jsonBytes = bytes, bin: Uint8Array | undefined;
  if (asset.format === 'glb') {
    if (bytes.length < 20) return fail();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) return fail();
    const size = view.getUint32(12, true);
    if (size % 4 || size > AVATAR_LIMITS.json || 20 + size > bytes.length || view.getUint32(16, true) !== 0x4e4f534a) return fail();
    jsonBytes = bytes.subarray(20, 20 + size);
    const offset = 20 + size;
    if (offset !== bytes.length) {
      if (offset + 8 > bytes.length || view.getUint32(offset + 4, true) !== 0x004e4942 || view.getUint32(offset, true) % 4 || offset + 8 + view.getUint32(offset, true) !== bytes.length) return fail();
      bin = bytes.subarray(offset + 8);
    }
  } else if (asset.format !== 'gltf') return fail();
  if (jsonBytes.byteLength > AVATAR_LIMITS.json) return fail();
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)); } catch { return fail(); }
  const json = object(parsed);
  if (object(json.asset).version !== '2.0' || (json.extensionsUsed as unknown[] | undefined)?.length || (json.extensionsRequired as unknown[] | undefined)?.length) return fail();
  // Bound nesting, metadata and extension-driven decoder allocation; reject all unreviewed extensions.
  const queue: { value: unknown; depth: number }[] = [{ value: json, depth: 0 }];
  let values = 0;
  while (queue.length) {
    const { value, depth } = queue.pop()!;
    if (++values > 100_000 || depth > 32 || (typeof value === 'number' && !Number.isFinite(value))) return fail();
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || (key === 'extensions' && Object.keys(object(child)).length)) return fail();
      queue.push({ value: child, depth: depth + 1 });
    }
  }
  const buffers = list(json.buffers, 16).map((b, i) => {
    const length = integer(b.byteLength, AVATAR_LIMITS.file);
    const source = b.uri === undefined && i === 0 && bin ? bin : inline(b.uri);
    if (source.byteLength < length || source.byteLength > length + 3) return fail();
    return source.slice(0, length).buffer;
  });
  const views = list(json.bufferViews, 2048).map(v => {
    const buffer = buffers[integer(v.buffer, 15)];
    const start = integer(v.byteOffset ?? 0), length = integer(v.byteLength, AVATAR_LIMITS.file);
    if (!buffer || start + length > buffer.byteLength || (v.byteStride !== undefined && (integer(v.byteStride, 252) < 4 || Number(v.byteStride) % 4))) return fail();
    return new Uint8Array(buffer, start, length);
  });
  let allocated = 0;
  const accessors = list(json.accessors, 2048);
  for (const a of accessors) {
    const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 } as Record<string, number>)[String(a.type)];
    if (!components || ![5120, 5121, 5122, 5123, 5125, 5126].includes(Number(a.componentType))) return fail();
    allocated += integer(a.count, 600_000) * components * 4;
    if (allocated > 32 * 1024 * 1024 || a.sparse !== undefined) return fail();
    if (a.bufferView !== undefined && !views[integer(a.bufferView, 2047)]) return fail();
  }
  const nodes = list(json.nodes, AVATAR_LIMITS.nodes), meshes = list(json.meshes, 64);
  const meshCost = meshes.map(m => list(m.primitives, 32).reduce((sum, p) => {
    const attr = object(p.attributes), position = accessors[integer(attr.POSITION, 2047)];
    if (!position || position.type !== 'VEC3' || position.componentType !== 5126 || (p.mode !== undefined && p.mode !== 4)) return fail();
    const targets = list(p.targets, 8);
    const indices = p.indices === undefined ? 0 : integer(accessors[integer(p.indices, 2047)]?.count, 600_000);
    return sum + Math.max(indices, integer(position.count, AVATAR_LIMITS.vertices) * (1 + targets.length));
  }, 0));
  let cost = 0;
  const parents = new Set<number>();
  nodes.forEach(n => {
    if (n.mesh !== undefined) { const c = meshCost[integer(n.mesh, 63)]; if (c === undefined) return fail(); cost += c; }
    if (n.children !== undefined) {
      if (!Array.isArray(n.children) || n.children.length > AVATAR_LIMITS.nodes) return fail();
      for (const child of n.children) { const i = integer(child, nodes.length - 1); if (parents.has(i)) return fail(); parents.add(i); }
    }
  });
  if (cost > AVATAR_LIMITS.vertices || !cost) return fail();
  const visit = (i: number, path: Set<number>) => {
    if (path.has(i)) return fail();
    const next = new Set(path).add(i);
    for (const child of (nodes[i]!.children ?? []) as number[]) visit(child, next);
  };
  nodes.forEach((_n, i) => visit(i, new Set()));
  const scenes = list(json.scenes, 4);
  if (!scenes.length || integer(json.scene ?? 0, scenes.length - 1) >= scenes.length) return fail();
  scenes.forEach(scene => {
    if (!Array.isArray(scene.nodes) || scene.nodes.length > nodes.length || new Set(scene.nodes).size !== scene.nodes.length) return fail();
    for (const root of scene.nodes) { const i = integer(root, nodes.length - 1); if (parents.has(i)) return fail(); }
  });
  list(json.materials, 64); list(json.skins, 16).forEach(s => { if (!Array.isArray(s.joints) || s.joints.length > 128) return fail(); });
  list(json.animations, 16).forEach(a => { list(a.channels, 256); list(a.samplers, 256); });
  let pixels = 0;
  const images = list(json.images, 8).map(image => {
    const source = image.uri === undefined ? views[integer(image.bufferView, 2047)] : inline(image.uri, true);
    if (!source || (image.mimeType !== undefined && !['image/png', 'image/jpeg'].includes(String(image.mimeType)))) return fail();
    pixels += dimensions(source);
    if (pixels > AVATAR_LIMITS.pixels) return fail();
    return source;
  });
  const textures = list(json.textures, 8).map(t => { const source = integer(t.source, 7); if (!images[source]) return fail(); return { source }; });
  return { json, buffers, images, textures };
}

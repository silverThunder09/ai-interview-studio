import { constants } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AVATAR_LIMITS, AvatarError, isAvatarSlot, prepareAvatar, type AvatarAsset, type AvatarSlot, type StagedAvatar } from '../shared/avatar';
import type { Result } from '../shared/contracts';

export class AvatarModels {
  private busy = false;
  private readonly pending = new Map<AvatarSlot, StagedAvatar>();
  constructor(private readonly directory: string, private readonly choose: () => Promise<string | undefined>) {}
  private path(slot: AvatarSlot) { return join(this.directory, `${slot}.avatar`); }
  private async read(path: string, max: number): Promise<Uint8Array> {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > max) throw new AvatarError('모델 파일 크기 또는 형식을 확인하세요.');
      const bytes = new Uint8Array(max + 1); let length = 0;
      while (length < bytes.length) { const r = await file.read(bytes, length, bytes.length - length, null); if (!r.bytesRead) break; length += r.bytesRead; }
      if (length > max) throw new AvatarError('모델 파일이 너무 큽니다.');
      return bytes.slice(0, length);
    } finally { await file.close(); }
  }
  select = async (args: unknown[]): Promise<Result<StagedAvatar | null>> => {
    if (args.length !== 1 || !isAvatarSlot(args[0])) return this.invalid();
    if (this.busy) return { ok: false, error: { code: 'UNAVAILABLE', message: '모델 작업이 이미 진행 중입니다.' } };
    this.busy = true;
    try {
      const path = await this.choose(); if (!path) return { ok: true, value: null };
      const extension = extname(path).toLowerCase();
      if (extension !== '.glb' && extension !== '.gltf') throw new AvatarError('GLB 또는 glTF 파일을 선택하세요.');
      const asset: AvatarAsset = { name: Array.from(basename(path)).filter(c => c.charCodeAt(0) >= 32 && (c.charCodeAt(0) < 127 || c.charCodeAt(0) > 159)).join('').slice(0, 120), format: extension === '.glb' ? 'glb' : 'gltf', bytes: await this.read(path, AVATAR_LIMITS.file) };
      prepareAvatar(asset);
      const staged = { ...asset, token: randomUUID() };
      this.pending.set(args[0], staged);
      return { ok: true, value: staged };
    } catch (error) { return this.failure(error); } finally { this.busy = false; }
  };
  commit = async (args: unknown[]): Promise<Result<null>> => {
    if (args.length !== 2 || !isAvatarSlot(args[0]) || typeof args[1] !== 'string' || args[1].length !== 36) return this.invalid();
    const asset = this.pending.get(args[0]);
    if (!asset || asset.token !== args[1]) return this.invalid();
    if (this.busy) return { ok: false, error: { code: 'UNAVAILABLE', message: '모델 작업이 진행 중입니다.' } };
    this.busy = true;
    try {
      const header = Buffer.from(JSON.stringify({ name: asset.name, format: asset.format, sha256: createHash('sha256').update(asset.bytes).digest('hex') }), 'utf8');
      const size = Buffer.alloc(4); size.writeUInt32LE(header.length);
      await mkdir(this.directory, { recursive: true });
      const temp = join(this.directory, `${args[0]}-${randomUUID()}.tmp`);
      try { await writeFile(temp, Buffer.concat([size, header, asset.bytes]), { flag: 'wx', mode: 0o600 }); await rename(temp, this.path(args[0])); }
      finally { await rm(temp, { force: true }).catch(() => {}); }
      this.pending.delete(args[0]);
      return { ok: true, value: null };
    } catch (error) { return this.failure(error); } finally { this.busy = false; }
  };
  get = async (args: unknown[]): Promise<Result<AvatarAsset | null>> => {
    if (args.length !== 1 || !isAvatarSlot(args[0])) return this.invalid();
    try {
      const bytes = await this.read(this.path(args[0]), AVATAR_LIMITS.file + 1024);
      if (bytes.length < 4) throw new Error('corrupt');
      const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(0, true);
      if (size > 1024 || size + 4 > bytes.length) throw new Error('corrupt');
      const meta: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + size)));
      if (!meta || typeof meta !== 'object') throw new Error('corrupt');
      const m = meta as Record<string, unknown>, payload = bytes.slice(4 + size);
      if (typeof m.name !== 'string' || m.name.length > 120 || !['glb', 'gltf'].includes(String(m.format)) || m.sha256 !== createHash('sha256').update(payload).digest('hex')) throw new Error('corrupt');
      const asset: AvatarAsset = { name: m.name, format: m.format as 'glb' | 'gltf', bytes: payload };
      prepareAvatar(asset); return { ok: true, value: asset };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { ok: true, value: null };
      return this.failure(error);
    }
  };
  reset = async (args: unknown[]): Promise<Result<null>> => {
    if (args.length !== 1 || !isAvatarSlot(args[0])) return this.invalid();
    if (this.busy) return { ok: false, error: { code: 'UNAVAILABLE', message: '모델 작업이 진행 중입니다.' } };
    this.busy = true;
    try { await rm(this.path(args[0]), { force: true }); this.pending.delete(args[0]); return { ok: true, value: null }; }
    catch (error) { return this.failure(error); } finally { this.busy = false; }
  };
  private invalid(): Result<never> { return { ok: false, error: { code: 'INVALID_REQUEST', message: '면접관 A 또는 B만 지정할 수 있습니다.' } }; }
  private failure(error: unknown): Result<never> { return { ok: false, error: { code: 'UNAVAILABLE', message: error instanceof AvatarError ? error.message : '모델을 읽거나 저장하지 못했습니다. 기존 모델을 유지합니다. 파일과 권한을 확인하세요.' } }; }
}

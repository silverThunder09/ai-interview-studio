import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mesh } from 'three';
import { AVATAR_LIMITS, prepareAvatar } from '../../src/shared/avatar';
import { AvatarModels } from '../../src/main/avatar';
import { defaultActor, loadActor } from '../../src/renderer/src/avatar/model';
import { avatarFixture, texturedAvatarFixture } from '../fixtures/avatar';
import { FramePacer } from '../../src/renderer/src/avatar/clock';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
describe('bounded, offline avatar import', () => {
  it('maintains the 30FPS budget across 45/60/90Hz callbacks without halving a 45Hz display', () => {
    for (const hz of [45, 60, 90]) {
      const pacer = new FramePacer(); let rendered = 0;
      for (let i = 0; i < hz * 4; i++) if (pacer.due(i * 1000 / hz)) rendered++;
      expect(rendered).toBeGreaterThanOrEqual(119); expect(rendered).toBeLessThanOrEqual(121);
    }
  });
  it('skips missed deadlines after a stall and resets cleanly after pause', () => {
    const pacer = new FramePacer(); expect(pacer.due(0)).toBe(true);
    expect(pacer.due(10)).toBe(false); expect(pacer.due(5000)).toBe(true); expect(pacer.due(5001)).toBe(false);
    pacer.reset(); expect(pacer.due(5010)).toBe(true); expect(pacer.due(5020)).toBe(false);
  });
  it('decodes embedded texture bytes directly without fetching a Blob URL', async () => {
    const close = vi.fn(), decode = vi.fn().mockResolvedValue({ width: 1, height: 1, close });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No requests'));
    vi.stubGlobal('createImageBitmap', decode);
    try {
      const actor = await loadActor(texturedAvatarFixture());
      expect(decode).toHaveBeenCalledOnce(); expect(decode.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
      expect(fetcher).not.toHaveBeenCalled(); actor.dispose(); expect(close).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); fetcher.mockRestore(); }
  });
  it.each(['glb', 'gltf'] as const)('validates and actually parses self-contained %s without network', async format => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is forbidden'));
    try {
      const asset = avatarFixture(format), prepared = prepareAvatar(asset);
      expect(prepared.buffers[0]?.byteLength).toBe(132);
      const actor = await loadActor(asset);
      let target: Mesh | undefined; actor.root.traverse(n => { if (n instanceof Mesh) target = n; });
      expect(target?.geometry.getAttribute('position').count).toBe(3);
      actor.update(0.08, 0.016, true, false);
      expect(target?.morphTargetInfluences?.[0]).toBeGreaterThan(0.9);
      expect(target?.morphTargetInfluences?.[1]).toBeGreaterThan(0.1);
      actor.update(1, 0.016, false, true); expect(target?.morphTargetInfluences).toEqual([0, 0]);
      const disposed = vi.fn(); target!.geometry.addEventListener('dispose', disposed);
      actor.dispose(); expect(disposed).toHaveBeenCalledOnce(); expect(actor.root.children).toHaveLength(0);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it.each(['https://example.invalid/secret.bin', 'file:///etc/passwd', '../private.bin', 'data:text/html;base64,AAAA'])('rejects unapproved resource %s before loading', uri => {
    expect(() => prepareAvatar(avatarFixture('gltf', j => { j.buffers = [{ byteLength: 108, uri }]; }))).toThrow();
  });
  it('rejects truncation, oversized files, cycles, shared child expansion and decoder extensions', () => {
    const fixture = avatarFixture();
    expect(() => prepareAvatar({ ...fixture, bytes: fixture.bytes.slice(0, -1) })).toThrow();
    expect(() => prepareAvatar({ ...fixture, bytes: new Uint8Array(AVATAR_LIMITS.file + 1) })).toThrow();
    for (const change of [
      (j: Record<string, unknown>) => { j.nodes = [{ mesh: 0, children: [0] }]; },
      (j: Record<string, unknown>) => { j.nodes = [{ mesh: 0, children: [1] }, { mesh: 0 }, { children: [1] }]; },
      (j: Record<string, unknown>) => { j.extensionsUsed = ['KHR_draco_mesh_compression']; },
      (j: Record<string, unknown>) => { j.accessors = [{ count: 2 ** 31, componentType: 5126, type: 'VEC3' }]; },
      (j: Record<string, unknown>) => { j.bufferViews = [{ buffer: 0, byteOffset: 107, byteLength: 8 }]; },
    ]) expect(() => prepareAvatar(avatarFixture('glb', change))).toThrow();
  });
  it('bounds embedded texture dimensions before native image decoding', () => {
    const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47); png.writeUInt32BE(0x0d0a1a0a, 4); png.writeUInt32BE(0x49484452, 12); png.writeUInt32BE(8192, 16); png.writeUInt32BE(8192, 20);
    expect(() => prepareAvatar(avatarFixture('glb', j => { j.images = [{ uri: `data:image/png;base64,${png.toString('base64')}` }]; }))).toThrow();
  });
  it('keeps two procedural actors independent and disposes their geometry', () => {
    const a = defaultActor(true), b = defaultActor(false); expect(a.root).not.toBe(b.root);
    const mesh = a.root.children[0]!.children.find(n => n instanceof Mesh) as Mesh;
    const dispose = vi.fn(); mesh.geometry.addEventListener('dispose', dispose); a.update(1, 0.1, true, false);
    a.dispose(); expect(dispose).toHaveBeenCalledOnce(); expect(b.root.children.length).toBeGreaterThan(0); b.dispose();
  });
  it('stages before committing, restores on restart and preserves previous file after failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-avatar-')); dirs.push(directory);
    const source = join(directory, 'chosen.glb'); await writeFile(source, avatarFixture().bytes);
    const storeDir = join(directory, 'models'); const service = new AvatarModels(storeDir, async () => source);
    expect(await service.select(['a', source])).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(await service.get(['../secret'])).toMatchObject({ ok: false });
    const selected = await service.select(['a']); if (!selected.ok || !selected.value) throw Error('Expected asset');
    expect(await service.get(['a'])).toEqual({ ok: true, value: null });
    expect(await service.commit(['b', selected.value.token])).toMatchObject({ ok: false });
    expect(await service.commit(['a', selected.value.token])).toEqual({ ok: true, value: null });
    expect(await service.commit(['a', selected.value.token])).toMatchObject({ ok: false });
    const previous = await readFile(join(storeDir, 'a.avatar'));
    const restarted = new AvatarModels(storeDir, async () => undefined);
    expect(await restarted.get(['a'])).toMatchObject({ ok: true, value: { name: 'chosen.glb', format: 'glb' } });
    expect(await restarted.select(['b'])).toEqual({ ok: true, value: null });
    await writeFile(source, new Uint8Array([1, 2, 3])); expect(await service.select(['a'])).toMatchObject({ ok: false });
    expect(await readFile(join(storeDir, 'a.avatar'))).toEqual(previous);
    expect(await restarted.get(['b'])).toEqual({ ok: true, value: null });
    expect(await restarted.reset(['a'])).toEqual({ ok: true, value: null });
    expect(await restarted.get(['a'])).toEqual({ ok: true, value: null });
    expect(await readFile(source)).toEqual(Buffer.from([1, 2, 3]));
  });
});

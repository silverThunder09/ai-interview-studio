import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { prepareAvatar, type AvatarAsset } from '../../../shared/avatar';

export interface Actor {
  root: T.Group;
  update(time: number, delta: number, speaking: boolean, reduced: boolean): void;
  dispose(): void;
  capability: string;
}
export function disposeObject(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>(), skeletons = new Set<T.Skeleton>();
  root.traverse(node => {
    if (!(node instanceof T.Mesh)) return;
    geometries.add(node.geometry);
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
    }
    if (node instanceof T.SkinnedMesh) skeletons.add(node.skeleton);
  });
  textures.forEach(t => { const image: unknown = t.source.data; if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close(); t.dispose(); });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); skeletons.forEach(s => s.dispose());
}

// GLTFLoader with in-memory buffers and direct Blob decoding. No fetch, Blob URL, CSP exception or path resolution.
export async function loadActor(asset: AvatarAsset): Promise<Actor> {
  const data = prepareAvatar(asset), textures: T.Texture[] = [];
  let abandoned = false;
  const manager = new T.LoadingManager(); manager.setURLModifier(() => { throw new Error('External model resources are disabled'); });
  const loader = new GLTFLoader(manager);
  loader.register(parser => {
    parser.loadBuffer = async index => { const b = data.buffers[index]; if (!b) throw new Error('Missing buffer'); return b; };
    return { name: 'studio_embedded_resources', loadTexture: async index => {
      const def = data.textures[index], bytes = def && data.images[def.source];
      if (!bytes) throw new Error('Missing texture');
      const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer]), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (abandoned || bitmap.width > 2048 || bitmap.height > 2048) { bitmap.close(); throw new Error('Invalid texture dimensions'); }
      const texture = new T.Texture(bitmap); texture.flipY = false; texture.needsUpdate = true;
      textures.push(texture); parser.associations.set(texture, { textures: index }); return texture;
    } };
  });
  let gltf;
  try { gltf = await loader.parseAsync(JSON.stringify(data.json), ''); }
  catch (error) { abandoned = true; textures.forEach(t => { (t.source.data as ImageBitmap).close(); t.dispose(); }); throw error; }
  const model = gltf.scene, root = new T.Group(); root.add(model);
  model.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3());
  if (!Number.isFinite(size.length()) || size.y <= 0.001 || size.y > 100_000) { gltf.scenes.forEach(disposeObject); throw new Error('Invalid model bounds'); }
  const scale = 2.15 / size.y;
  model.scale.multiplyScalar(scale);
  const center = box.getCenter(new T.Vector3()); model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  const mixer = new T.AnimationMixer(model);
  const clip = gltf.animations.find(a => /idle|stand|rest/i.test(a.name)); if (clip) mixer.clipAction(clip).play();
  const morphs: { node: T.Mesh; index: number; kind: 'blink' | 'mouth' }[] = [];
  let head: T.Object3D | undefined;
  model.traverse(node => {
    if (!head && node instanceof T.Bone && /(^|[_:])head$/i.test(node.name)) head = node;
    if (!(node instanceof T.Mesh) || !node.morphTargetDictionary) return;
    for (const [name, index] of Object.entries(node.morphTargetDictionary)) {
      if (/blink|eyeclose/i.test(name)) morphs.push({ node, index, kind: 'blink' });
      else if (/^(jawopen|mouthopen|aa|viseme_aa)$/i.test(name)) morphs.push({ node, index, kind: 'mouth' });
    }
  });
  const rest = head?.quaternion.clone(), rotation = new T.Quaternion();
  return { root, capability: `불러온 3D 모델 · 눈 ${morphs.some(m => m.kind === 'blink') ? '지원' : '미지원'} · 입 ${morphs.some(m => m.kind === 'mouth') ? '지원' : '미지원'} · 고개 ${head ? '지원' : '미지원'}`,
    update(time, delta, speaking, reduced) {
      if (!reduced) mixer.update(delta);
      if (head && rest) head.quaternion.copy(rest).multiply(rotation.setFromEuler(new T.Euler(reduced ? 0 : Math.sin(time * 0.8) * 0.035, reduced ? 0 : Math.sin(time * 0.45) * 0.07, 0)));
      for (const m of morphs) if (m.node.morphTargetInfluences) m.node.morphTargetInfluences[m.index] = m.kind === 'blink' ? (reduced ? 0 : blink(time)) : (speaking ? mouth(time) : 0);
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); gltf.scenes.forEach(disposeObject); textures.forEach(t => { (t.source.data as ImageBitmap).close(); t.dispose(); }); root.clear(); },
  };
}
export const blink = (time: number) => { const phase = time % 4.1; return phase < 0.16 ? Math.sin(phase / 0.16 * Math.PI) : 0; };
export const mouth = (time: number) => 0.15 + 0.65 * Math.abs(Math.sin(time * 10.5));

export function defaultActor(technical: boolean): Actor {
  const root = new T.Group(), body = new T.Group(), head = new T.Group(); root.add(body); body.add(head); head.position.y = 1.77;
  function mesh(geometry: T.BufferGeometry, color: number, parent: T.Group, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1]) {
    const m = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, roughness: 0.7 })); m.position.set(x, y, z); m.scale.set(...scale); parent.add(m); return m;
  }
  const skin = technical ? 0xd8ad8c : 0xe3bba1, suit = technical ? 0x25394c : 0x57776d;
  mesh(new T.CapsuleGeometry(0.29, 0.58, 4, 12), suit, body, 0, 1.04, 0, [1.2, 1, 0.65]);
  mesh(new T.BoxGeometry(0.22, 0.5, 0.035), 0xe5ede8, body, 0, 1.25, 0.19);
  if (technical) mesh(new T.BoxGeometry(0.055, 0.34, 0.025), 0x31b4ac, body, 0, 1.25, 0.215);
  for (const side of [-1, 1]) {
    mesh(new T.CapsuleGeometry(0.09, 0.57, 4, 10), suit, body, side * 0.39, 1.05, 0);
    mesh(new T.SphereGeometry(0.09, 12, 8), skin, body, side * 0.4, 0.7, 0.04);
    mesh(new T.CapsuleGeometry(0.105, 0.45, 4, 10), 0x25394c, body, side * 0.17, 0.39, 0);
    mesh(new T.BoxGeometry(0.2, 0.09, 0.32), 0x17262d, body, side * 0.17, 0.07, 0.06);
  }
  mesh(new T.CylinderGeometry(0.09, 0.1, 0.17, 12), skin, body, 0, 1.53, 0);
  mesh(new T.SphereGeometry(0.26, 24, 20), skin, head, 0, 0, 0, [0.83, 1.1, 0.85]);
  mesh(new T.SphereGeometry(0.263, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), 0x27312f, head, 0, 0.045, -0.015, [0.84, 1.08, 0.86]);
  const eyes: T.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = mesh(new T.SphereGeometry(0.031, 12, 8), 0x22312e, head, side * 0.083, 0.025, 0.199, [1, 0.65, 0.35]); eyes.push(eye);
    mesh(new T.BoxGeometry(0.065, 0.013, 0.014), 0x27312f, head, side * 0.083, 0.078, 0.198);
  }
  mesh(new T.SphereGeometry(0.033, 10, 8), skin, head, 0, -0.025, 0.219, [0.7, 1.1, 0.7]);
  const lip = mesh(new T.SphereGeometry(0.045, 14, 8), 0x754c46, head, 0, -0.115, 0.196, [1, 0.15, 0.25]);
  return { root, capability: '기본 3D 캐릭터 · 실사 에셋 아님', update(time, _delta, speaking, reduced) {
    head.rotation.set(reduced ? 0 : Math.sin(time * 0.8) * 0.035, reduced ? 0 : Math.sin(time * 0.6) * 0.07, 0);
    body.position.y = reduced ? 0 : Math.sin(time * 1.6) * 0.009;
    eyes.forEach(e => { e.scale.y = Math.max(0.02, 0.65 * (1 - (reduced ? 0 : blink(time)))); });
    lip.scale.y = speaking ? mouth(time) : 0.15;
  }, dispose() { disposeObject(root); root.clear(); } };
}

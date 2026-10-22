import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { defaultActor, loadActor, type Actor } from './model';
import type { AvatarAsset, AvatarSlot } from '../../../shared/avatar';

export interface StageState { active: AvatarSlot | null; speaking: AvatarSlot | null; quality: 'low' | 'standard'; paused: boolean }
export interface StageMetrics { fps: number; geometries: number; textures: number; triangles: number }
export class AvatarStage {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(35, 1, 0.1, 50);
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly actors: Record<AvatarSlot, Actor> = { a: defaultActor(true), b: defaultActor(false) };
  private readonly rings: Record<AvatarSlot, T.Mesh>;
  private readonly epochs = { a: 0, b: 0 };
  private disposed = false;
  private lost = false;
  private last = 0;
  private frames = 0;
  private sample = 0;
  private elapsed = 0;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  state: StageState = { active: 'a', speaking: null, quality: 'low', paused: false };
  constructor(private readonly canvas: HTMLCanvasElement, private readonly metrics: (m: StageMetrics) => void, private readonly failure: (message: string) => void) {
    // Keep the last displayed frame while the 30FPS cap or pause skips rendering.
    // Also makes real screenshots independent of the browser's drawing-buffer discard timing.
    try { this.renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' }); }
    catch (error) { Object.values(this.actors).forEach(a => a.dispose()); throw error; }
    this.renderer.setClearColor(0x10282d); this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.camera.position.set(0, 1.55, 6.6);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.target.set(0, 1.1, 0); this.controls.enablePan = false;
    this.controls.minDistance = 3.2; this.controls.maxDistance = 9; this.controls.maxPolarAngle = Math.PI * 0.67; this.controls.minPolarAngle = Math.PI * 0.2;
    this.controls.minAzimuthAngle = -Math.PI * 0.45; this.controls.maxAzimuthAngle = Math.PI * 0.45;
    this.controls.update(); this.controls.saveState();
    this.scene.add(new T.HemisphereLight(0xe5ffff, 0x44504b, 2.6));
    const key = new T.DirectionalLight(0xffffff, 2.1); key.position.set(-2, 5, 4); this.scene.add(key);
    const rim = new T.DirectionalLight(0x44d8cb, 1.4); rim.position.set(3, 3, -2); this.scene.add(rim);
    const floor = new T.Mesh(new T.PlaneGeometry(8, 5), new T.MeshStandardMaterial({ color: 0x19383c, roughness: 1 })); floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    this.rings = { a: this.ring(-0.85), b: this.ring(0.85) };
    this.install('a', this.actors.a); this.install('b', this.actors.b);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.resize(); this.renderer.setAnimationLoop(this.frame);
  }
  private ring(x: number) {
    const m = new T.Mesh(new T.RingGeometry(0.51, 0.54, 40), new T.MeshBasicMaterial({ color: 0x49d9c4, side: T.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.007, 0); this.scene.add(m); return m;
  }
  private install(slot: AvatarSlot, actor: Actor) { actor.root.position.x = slot === 'a' ? -0.85 : 0.85; this.scene.add(actor.root); }
  private resize() {
    if (this.disposed || this.lost) return;
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.state.quality === 'low' ? 1 : 1.5));
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    this.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height); this.camera.updateProjectionMatrix();
  }
  setQuality(quality: 'low' | 'standard') { this.state.quality = quality; this.resize(); }
  resetView() { this.controls.reset(); }
  rotate(direction: number) { const offset = this.camera.position.clone().sub(this.controls.target); offset.applyAxisAngle(new T.Vector3(0, 1, 0), direction * 0.15); this.camera.position.copy(this.controls.target).add(offset); this.controls.update(); }
  private contextLost = (event: Event) => { event.preventDefault(); this.lost = true; this.last = 0; this.failure('3D 그래픽 연결을 잃었습니다. 복구를 기다리거나 화면을 다시 여세요. 텍스트 면접은 계속할 수 있습니다.'); };
  private contextRestored = () => { this.lost = false; this.failure(''); this.resize(); };
  private frame = (stamp: number) => {
    if (this.disposed || this.lost) return;
    if (document.hidden || this.state.paused) { this.last = 0; this.sample = 0; this.frames = 0; return; }
    if (this.last && stamp - this.last < 1000 / 30 - 0.5) return;
    const delta = this.last ? Math.min((stamp - this.last) / 1000, 0.1) : 0; this.last = stamp; this.elapsed += delta;
    for (const slot of ['a', 'b'] as const) {
      this.actors[slot].update(this.elapsed + (slot === 'b' ? 1.7 : 0), delta, this.state.speaking === slot, this.motion.matches);
      this.rings[slot].visible = this.state.active === slot;
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    if (!this.sample) this.sample = stamp;
    this.frames++;
    if (stamp - this.sample > 2000) {
      this.metrics({ fps: Math.round(this.frames * 1000 / (stamp - this.sample)), geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, triangles: this.renderer.info.render.triangles });
      this.sample = stamp; this.frames = 0;
    }
  };
  async replace(slot: AvatarSlot, asset: AvatarAsset, accept: () => Promise<boolean> = async () => true): Promise<string | null> {
    const epoch = ++this.epochs[slot];
    const actor = await loadActor(asset);
    if (this.disposed || epoch !== this.epochs[slot]) { actor.dispose(); return null; }
    let accepted: boolean;
    try { accepted = await accept(); } catch (error) { actor.dispose(); throw error; }
    if (!accepted || this.disposed || epoch !== this.epochs[slot]) { actor.dispose(); return null; }
    const old = this.actors[slot]; this.scene.remove(old.root); old.dispose(); this.actors[slot] = actor; this.install(slot, actor);
    return actor.capability;
  }
  reset(slot: AvatarSlot) { ++this.epochs[slot]; const old = this.actors[slot]; this.scene.remove(old.root); old.dispose(); this.actors[slot] = defaultActor(slot === 'a'); this.install(slot, this.actors[slot]); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.epochs.a; ++this.epochs.b;
    this.renderer.setAnimationLoop(null); this.observer.disconnect(); this.controls.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    Object.values(this.actors).forEach(a => a.dispose()); disposeObjectScene(this.scene);
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.scene.clear();
  }
}
function disposeObjectScene(scene: T.Scene) {
  scene.traverse(node => { if (node instanceof T.Mesh) { node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); } });
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { comparisonPanels, views, type ComparisonMode, type ViewName } from './comparison';
import { assembleReference, type ReferenceNode, type ReferencePack } from './reference';

export type Pose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; scale: number };
export const zeroPose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 15 };
export type Dimensions = { length: number; beam: number; height: number };
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-150, 150, 100, -100, .1, 20000);
  private controls: OrbitControls;
  private ours = new THREE.Group();
  private reference = new THREE.Group();
  private grid = new THREE.GridHelper(600, 60, 0x51727c, 0x29434c);
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private observer: ResizeObserver;
  private alive = true;
  private modelVersion = 0;
  private refVersion = 0;
  private span = 200;
  private mode: ComparisonMode = 'overlay';
  private selectedView: ViewName = 'quarter';
  private display = { ours: true, reference: true, oursOpacity: .72, referenceOpacity: .48, wireframe: false, xray: false };
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x10252e);
    this.renderer.domElement.setAttribute('aria-label', 'Ship model comparison. Drag to orbit, right-drag to pan, scroll to zoom. Keyboard: arrows pan, plus or minus zoom, Home fits both models.');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xeaf4f5, 0x40555d, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.2); light.position.set(-100, 200, -100); this.scene.add(light);
    const underside = new THREE.DirectionalLight(0xeaf4f5, 1.8);
    underside.position.set(80, -180, 80); this.scene.add(underside);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = .3;
    this.scene.add(this.ours, this.reference, this.grid);
    this.controls = this.orbitControls();
    this.renderer.domElement.addEventListener('keydown', e => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomBy(1.25); }
      else if (e.key === '-') { e.preventDefault(); this.zoomBy(.8); }
      else if (e.key === 'Home') { e.preventDefault(); this.fit(); }
    });
    this.observer = new ResizeObserver(() => { this.fit(); this.resize(); }); this.observer.observe(host);
    this.view('quarter');
  }
  private orbitControls() {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = false;
    controls.minZoom = .05; controls.maxZoom = 100;
    controls.listenToKeyEvents(this.renderer.domElement);
    controls.addEventListener('change', this.render);
    return controls;
  }
  private panels() {
    const { width, height } = this.host.getBoundingClientRect();
    return comparisonPanels(width, height, this.mode, this.selectedView);
  }
  private render = () => {
    if (!this.alive) return;
    const panels = this.panels();
    this.renderer.setScissorTest(true);
    panels.forEach((panel, index) => {
      this.ours.visible = this.display.ours && (panels.length === 1 || index === 0);
      this.reference.visible = this.display.reference && (panels.length === 1 || index === 1);
      this.renderer.setViewport(panel.x, panel.y, panel.width, panel.height);
      this.renderer.setScissor(panel.x, panel.y, panel.width, panel.height);
      this.renderer.render(this.scene, this.camera);
    });
    this.renderer.setScissorTest(false);
    this.ours.visible = this.display.ours;
    this.reference.visible = this.display.reference;
  };
  comparison(mode: ComparisonMode) { this.mode = mode; this.fit(); this.resize(); }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    const panel = this.panels()[0];
    const aspect = panel.width / panel.height;
    this.camera.left = -this.span * aspect / 2; this.camera.right = this.span * aspect / 2;
    this.camera.top = this.span / 2; this.camera.bottom = -this.span / 2;
    this.camera.updateProjectionMatrix(); this.render();
  }
  private disposeObject(object: THREE.Object3D) {
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    object.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v); } } });
    textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
  }
  private clear(group: THREE.Group) { group.children.forEach(o => this.disposeObject(o)); group.clear(); }
  private tint(object: THREE.Object3D, color: number) {
    const old = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    object.traverse(o => { if (!(o instanceof THREE.Mesh)) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { old.add(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v); }
      o.material = new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: 0, side: THREE.DoubleSide });
    });
    textures.forEach(t => t.dispose()); old.forEach(m => m.dispose());
  }
  async loadShip(url: string) {
    const version = ++this.modelVersion;
    const gltf = await this.loader.loadAsync(url);
    if (!this.alive || version !== this.modelVersion) { this.disposeObject(gltf.scene); return; }
    this.clear(this.ours); this.tint(gltf.scene, 0x6fe4d5); this.ours.add(gltf.scene); this.style({}); this.fit();
  }
  clearReference() { this.refVersion++; this.clear(this.reference); this.render(); }
  async loadGlb(file: File) {
    const version = ++this.refVersion;
    const gltf = await this.loader.parseAsync(await file.arrayBuffer(), '');
    if (!this.alive || version !== this.refVersion) { this.disposeObject(gltf.scene); return false; }
    this.clear(this.reference); this.tint(gltf.scene, 0xf0b774); this.reference.add(gltf.scene); this.style({}); return true;
  }
  loadGame(pack: ReferencePack, hull: string, components: string[]) {
    const tree = assembleReference(pack.scheme, hull, components);
    const group = new THREE.Group();
    // WoWS +Z bow becomes runtime -Z bow; X and Y retain their signs.
    group.scale.z = -1;
    const material = new THREE.MeshStandardMaterial({ color: 0xf0b774, roughness: .85, side: THREE.DoubleSide });
    const walk = (node: ReferenceNode, parent: THREE.Object3D) => {
      const frame = new THREE.Group();
      if (node.transform?.matrix) { frame.matrix.fromArray(node.transform.matrix.flat()); frame.matrixAutoUpdate = false; }
      parent.add(frame);
      if (node.visual && pack.models[node.visual]) for (const geometry of Object.values(pack.models[node.visual].geometry)) {
        if (geometry.position.length % 3 || geometry.index.length % 3 || geometry.position.some(v => !Number.isFinite(v)) || geometry.index.some(i => !Number.isInteger(i) || i < 0 || i >= geometry.position.length / 3)) throw new Error('Invalid reference geometry.');
        const mesh = new THREE.BufferGeometry(); mesh.setAttribute('position', new THREE.Float32BufferAttribute(geometry.position, 3)); mesh.setIndex(geometry.index); mesh.computeVertexNormals();
        frame.add(new THREE.Mesh(mesh, material));
      }
      Object.values(node.nodes ?? {}).forEach(child => walk(child, frame));
    };
    try { walk(tree, group); } catch (e) { this.disposeObject(group); material.dispose(); throw e; }
    this.refVersion++; this.clear(this.reference); this.reference.add(group); this.style({});
  }
  pose(p: Pose) {
    this.reference.position.set(p.x, p.y, p.z); this.reference.scale.setScalar(p.scale);
    this.reference.rotation.set(THREE.MathUtils.degToRad(p.pitch), THREE.MathUtils.degToRad(p.yaw), THREE.MathUtils.degToRad(p.roll), 'YXZ');
    this.reference.updateMatrixWorld(true); this.render();
    return this.dimensions();
  }
  style(display: Partial<typeof this.display>) {
    Object.assign(this.display, display);
    for (const [group, visible, opacity] of [[this.ours, this.display.ours, this.display.oursOpacity], [this.reference, this.display.reference, this.display.referenceOpacity]] as const) {
      group.visible = visible;
      group.traverse(o => { if (o instanceof THREE.Mesh) { const m = o.material as THREE.MeshStandardMaterial; m.opacity = opacity; m.transparent = opacity < 1; m.depthWrite = opacity >= 1; m.depthTest = !this.display.xray; m.wireframe = this.display.wireframe; m.needsUpdate = true; } });
    }
    this.render();
  }
  dimensions(): { ours: Dimensions; reference?: Dimensions } {
    const measure = (object: THREE.Object3D) => { const size = new THREE.Box3().setFromObject(object, true).getSize(new THREE.Vector3()); return { length: size.z, beam: size.x, height: size.y }; };
    return { ours: measure(this.ours), reference: this.reference.children.length ? measure(this.reference) : undefined };
  }
  center(p: Pose): Pose {
    const ours = new THREE.Box3().setFromObject(this.ours, true).getCenter(new THREE.Vector3());
    const reference = new THREE.Box3().setFromObject(this.reference, true).getCenter(new THREE.Vector3());
    return { ...p, x: p.x + ours.x - reference.x, z: p.z + ours.z - reference.z };
  }
  fit() {
    const box = new THREE.Box3().setFromObject(this.ours, true);
    if (this.reference.children.length) box.union(new THREE.Box3().setFromObject(this.reference, true));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    const { width, height } = this.panels()[0];
    const radius = size.length() / 2;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const right = new THREE.Vector3().crossVectors(this.camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const x = corner.dot(right), y = corner.dot(up);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    this.span = Math.max((maxY - minY) * 1.6, (maxX - minX) / Math.max(width / Math.max(height, 1), .1) * 1.2, 10);
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(Math.max(radius * 4, 100));
    this.controls.target.copy(center); this.camera.position.copy(center).add(offset); this.camera.zoom = 1;
    this.controls.update(); this.resize();
  }
  view(name: ViewName) {
    this.selectedView = name;
    const preset = views.find(v => v.name === name)!;
    const target = this.controls.target.clone();
    const up = new THREE.Vector3(...preset.up);
    const changedUp = !this.camera.up.equals(up);
    this.camera.up.copy(up);
    this.camera.position.copy(target).add(new THREE.Vector3(...preset.direction).multiplyScalar(1000));
    // OrbitControls caches its up-axis transform at construction. Refresh it when
    // entering/leaving plan views so orbiting never uses a stale vertical axis.
    if (changedUp) { this.controls.dispose(); this.controls = this.orbitControls(); this.controls.target.copy(target); }
    this.controls.update(); this.fit();
  }
  zoomBy(factor: number) { this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, .05, 100); this.camera.updateProjectionMatrix(); this.render(); }
  screenshot() { this.render(); const a = document.createElement('a'); a.href = this.renderer.domElement.toDataURL('image/png'); a.download = 'ship-overlay.png'; a.click(); }
  dispose() { this.alive = false; this.observer.disconnect(); this.controls.dispose(); this.clear(this.ours); this.clear(this.reference); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}

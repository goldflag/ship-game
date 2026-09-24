import * as THREE from 'three/webgpu';
import { max, mix, renderOutput, texture, uniform, vec3, vec4 } from 'three/tsl';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { comparisonPanels, views, type ComparisonMode, type ViewName } from './comparison';
import { assembleReference, geometryGroups, paintMaterials, type ReferenceMaterial, type ReferenceNode, type ReferencePack } from './reference';
import { isolateAssembly, ComponentArticulation } from './component';
import type { GunPart } from '../../src/ships/blueprint';
import { DISPLAY_TONE_MAPPING, displayGrade } from '../../src/game/DisplayTransform';
import { ShipMaterialPalette } from '../../src/game/ShipMaterialPalette';
import { ShipOcclusion } from '../../src/game/ShipOcclusion';
import { requireWebGPU, requireWebGPUBackend, type RaisedLimits } from '../../src/game/webgpu';
import { GameLighting } from './gameLighting';

export type Pose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; scale: number };
export const zeroPose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 15 };
export type Dimensions = { length: number; beam: number; height: number };
type MaterialSet = THREE.Material | THREE.Material[];
/** `game`: the port's sky light, sun shadows, ship paint detail, ship ambient occlusion and the game's display
 * grade. `studio`: flat, even light for judging shape. */
export type Lighting = 'game' | 'studio';
/** `orthographic` keeps every part at one metric scale for comparison; `perspective` is a camera's view. */
export type Projection = 'orthographic' | 'perspective';
/** Vertical field of view of the perspective camera, degrees: a long lens, so a hull's ends keep their proportion. */
const PERSPECTIVE_FOV = 30;
/** Default sun bearing from the bow, degrees clockwise: forward of the port beam, over the 3D view's shoulder. */
export const DEFAULT_SUN_BEARING = 300;
const BACKGROUND = 0x202225;
export class Viewer {
  private renderer: THREE.WebGPURenderer;
  private readonly limits: RaisedLimits = {};
  /** Resolves once the GPU device (and the game's light, when asked for) is ready; rejects without WebGPU. */
  readonly started: Promise<void>;
  private ready = false;
  private lighting: Lighting;
  private bearing = DEFAULT_SUN_BEARING;
  private game?: GameLighting;
  private readonly studio = new THREE.Group();
  private occlusion: ShipOcclusion;
  /** Each panel draws the scene into this linear HDR frame, then an output pass grades it into the canvas. */
  private readonly frame = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  private readonly exposure = uniform(1);
  private readonly output: Record<Lighting, THREE.QuadMesh>;
  private settling = false;
  private boundsDirty = true;
  private scene = new THREE.Scene();
  private readonly orthographic = new THREE.OrthographicCamera(-150, 150, 100, -100, .1, 20000);
  private readonly perspective = new THREE.PerspectiveCamera(PERSPECTIVE_FOV, 1, .1, 20000);
  private camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = this.orthographic;
  private controls: OrbitControls;
  private ours = new THREE.Group();
  private reference = new THREE.Group();
  private grid = new THREE.GridHelper(600, 60, 0x70747a, 0x3b3e43);
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private textureLoader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private observer: ResizeObserver;
  private alive = true;
  private modelVersion = 0;
  private refVersion = 0;
  private span = 200;
  private mode: ComparisonMode = 'overlay';
  private selectedView: ViewName = 'quarter';
  private originals = new Map<THREE.Mesh, MaterialSet>();
  /** Source materials are only built (and their textures fetched) once original materials are shown. */
  private pendingOriginals = new Map<THREE.Mesh, () => MaterialSet>();
  private tints = new Map<THREE.Mesh, THREE.Material>();
  private materialStyle = new WeakMap<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  private articulation?: ComponentArticulation;
  private weapon?: GunPart;
  private display = { ours: true, reference: true, oursOpacity: 1, referenceOpacity: 1, wireframe: false, xray: false, native: true };
  constructor(private host: HTMLElement, options: { lighting?: Lighting } = {}) {
    this.lighting = options.lighting ?? 'game';
    this.renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', requiredLimits: this.limits });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // The output pass writes display values itself; the canvas takes them as they are.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Model comparison. Drag to orbit, right-drag to pan, scroll to zoom. Keyboard: arrows pan, plus or minus zoom, Home fits both models.');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.studio.add(new THREE.HemisphereLight(0xeaf4f5, 0x40555d, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.2); light.position.set(-100, 200, -100); this.studio.add(light);
    const underside = new THREE.DirectionalLight(0xeaf4f5, 1.8);
    underside.position.set(80, -180, 80); this.studio.add(underside);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = .3;
    this.scene.add(this.studio, this.ours, this.reference, this.grid);
    this.occlusion = this.createOcclusion();
    this.frame.texture.name = 'Model viewer radiance';
    this.output = { game: this.outputPass(true), studio: this.outputPass(false) };
    this.controls = this.orbitControls();
    this.renderer.domElement.addEventListener('keydown', e => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomBy(1.25); }
      else if (e.key === '-') { e.preventDefault(); this.zoomBy(.8); }
      else if (e.key === 'Home') { e.preventDefault(); this.fit(); }
    });
    this.observer = new ResizeObserver(() => { this.fit(); this.resize(); }); this.observer.observe(host);
    this.view('quarter');
    this.started = this.start();
  }
  private async start() {
    Object.assign(this.limits, await requireWebGPU());
    await this.renderer.init();
    requireWebGPUBackend(this.renderer);
    if (!this.alive) return;
    if (this.lighting === 'game') await this.createGameLighting();
    this.ready = true;
    this.applyLighting(); this.resize();
  }
  private async createGameLighting() {
    try {
      const game = await GameLighting.create(this.renderer, this.bearing);
      if (!this.alive) { game.dispose(); return; }
      this.game = game;
      this.scene.add(game.sun, game.fill);
    } catch (e) {
      console.warn('The game light could not start; using studio light.', e);
      this.lighting = 'studio';
    }
  }
  /** A display pass over the HDR frame. Its alpha is coverage: the frame clears to transparent, so
   * antialiased edges and ghosted models blend over the viewer's background after the grade. */
  private outputPass(graded: boolean) {
    const frame = texture(this.frame.texture), coverage = frame.a;
    const radiance = frame.rgb.div(max(coverage, 1e-4));
    const display = graded
      ? renderOutput(vec4(displayGrade(radiance, this.exposure), 1), DISPLAY_TONE_MAPPING, THREE.SRGBColorSpace)
      : renderOutput(vec4(radiance, 1), THREE.NoToneMapping, THREE.SRGBColorSpace);
    const material = new THREE.NodeMaterial();
    material.name = graded ? 'Model viewer game display' : 'Model viewer studio display';
    // The background is a display colour, as the page around the canvas.
    const background = vec3(...[16, 8, 0].map(shift => (BACKGROUND >> shift & 255) / 255) as [number, number, number]);
    material.fragmentNode = vec4(mix(background, display.rgb, coverage), 1);
    return new THREE.QuadMesh(material);
  }
  /** Game or studio light. The game's light is built on first use. */
  async setLighting(lighting: Lighting) {
    this.lighting = lighting;
    await this.started;
    if (lighting === 'game' && !this.game) await this.createGameLighting();
    this.applyLighting();
  }
  /** Sun bearing from the bow in degrees clockwise (game light only). */
  setSunBearing(bearing: number) {
    this.bearing = bearing;
    this.game?.setBearing(bearing);
    this.settle();
  }
  private applyLighting() {
    const game = this.lighting === 'game' ? this.game : undefined;
    this.studio.visible = !game;
    if (this.game) { this.game.sun.visible = this.game.fill.visible = !!game; this.game.sun.castShadow = !!game; }
    this.scene.environment = game ? game.environment : null;
    this.occlusion.setLevel(game ? 'high' : 'off');
    this.boundsDirty = true;
    this.settle();
  }
  /** While the game's sky settles after a change, keep drawing so its light arrives. */
  private settle() {
    if (this.settling || !this.ready) { this.render(); return; }
    this.settling = true;
    const tick = () => {
      if (!this.alive) return;
      const more = this.lighting === 'game' && !!this.game?.step();
      this.render();
      if (more) requestAnimationFrame(tick); else this.settling = false;
    };
    tick();
  }
  /** Ship occlusion for the current camera; it compiles the camera's projection into its passes. */
  private createOcclusion(previous?: ShipOcclusion) {
    const occlusion = new ShipOcclusion(this.camera, false);
    // A model seen whole keeps its occlusion at every zoom.
    occlusion.fadeStart.value = 1e8; occlusion.fadeEnd.value = 2e8;
    if (previous) {
      occlusion.radius.value = previous.radius.value; occlusion.thickness.value = previous.thickness.value;
      occlusion.setLevel(this.lighting === 'game' && this.game ? 'high' : 'off');
      occlusion.adopt(this.ours);
      previous.dispose();
    }
    return occlusion;
  }
  /** Switch between the orthographic comparison view and a perspective camera, keeping the view direction. */
  setProjection(projection: Projection) {
    const next = projection === 'perspective' ? this.perspective : this.orthographic;
    if (next === this.camera) return;
    const target = this.controls.target.clone(), direction = this.camera.position.clone().sub(target).normalize();
    next.up.copy(this.camera.up);
    next.position.copy(target).add(direction.multiplyScalar(1000));
    this.camera = next;
    this.controls.dispose(); this.controls = this.orbitControls(); this.controls.target.copy(target);
    this.occlusion = this.createOcclusion(this.occlusion);
    this.controls.update(); this.fit();
  }
  private sceneBounds() {
    const box = new THREE.Box3();
    for (const group of [this.ours, this.reference]) if (group.visible && group.children.length) box.union(new THREE.Box3().setFromObject(group));
    return box;
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
    if (!this.alive || !this.ready) return;
    const panels = this.panels(), renderer = this.renderer, ratio = renderer.getPixelRatio();
    const { height } = this.host.getBoundingClientRect();
    const game = this.lighting === 'game' ? this.game : undefined;
    if (game && this.boundsDirty) { this.boundsDirty = false; game.fit(this.sceneBounds()); }
    if (game) { this.scene.environmentIntensity = game.environmentIntensity; this.exposure.value = game.exposure.value; }
    const size = new THREE.Vector2();
    panels.forEach((panel, index) => {
      this.ours.visible = this.display.ours && (panels.length === 1 || index === 0);
      this.reference.visible = this.mode !== 'inspect' && this.display.reference && (panels.length === 1 || index === 1);
      size.set(Math.max(1, Math.round(panel.width * ratio)), Math.max(1, Math.round(panel.height * ratio)));
      if (this.frame.width !== size.x || this.frame.height !== size.y) this.frame.setSize(size.x, size.y);
      if (game) this.occlusion.render(renderer, this.scene, size);
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.frame);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(null);
      // comparisonPanels() measures from the bottom, as WebGL does; WebGPU viewports start at the top.
      const top = height - panel.y - panel.height;
      renderer.setViewport(panel.x, top, panel.width, panel.height);
      renderer.setScissor(panel.x, top, panel.width, panel.height);
      renderer.setScissorTest(true);
      // Clearing the canvas would wipe the panels already drawn; each output covers its own panel.
      renderer.autoClear = false;
      this.output[game ? 'game' : 'studio'].render(renderer);
      renderer.autoClear = true;
      renderer.setScissorTest(false);
    });
    renderer.setViewport(0, 0, this.host.clientWidth, this.host.clientHeight);
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
    if (this.camera === this.perspective) this.perspective.aspect = aspect;
    else Object.assign(this.orthographic, { left: -this.span * aspect / 2, right: this.span * aspect / 2, top: this.span / 2, bottom: -this.span / 2 });
    this.camera.updateProjectionMatrix(); this.render();
  }
  private disposeObject(object: THREE.Object3D) {
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    object.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const original = this.originals.get(o) ?? o.material; const tint = this.tints.get(o); if (tint) materials.add(tint); this.originals.delete(o); this.tints.delete(o); this.pendingOriginals.delete(o); for (const m of Array.isArray(original) ? original : [original]) { materials.add(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v); } } });
    this.occlusion.release(materials);
    textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
  }
  private clear(group: THREE.Group) {
    group.children.forEach(o => this.disposeObject(o)); group.clear();
    if (group === this.reference) { this.textures.forEach(t => t.dispose()); this.textures.clear(); }
  }
  private tint(object: THREE.Object3D, color: number) {
    object.traverse(o => { if (!(o instanceof THREE.Mesh)) return;
      this.originals.set(o, o.material);
      this.tints.set(o, new THREE.MeshStandardNodeMaterial({ color, roughness: .85, metalness: 0, side: THREE.DoubleSide }));
    });
  }
  private texture(path: string, color: boolean) {
    let texture = this.textures.get(path);
    if (!texture) {
      texture = this.textureLoader.load(`/api/texture/${path}`, () => this.render(), undefined, () => {});
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      // Source UVs follow the game engine's top-left origin; three.js flips images by default.
      texture.flipY = false;
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(path, texture);
    }
    return texture;
  }
  private phong(definition: ReferenceMaterial) {
    return new THREE.MeshPhongMaterial({
      color: definition.color ?? 0xffffff, specular: definition.specular ?? 0x202020, shininess: definition.shininess ?? 32, side: THREE.DoubleSide,
      map: definition.map ? this.texture(definition.map, true) : null,
      specularMap: definition.specularMap ? this.texture(definition.specularMap, false) : null,
      normalMap: definition.normalMap ? this.texture(definition.normalMap, false) : null,
      aoMap: definition.aoMap ? this.texture(definition.aoMap, false) : null,
    });
  }
  clearModel() { this.modelVersion++; this.clear(this.ours); this.articulation = undefined; this.weapon = undefined; this.boundsDirty = true; this.render(); }
  /** `surfaceDetail` adds the game's plating, teak and wear to the paint: ships and their components, not aircraft. */
  async loadShip(url: string, component?: { assemblyId: string; weapon?: GunPart; installed: boolean }, gridMetres = component ? 1 : 10, surfaceDetail = true) {
    const version = ++this.modelVersion;
    const [gltf] = await Promise.all([this.loader.loadAsync(url), this.started]);
    if (!this.alive || version !== this.modelVersion) { this.disposeObject(gltf.scene); return false; }
    let model: THREE.Object3D = gltf.scene;
    try { if (component?.installed) model = isolateAssembly(gltf.scene, component.assemblyId); }
    catch (e) { this.disposeObject(gltf.scene); throw e; }
    // The game's paint: shared node materials with its surface detail, which its occlusion can reach.
    new ShipMaterialPalette({ surfaceDetail }).apply(model);
    const diagonal = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).length();
    // The game's 3.5 m reach suits a hull; a gun mount or an aircraft needs a proportionally smaller one.
    this.occlusion.radius.value = THREE.MathUtils.clamp(diagonal * .012, .08, 3.5);
    this.occlusion.thickness.value = this.occlusion.radius.value * 6 / 7;
    this.clear(this.ours); this.tint(model, 0x6fe4d5); this.ours.add(model);
    this.weapon = component?.weapon;
    this.articulation = component ? new ComponentArticulation(model, component.assemblyId) : undefined;
    this.grid.scale.setScalar(gridMetres / 10);
    this.style({}); this.fit(); return true;
  }
  componentPose(yaw: number, elevation: number, recoil: number) { if (this.weapon) this.articulation?.pose(this.weapon, yaw, elevation, recoil); this.render(); return this.dimensions(); }
  clearReference() { this.refVersion++; this.clear(this.reference); this.boundsDirty = true; this.render(); }
  async loadGlb(file: File) {
    const version = ++this.refVersion;
    const gltf = await this.loader.parseAsync(await file.arrayBuffer(), '');
    if (!this.alive || version !== this.refVersion) { this.disposeObject(gltf.scene); return false; }
    this.clear(this.reference); this.tint(gltf.scene, 0xf0b774); this.reference.add(gltf.scene); this.boundsDirty = true; this.style({}); return true;
  }
  loadGame(pack: ReferencePack, hull: string, components: string[], paint = 'default') {
    const tree = assembleReference(pack.scheme, hull, components);
    const group = new THREE.Group();
    // WoWS +Z bow becomes runtime -Z bow; X and Y retain their signs.
    group.scale.z = -1;
    const tint = new THREE.MeshStandardMaterial({ color: 0xf0b774, roughness: .85, side: THREE.DoubleSide });
    const staged: { mesh: THREE.Mesh; originals?: () => MaterialSet }[] = [];
    const walk = (node: ReferenceNode, parent: THREE.Object3D) => {
      const frame = new THREE.Group();
      if (node.transform?.matrix) { frame.matrix.fromArray(node.transform.matrix.flat()); frame.matrixAutoUpdate = false; }
      parent.add(frame);
      const model = node.visual ? pack.models[node.visual] : undefined;
      if (model) for (const [key, geometry] of Object.entries(model.geometry)) {
        if (geometry.position.length % 3 || geometry.index.length % 3 || geometry.position.some(v => !Number.isFinite(v)) || geometry.index.some(i => !Number.isInteger(i) || i < 0 || i >= geometry.position.length / 3)) throw new Error('Invalid reference geometry.');
        const buffer = new THREE.BufferGeometry(); buffer.setAttribute('position', new THREE.Float32BufferAttribute(geometry.position, 3)); buffer.setIndex(geometry.index); buffer.computeVertexNormals();
        const textured = Array.isArray(geometry.uv) && geometry.uv.length === geometry.position.length / 3 * 2 && geometry.uv.every(v => Number.isFinite(v));
        if (textured) buffer.setAttribute('uv', new THREE.Float32BufferAttribute(geometry.uv!, 2));
        const groups = geometryGroups(geometry);
        for (const g of groups) buffer.addGroup(g.start, g.count, g.material);
        const slots = groups.length ? Math.max(...groups.map(g => g.material)) + 1 : 1;
        const mesh = new THREE.Mesh(buffer, tint);
        const definitions = textured ? paintMaterials(model, key, paint) : undefined;
        const originals = definitions?.length ? () => {
          const built = definitions.map(d => this.phong(d));
          return groups.length ? Array.from({ length: slots }, (_, i) => built[Math.min(i, built.length - 1)]) : built[0];
        } : undefined;
        staged.push({ mesh, originals });
        frame.add(mesh);
      }
      Object.values(node.nodes ?? {}).forEach(child => walk(child, frame));
    };
    try { walk(tree, group); } catch (e) { this.disposeObject(group); tint.dispose(); throw e; }
    this.refVersion++; this.clear(this.reference);
    for (const { mesh, originals } of staged) { this.tints.set(mesh, tint); if (originals) this.pendingOriginals.set(mesh, originals); }
    this.reference.add(group); this.boundsDirty = true; this.style({});
  }
  pose(p: Pose) {
    this.reference.position.set(p.x, p.y, p.z); this.reference.scale.setScalar(p.scale);
    this.reference.rotation.set(THREE.MathUtils.degToRad(p.pitch), THREE.MathUtils.degToRad(p.yaw), THREE.MathUtils.degToRad(p.roll), 'YXZ');
    this.reference.updateMatrixWorld(true); this.boundsDirty = true; this.render();
    return this.dimensions();
  }
  style(display: Partial<typeof this.display>) {
    Object.assign(this.display, display);
    if (this.display.native) for (const [mesh, build] of this.pendingOriginals) { this.originals.set(mesh, build()); this.pendingOriginals.delete(mesh); }
    for (const [group, visible, opacity] of [[this.ours, this.display.ours, this.display.oursOpacity], [this.reference, this.display.reference, this.display.referenceOpacity]] as const) {
      group.visible = visible;
      group.traverse(o => { if (o instanceof THREE.Mesh) {
        o.material = (this.display.native ? this.originals.get(o) : this.tints.get(o)) ?? o.material;
        o.castShadow = o.receiveShadow = true;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as THREE.MeshStandardMaterial[]) {
          if (!this.materialStyle.has(m)) this.materialStyle.set(m, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
          const base = this.materialStyle.get(m)!;
          m.opacity = base.opacity * opacity;
          // Opacity is a uniform; only a changed pipeline state needs the material rebuilt.
          const state = { transparent: base.transparent || m.opacity < 1, depthWrite: base.depthWrite && opacity >= 1, depthTest: !this.display.xray, wireframe: this.display.wireframe };
          if ((Object.keys(state) as (keyof typeof state)[]).some(key => m[key] !== state[key])) { Object.assign(m, state); m.needsUpdate = true; }
        }
      } });
    }
    // Ship materials receive occlusion; a tint swapped in takes it too.
    this.occlusion.adopt(this.ours);
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
  /** Compare isolated shapes at their true size, with horizontal bounds centered and bases aligned. */
  alignComponent(p: Pose): Pose {
    const centered = this.center(p);
    const ours = new THREE.Box3().setFromObject(this.ours, true);
    const reference = new THREE.Box3().setFromObject(this.reference, true);
    return { ...centered, y: p.y + ours.min.y - reference.min.y };
  }
  triangles() {
    const count = (object: THREE.Object3D) => {
      let total = 0;
      object.traverse(o => { if (o instanceof THREE.Mesh) total += ((o.geometry.index?.count ?? o.geometry.getAttribute('position')?.count ?? 0) / 3) * (o instanceof THREE.InstancedMesh ? o.count : 1); });
      return Math.round(total);
    };
    return { ours: count(this.ours), reference: this.reference.children.length ? count(this.reference) : undefined };
  }
  fit() {
    const box = new THREE.Box3().setFromObject(this.ours, true);
    if (this.mode !== 'inspect' && this.reference.children.length) box.union(new THREE.Box3().setFromObject(this.reference, true));
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
    this.span = Math.max((maxY - minY) * 1.6, (maxX - minX) / Math.max(width / Math.max(height, 1), .1) * 1.2, .5);
    // The perspective camera stands back far enough for the same span to fill its view at the model's centre.
    const distance = this.camera === this.perspective ? this.span / 2 / Math.tan(THREE.MathUtils.degToRad(PERSPECTIVE_FOV / 2)) + radius * .25 : Math.max(radius * 4, 100);
    if (this.camera === this.perspective) { this.perspective.near = Math.max(distance / 1000, .01); this.perspective.far = distance * 20 + radius * 4; }
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(distance);
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
  zoomBy(factor: number) {
    if (this.camera === this.perspective) {
      // Perspective zoom walks the camera toward the target, as the wheel does.
      const target = this.controls.target, offset = this.camera.position.clone().sub(target).divideScalar(factor);
      this.camera.position.copy(target).add(offset); this.controls.update(); this.render(); return;
    }
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, .05, 100); this.camera.updateProjectionMatrix(); this.render();
  }
  screenshot() { this.render(); const a = document.createElement('a'); a.href = this.renderer.domElement.toDataURL('image/png'); a.download = 'model-viewer.png'; a.click(); }
  thumbnail() { this.grid.visible = false; this.render(); return this.renderer.domElement.toDataURL('image/webp', .85); }
  dispose() {
    this.alive = false; this.observer.disconnect(); this.controls.dispose(); this.clear(this.ours); this.clear(this.reference); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose();
    this.game?.dispose(); this.occlusion.dispose(); this.frame.dispose(); Object.values(this.output).forEach(quad => (quad.material as THREE.Material).dispose());
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

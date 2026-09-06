import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Quaternion,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './style.css';

interface AircraftEntry {
  id: string;
  name: string;
  nation: string;
  role: string;
  year: number;
  length: number;
  wingspan: number;
  modelUrl: string;
  description?: string;
  lods?: { level: number; modelUrl: string; switchDistanceM: number }[];
}

type View = 'quarter' | 'top' | 'side' | 'front' | 'rear';
type JointKind = 'propeller' | 'rudder' | 'elevator' | 'aileron' | 'gear' | 'diveBrake';
interface Joint {
  id: string;
  object: Object3D;
  rest: Quaternion;
  kind: JointKind;
  fixed: boolean;
}

interface ReviewPose {
  propellerAngle?: number;
  controlsAngle?: number;
  gearFraction?: number;
  diveBrakeAngle?: number;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Aircraft review element missing: ${id}`);
  return found as T;
}

const stage = element('model-stage');
const select = element<HTMLSelectElement>('aircraft-select');
const detailSelect = element<HTMLSelectElement>('detail-select');
const brakeToggle = element<HTMLInputElement>('brake-toggle');
const message = element('model-message');
const status = element('model-status');
const retry = element<HTMLButtonElement>('retry-button');
const fieldset = element<HTMLFieldSetElement>('articulation-controls');
const propellerToggle = element<HTMLInputElement>('propeller-toggle');
const controlsToggle = element<HTMLInputElement>('controls-toggle');
const gearToggle = element<HTMLInputElement>('gear-toggle');
const gridToggle = element<HTMLInputElement>('grid-toggle');
const resetButton = element<HTMLButtonElement>('reset-button');
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const listeners = new AbortController();
const fetches = new AbortController();
const loader = new GLTFLoader();
const scene = new Scene();
scene.background = new Color('#a4b6bf');
const camera = new OrthographicCamera(-15, 15, 15, -15, 0.1, 500);
const center = new Vector3();
const size = new Vector3();
const rotation = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
let renderer: WebGLRenderer | undefined;
let orbit: OrbitControls | undefined;
let resizeObserver: ResizeObserver | undefined;
let disposed = false;
let model: Object3D | undefined;
let modelBounds: Box3 | undefined;
let catalog: AircraftEntry[] = [];
let selected: AircraftEntry | undefined;
let joints: Joint[] = [];
let requestId = 0;
let ready = false;
let error: string | null = null;
let radius = 10;
let needsRender = true;
let lastFrame = 0;
let elapsed = 0;
let gearFraction = 0;
let manualPose: ReviewPose | null = null;
let currentLOD = 0;
let currentModelUrl: string | null = null;
let currentView: View | 'orbit' = 'quarter';
const floor = new Mesh(new PlaneGeometry(2000, 2000), new MeshStandardMaterial({ color: '#758891', roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new GridHelper(80, 80, '#627b85', '#82969e');
scene.add(grid);
const fill = new HemisphereLight('#e5efff', '#5e727c', 2.1);
scene.add(fill);
const sun = new DirectionalLight('#fff3dd', 3.2);
sun.position.set(-18, 28, -17);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.04;
sun.shadow.bias = -0.0002;
scene.add(sun, sun.target);
const rim = new DirectionalLight('#c4dce9', 1.3);
rim.position.set(14, 12, 18);
scene.add(rim);

function showMessage(title: string, detail: string, canRetry = false): void {
  element('message-title').textContent = title;
  element('message-detail').textContent = detail;
  retry.hidden = !canRetry;
  message.hidden = false;
}

function disposeModel(root: Object3D): void {
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => {
    const source = texture.source.data;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
    texture.dispose();
  });
}

function parseCatalog(value: unknown): AircraftEntry[] {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('aircraft' in value) || !Array.isArray(value.aircraft)) {
    throw new Error('The aircraft collection has an unsupported format. Rebuild the aircraft catalog.');
  }
  const ids = new Set<string>();
  return value.aircraft.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('The aircraft catalog contains an invalid entry.');
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) throw new Error('The aircraft catalog contains an invalid or repeated aircraft ID.');
    ids.add(item.id);
    for (const field of ['name', 'nation', 'role']) {
      if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error(`Aircraft ${item.id} is missing its ${field}.`);
    }
    for (const field of ['year', 'length', 'wingspan']) {
      if (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || (item[field] as number) <= 0) throw new Error(`Aircraft ${item.id} has an invalid ${field}.`);
    }
    const modelUrl = item.modelUrl ?? `/models/aircraft/${item.id}.glb`;
    if (typeof modelUrl !== 'string' || !modelUrl.startsWith('/models/aircraft/') || !modelUrl.endsWith('.glb')) throw new Error(`Aircraft ${item.id} has an invalid model path.`);
    return { ...item, modelUrl } as unknown as AircraftEntry;
  });
}

function setReady(value: boolean): void {
  ready = value;
  fieldset.disabled = !value;
  detailSelect.disabled = !value;
  resetButton.disabled = !value;
  for (const button of viewButtons) button.disabled = !value;
  stage.setAttribute('aria-busy', String(!value && !error));
}

function updateMetadata(entry: AircraftEntry): void {
  element('aircraft-name').textContent = entry.name;
  element('aircraft-description').textContent = entry.description || 'Carrier aircraft · Original model';
  element('aircraft-nation').textContent = entry.nation;
  element('aircraft-role').textContent = entry.role;
  element('aircraft-year').textContent = String(entry.year);
  element('aircraft-length').textContent = `${entry.length.toFixed(2)} m`;
  element('aircraft-wingspan').textContent = `${entry.wingspan.toFixed(2)} m`;
  document.title = `${entry.name} — Aircraft hangar`;
}

function jointKind(id: string): JointKind | undefined {
  if (id === 'propeller.spin') return 'propeller';
  if (id === 'control.rudder') return 'rudder';
  if (id.startsWith('control.elevator.')) return 'elevator';
  if (id.startsWith('control.aileron.')) return 'aileron';
  if (id.startsWith('diveBrake.')) return 'diveBrake';
  if (id.startsWith('gear.')) return 'gear';
  return undefined;
}

function readJoints(root: Object3D): Joint[] {
  const found: Joint[] = [];
  root.traverse(object => {
    const id = typeof object.userData.nodeId === 'string' ? object.userData.nodeId : object.name;
    const kind = jointKind(id);
    if (kind) found.push({ id, object, kind, rest: object.quaternion.clone(), fixed: object.userData.fixed === true || object.userData.articulation === 'fixed' });
    if (object instanceof Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.castShadow = !materials.every(material => material.transparent);
      object.receiveShadow = true;
    }
  });
  return found;
}

function resize(): void {
  if (!renderer || !orbit) return;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  const aspect = width / height;
  // Fit the silhouette in each named view while leaving room for the instruments.
  let halfHeight = radius * 1.2 * Math.max(1, 1 / aspect);
  if (modelBounds) {
    const forward = camera.position.clone().sub(center).normalize();
    const right = new Vector3().crossVectors(camera.up, forward).normalize();
    const up = new Vector3().crossVectors(forward, right).normalize();
    let extentX = 0;
    let extentY = 0;
    for (const x of [modelBounds.min.x, modelBounds.max.x]) {
      for (const y of [modelBounds.min.y, modelBounds.max.y]) {
        for (const z of [modelBounds.min.z, modelBounds.max.z]) {
          const corner = new Vector3(x, y, z).sub(center);
          extentX = Math.max(extentX, Math.abs(corner.dot(right)));
          extentY = Math.max(extentY, Math.abs(corner.dot(up)));
        }
      }
    }
    halfHeight = Math.max(extentY * 1.4, extentX / aspect * 1.24, radius * 0.32);
  }
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  needsRender = true;
}

function setView(view: View): void {
  if (!orbit) return;
  currentView = view;
  const direction = {
    quarter: new Vector3(1.1, 0.65, -1.4),
    top: new Vector3(0, 1, -0.00001),
    side: new Vector3(1, 0, 0),
    front: new Vector3(0, 0, -1),
    rear: new Vector3(0, 0, 1),
  }[view];
  camera.up.set(0, 1, 0);
  camera.position.copy(center).addScaledVector(direction.normalize(), radius * 4);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  orbit.target.copy(center);
  orbit.update();
  resize();
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  needsRender = true;
}

function resetPose(): void {
  manualPose = null;
  elapsed = 0;
  gearFraction = 0;
  propellerToggle.checked = false;
  controlsToggle.checked = false;
  gearToggle.checked = false;
  brakeToggle.checked = false;
  for (const joint of joints) joint.object.quaternion.copy(joint.rest);
  needsRender = true;
}

function updatePose(delta: number): boolean {
  const targetGear = gearToggle.checked ? 1 : 0;
  const oldGear = gearFraction;
  gearFraction += Math.sign(targetGear - gearFraction) * Math.min(Math.abs(targetGear - gearFraction), delta * 0.7);
  const moving = propellerToggle.checked || controlsToggle.checked || oldGear !== gearFraction;
  if (!moving && !manualPose && !needsRender) return false;
  elapsed += delta;
  const swing = manualPose?.controlsAngle ?? (controlsToggle.checked ? Math.sin(elapsed * 1.5) * 0.3 : 0);
  for (const joint of joints) {
    if (joint.fixed) continue;
    let angle = 0;
    let axis = xAxis;
    if (joint.kind === 'propeller') {
      axis = zAxis;
      angle = manualPose?.propellerAngle ?? (propellerToggle.checked ? -elapsed * 19 : 0);
    } else if (joint.kind === 'rudder') {
      axis = yAxis;
      angle = swing;
    } else if (joint.kind === 'diveBrake') {
      angle = (manualPose?.diveBrakeAngle ?? (brakeToggle.checked ? 0.8 : 0)) * Number(joint.object.userData.rotationMultiplier ?? 1);
    } else if (joint.kind === 'gear') {
      axis = zAxis;
      angle = (manualPose?.gearFraction ?? gearFraction) * Math.PI * 0.43 * (joint.id.endsWith('.port') ? 1 : -1);
      if (joint.id.endsWith('.tail')) angle *= 0.5;
    } else {
      angle = swing * (joint.kind === 'aileron' && joint.id.endsWith('.port') ? -1 : 1);
    }
    joint.object.quaternion.copy(joint.rest).multiply(rotation.setFromAxisAngle(axis, angle));
  }
  return moving || manualPose !== null;
}

async function selectAircraft(id: string, lod = currentLOD): Promise<void> {
  const entry = catalog.find(candidate => candidate.id === id);
  if (!entry || disposed) return;
  const thisRequest = ++requestId;
  selected = entry;
  currentLOD = [0, 1, 2].includes(lod) ? lod : 0;
  detailSelect.value = String(currentLOD);
  currentModelUrl = entry.lods?.find(level => level.level === currentLOD)?.modelUrl ?? entry.modelUrl;
  select.value = id;
  updateMetadata(entry);
  error = null;
  setReady(false);
  resetPose();
  joints = [];
  if (model) {
    scene.remove(model);
    disposeModel(model);
    model = undefined;
    modelBounds = undefined;
  }
  status.textContent = `Loading ${entry.name}`;
  showMessage(`Loading ${entry.name}`, 'Opening the original aircraft model…');
  needsRender = true;
  try {
    const gltf = await loader.loadAsync(currentModelUrl);
    if (disposed || requestId !== thisRequest) {
      disposeModel(gltf.scene);
      return;
    }
    model = gltf.scene;
    const bounds = new Box3().setFromObject(model);
    if (bounds.isEmpty() || !Number.isFinite(bounds.min.length() + bounds.max.length())) throw new Error('The exported model has no usable geometry. Rebuild this aircraft.');
    bounds.getCenter(center);
    bounds.getSize(size);
    modelBounds = bounds;
    radius = Math.max(size.length() / 2, 1);
    joints = readJoints(model);
    scene.add(model);
    floor.position.y = bounds.min.y - 0.04;
    grid.position.y = bounds.min.y - 0.025;
    sun.target.position.copy(center);
    sun.position.copy(center).add(new Vector3(-radius * 1.4, radius * 2.3, -radius * 1.3));
    Object.assign(sun.shadow.camera, { left: -radius * 1.5, right: radius * 1.5, top: radius * 1.5, bottom: -radius * 1.5, near: 0.1, far: radius * 8 });
    sun.shadow.camera.updateProjectionMatrix();
    propellerToggle.disabled = !joints.some(joint => joint.kind === 'propeller' && !joint.fixed);
    controlsToggle.disabled = !joints.some(joint => ['rudder', 'elevator', 'aileron'].includes(joint.kind) && !joint.fixed);
    element('brake-label').hidden = !joints.some(joint => joint.kind === 'diveBrake');
    gearToggle.disabled = !joints.some(joint => joint.kind === 'gear' && !joint.fixed);
    element('articulation-note').textContent = gearToggle.disabled
      ? 'Fixed landing gear. Control motion is a simplified pose preview.'
      : 'Simplified hinge motion for model inspection.';
    resetPose();
    resize();
    setView('quarter');
    setReady(true);
    message.hidden = true;
    status.textContent = `${entry.name} · Ready to inspect · LOD ${currentLOD}`;
    const url = new URL(window.location.href);
    url.searchParams.set('aircraft', entry.id);
    window.history.replaceState(null, '', url);
    needsRender = true;
  } catch (reason) {
    if (disposed || requestId !== thisRequest) return;
    if (model) {
      scene.remove(model);
      disposeModel(model);
      model = undefined;
    }
    error = reason instanceof Error ? reason.message : String(reason);
    setReady(false);
    status.textContent = 'Aircraft could not be loaded';
    showMessage('Aircraft unavailable', `Could not open ${entry.name}. Try again or choose another aircraft. ${error}`, true);
  }
}

async function loadCatalog(): Promise<void> {
  select.disabled = true;
  error = null;
  showMessage('Opening the aircraft collection', 'Loading the model catalog…');
  try {
    const response = await fetch('/models/aircraft/catalog.json', { signal: fetches.signal });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
    catalog = parseCatalog(await response.json());
    if (!catalog.length) throw new Error('No aircraft are registered in the collection yet.');
    if (disposed) return;
    select.replaceChildren();
    const nations = [...new Set(catalog.map(entry => entry.nation))].sort();
    for (const nation of nations) {
      const group = document.createElement('optgroup');
      group.label = nation;
      for (const entry of catalog.filter(candidate => candidate.nation === nation)) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        group.append(option);
      }
      select.append(group);
    }
    element('aircraft-count').textContent = `${catalog.length} models`;
    select.disabled = false;
    const preferred = new URL(window.location.href).searchParams.get('aircraft');
    await selectAircraft(catalog.some(entry => entry.id === preferred) ? preferred! : catalog[0].id);
  } catch (reason) {
    if (disposed) return;
    error = reason instanceof Error ? reason.message : String(reason);
    setReady(false);
    status.textContent = 'Collection unavailable';
    showMessage('Aircraft collection unavailable', `${error} Build the aircraft assets and try again.`, true);
  }
}

function frame(now: number): void {
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  if (document.hidden || !renderer || !orbit) return;
  const changed = orbit.update();
  const animated = ready && updatePose(delta);
  if (needsRender || changed || animated) {
    renderer.render(scene, camera);
    needsRender = false;
  }
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  requestId++;
  fetches.abort();
  listeners.abort();
  resizeObserver?.disconnect();
  renderer?.setAnimationLoop(null);
  orbit?.dispose();
  if (model) disposeModel(model);
  floor.geometry.dispose();
  floor.material.dispose();
  grid.dispose();
  sun.shadow.dispose();
  renderer?.dispose();
  renderer?.domElement.remove();
  delete window.aircraftReviewDiagnostics;
  delete window.aircraftReview;
}

try {
  renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Aircraft model: drag to orbit and scroll to zoom. Named view buttons provide keyboard camera controls.');
  renderer.domElement.setAttribute('aria-describedby', 'orbit-hint');
  renderer.domElement.tabIndex = 0;
  stage.append(renderer.domElement);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = false;
  orbit.enablePan = false;
  orbit.minZoom = 0.4;
  orbit.maxZoom = 6;
  orbit.addEventListener('start', () => {
    currentView = 'orbit';
    for (const button of viewButtons) button.setAttribute('aria-pressed', 'false');
  });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();
  setView('quarter');
  renderer.setAnimationLoop(frame);
  select.addEventListener('change', () => void selectAircraft(select.value), { signal: listeners.signal });
  detailSelect.addEventListener('change', () => { if (selected) void selectAircraft(selected.id, Number(detailSelect.value)); }, { signal: listeners.signal });
  for (const button of viewButtons) button.addEventListener('click', () => setView(button.dataset.view as View), { signal: listeners.signal });
  for (const toggle of [propellerToggle, controlsToggle, gearToggle, brakeToggle]) toggle.addEventListener('change', () => { manualPose = null; needsRender = true; }, { signal: listeners.signal });
  gridToggle.addEventListener('change', () => { grid.visible = gridToggle.checked; needsRender = true; }, { signal: listeners.signal });
  resetButton.addEventListener('click', () => { resetPose(); setView('quarter'); }, { signal: listeners.signal });
  retry.addEventListener('click', () => { void (selected ? selectAircraft(selected.id) : loadCatalog()); }, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => { needsRender = true; }, { signal: listeners.signal });
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { signal: listeners.signal });
  renderer.domElement.addEventListener('keydown', event => {
    if (!ready || !orbit) return;
    if (event.key === '+' || event.key === '=') camera.zoom = Math.min(orbit.maxZoom, camera.zoom * 1.15);
    else if (event.key === '-') camera.zoom = Math.max(orbit.minZoom, camera.zoom / 1.15);
    else if (event.key.toLowerCase() === 'r') { resetPose(); setView('quarter'); }
    else return;
    event.preventDefault();
    camera.updateProjectionMatrix();
    needsRender = true;
  }, { signal: listeners.signal });
  window.aircraftReviewDiagnostics = () => {
    scene.updateMatrixWorld(true);
    return {
      ready,
      error,
      aircraftId: selected?.id ?? null,
      count: catalog.length,
      modelUrl: currentModelUrl,
      lod: currentLOD,
      contentHash: model?.userData.contentHash ?? null,
      view: currentView,
      camera: { position: camera.position.toArray(), target: orbit?.target.toArray(), zoom: camera.zoom },
      bounds: model ? new Box3().setFromObject(model).getSize(new Vector3()).toArray() : null,
      render: renderer ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } : null,
      joints: joints.map(joint => ({ id: joint.id, kind: joint.kind, fixed: joint.fixed, rest: joint.rest.toArray(), quaternion: joint.object.quaternion.toArray(), position: joint.object.getWorldPosition(new Vector3()).toArray() })),
    };
  };
  window.aircraftReview = {
    select: selectAircraft,
    view: setView,
    pose: (pose: ReviewPose | null) => {
      resetPose();
      if (pose) manualPose = {
        propellerAngle: Number.isFinite(pose.propellerAngle) ? pose.propellerAngle : 0,
        controlsAngle: Math.max(-0.5, Math.min(0.5, Number.isFinite(pose.controlsAngle) ? pose.controlsAngle! : 0)),
        diveBrakeAngle: Math.max(0, Math.min(1, Number.isFinite(pose.diveBrakeAngle) ? pose.diveBrakeAngle! : 0)),
        gearFraction: Math.max(0, Math.min(1, Number.isFinite(pose.gearFraction) ? pose.gearFraction! : 0)),
      };
      needsRender = true;
    },
  };
  void loadCatalog();
} catch (reason) {
  error = reason instanceof Error ? reason.message : String(reason);
  setReady(false);
  status.textContent = '3D viewer unavailable';
  showMessage('The 3D viewer could not start', 'Enable hardware acceleration or open this page in a browser with WebGL 2 support.');
}

if (import.meta.hot) import.meta.hot.dispose(dispose);

declare global {
  interface Window {
    aircraftReviewDiagnostics?: () => unknown;
    aircraftReview?: { select: (id: string, lod?: number) => Promise<void>; view: (view: View) => void; pose: (pose: ReviewPose | null) => void };
  }
}

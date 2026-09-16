import * as THREE from 'three/webgpu';
import { WebGLRenderer } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { loadShipModel } from '../../src/game/loadShipModel';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import type { ConstructionResult, ConstructionSource, ShipDefinition } from '../../src/ships/blueprint';
import { ShipView } from '../../src/game/ShipView';
import { createDamage, type Combatant } from '../../src/simulation/damage';
import { createShipState } from '../../src/simulation/ship';
import { createMountState } from '../../src/simulation/weapons';
import { createTubeState } from '../../src/simulation/torpedoes';
import { gunTraverseAtFraction } from '../../src/ships/armament';
import { LocalBattleSession } from '../../src/game/session/LocalBattleSession';
import { registerLocalShip } from '../../src/ships/localShips';
import init, { ArticulationPreview } from '../../src/generated/naval-wasm/naval_wasm';

export type ReviewView = 'profile' | 'plan' | 'bow' | 'stern' | 'quarter';
type Pose = { train: number; elevation: number; recoil: number };
export interface ReviewInput { source: ConstructionSource; result: ConstructionResult; definition?: ShipDefinition; modelUrl?: string; }

export async function openReview(input: ReviewInput) {
  await init();
  const { source, result } = input;
  const definition = input.definition ?? result.definition;
  if (!definition || result.diagnostics.some(d => d.severity === 'error')) throw new Error('Resolve compile errors before rendering or trial.');
  const catalog = await loadConstructionCatalog(source.construction.catalogRevision);
  const model = input.modelUrl ? (await loadShipModel(input.modelUrl, false, definition.contentHash)).scene : await createConstructionModel(source, result);
  if (input.modelUrl && model.userData.definitionHash !== definition.contentHash) throw new Error('Published model/definition identity mismatch.');
  model.userData.definitionHash = definition.contentHash;
  const actor: Combatant = {
    motion: createShipState('construction-review'), mounts: definition.mounts.map(createMountState), damage: createDamage(definition),
    torpedoTubes: (definition.torpedoTubes ?? []).map(createTubeState),
    torpedoLaunchers: (definition.torpedoLaunchers ?? []).map(l => ({ id: l.id, train: source.construction.equipment.find(p => p.id === l.id)!.bearingDeg * Math.PI / 180 })),
  };
  const view = new ShipView(model, definition, actor);
  const scene = new THREE.Scene(); scene.add(view.root);
  scene.add(new THREE.HemisphereLight('#eef3f5', '#66625b', 2.4));
  const sun = new THREE.DirectionalLight('#fff3db', 3); sun.position.set(70, 100, -50); scene.add(sun);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 10000);
  const nodes = new Map<string, THREE.Object3D>();
  model.traverse(node => {
    const id = node.userData.nodeId;
    if (typeof id === 'string') {
      if (nodes.has(id)) throw new Error('Duplicate model node ID: ' + id);
      nodes.set(id, node);
    }
  });
  const resetPose = (neutral = false) => {
    actor.mounts.forEach((m, i) => Object.assign(m, { train: 0, elevation: neutral ? 0 : (definition.mounts[i].initialElevationDeg ?? 0) * Math.PI / 180, recoil: 0 }));
    actor.torpedoLaunchers?.forEach(l => { l.train = neutral ? 0 : (source.construction.equipment.find(e => e.id === l.id)?.bearingDeg ?? 0) * Math.PI / 180; });
    view.snap(); view.updateRenderMatrices();
  };
  const focus = (id?: string, isolate = false) => {
    model.traverse(node => { node.visible = true; });
    if (!id) return model;
    const target = nodes.get(id) ?? model.getObjectByName(id);
    if (!target) throw new Error('Unknown assembly or node: ' + id);
    if (isolate) {
      const related = new Set<THREE.Object3D>();
      target.traverse(n => related.add(n));
      for (let n: THREE.Object3D | null = target; n; n = n.parent) related.add(n);
      model.traverse(node => { if (node instanceof THREE.Mesh) node.visible = related.has(node); });
    }
    return target;
  };
  const render = async (name: ReviewView = 'quarter', options: { id?: string; isolate?: boolean; width?: number; height?: number; transparent?: boolean; keepPose?: boolean } = {}) => {
    if (!options.keepPose) resetPose();
    const target = focus(options.id, options.isolate);
    view.updateRenderMatrices(); model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(target), center = bounds.getCenter(new THREE.Vector3());
    if (bounds.isEmpty()) throw new Error('Selected assembly has no renderable geometry.');
    const [width, height] = [options.width ?? (['profile', 'plan'].includes(name) ? 1600 : name === 'quarter' ? 1400 : 800), options.height ?? (['profile', 'plan'].includes(name) ? 520 : name === 'quarter' ? 900 : 800)];
    const directions = { profile: [1, 0, 0], plan: [0, 1, 0], bow: [0, 0, -1], stern: [0, 0, 1], quarter: [1, .6, -1] } as const;
    const radius = Math.max(5, bounds.getSize(new THREE.Vector3()).length());
    camera.position.copy(center).addScaledVector(new THREE.Vector3(...directions[name]).normalize(), radius * 2);
    camera.up.set(name === 'plan' ? 1 : 0, name === 'plan' ? 0 : 1, 0);
    camera.lookAt(center); camera.updateMatrixWorld(true);
    const extents = new THREE.Box3();
    for (let c = 0; c < 8; c++) extents.expandByPoint(new THREE.Vector3(c & 1 ? bounds.max.x : bounds.min.x, c & 2 ? bounds.max.y : bounds.min.y, c & 4 ? bounds.max.z : bounds.min.z).applyMatrix4(camera.matrixWorldInverse));
    const size = extents.getSize(new THREE.Vector3()), aspect = width / height;
    const halfHeight = Math.max(size.y, size.x / aspect, .2) * .55;
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.far = radius * 6; camera.updateProjectionMatrix();
    renderer.setSize(width, height); renderer.setClearColor('#353b3f', options.transparent ? 0 : 1);
    renderer.render(scene, camera);
    return { png: renderer.domElement.toDataURL('image/png'), camera: { name, position: camera.position.toArray(), target: center.toArray(), up: camera.up.toArray(), projection: 'orthographic', width, height, halfHeight, sourceRevision: source.revision, contentHash: definition.contentHash } };
  };
  const articulation = new ArticulationPreview(JSON.stringify(definition));
  const pose = (requested: Pose[]) => {
    const current = actor.mounts.map(({ train, elevation, recoil }) => ({ train, elevation, recoil }));
    const resolved: { pose: Pose; blocked: boolean; obstructionId?: string }[] = JSON.parse(articulation.resolve(JSON.stringify(current), JSON.stringify(requested)));
    view.capturePreviousPose(); resolved.forEach((r, i) => Object.assign(actor.mounts[i], r.pose));
    let maxMuzzleErrorM = 0;
    for (const alpha of [0, .25, .5, .75, 1]) { view.update(alpha); view.updateRenderMatrices(); maxMuzzleErrorM = Math.max(maxMuzzleErrorM, ...view.muzzleErrors(), ...view.torpedoMuzzleErrors()); }
    return { resolved, maxMuzzleErrorM };
  };
  const poseTorpedoes = (trains: Record<string, number>) => {
    for (const [id, degrees] of Object.entries(trains)) {
      const launcher = definition.torpedoLaunchers?.find(l => l.id === id);
      const state = actor.torpedoLaunchers?.find(l => l.id === id);
      const [lo, hi] = launcher?.traverseLimitsDeg ?? [-180, 180];
      if (!launcher || !state || !Number.isFinite(degrees) || degrees < lo || degrees > hi) throw new Error('Invalid torpedo review pose: ' + id);
      state.train = degrees * Math.PI / 180;
    }
    view.snap(); view.updateRenderMatrices();
    return { maxMuzzleErrorM: Math.max(0, ...view.torpedoMuzzleErrors()) };
  };
  const sweep = () => {
    resetPose();
    const blocked: { sample: number; id: string; obstructionId?: string }[] = [];
    let samples = 0, maxMuzzleErrorM = 0;
    // Endpoint and intermediate samples, full recoil, independently posed neighbors.
    for (const neighbor of [false, true]) {
      resetPose();
      for (const train of [-1, -.5, 0, .5, 1]) for (const elevation of [0, .25, .5, .75, 1]) for (const recoil of [0, .5, 1]) {
      const requested = definition.mounts.map((mount, i) => ({
        train: gunTraverseAtFraction(mount, neighbor && i % 2 ? -train : train),
        elevation: (mount.weapon.elevationMinDeg + (mount.weapon.elevationMaxDeg - mount.weapon.elevationMinDeg) * (neighbor && i % 2 ? 1 - elevation : elevation)) * Math.PI / 180,
        recoil: neighbor && i % 2 ? 1 - recoil : recoil,
      }));
      const step = pose(requested); samples++;
      maxMuzzleErrorM = Math.max(maxMuzzleErrorM, step.maxMuzzleErrorM);
      step.resolved.forEach((r, i) => { if (r.blocked) blocked.push({ sample: samples, id: definition.mounts[i].id, obstructionId: r.obstructionId }); });
    }
    }
    let torpedoSamples = 0;
    if (definition.torpedoLaunchers?.length) for (const fraction of [0, .25, .5, .75, 1]) {
      const trains = Object.fromEntries(definition.torpedoLaunchers.map((l, i) => {
        const [lo, hi] = l.traverseLimitsDeg ?? [-180, 180];
        return [l.id, lo + (hi - lo) * (i % 2 ? 1 - fraction : fraction)];
      }));
      maxMuzzleErrorM = Math.max(maxMuzzleErrorM, poseTorpedoes(trains).maxMuzzleErrorM); torpedoSamples++;
    }
    resetPose();
    return { samples, torpedoSamples, maxMuzzleErrorM, blocked, scope: 'Sampled native gun clearance resolution and CPU/render muzzle agreement; blocked gun travel and torpedo bank clearance require visual installation review, and this is not an exhaustive geometric proof.' };
  };
  const exportGlb = async () => {
    // Retained joints export at their canonical neutral transforms; previews and
    // simulation apply the separately declared installation resting elevation.
    resetPose(true); focus();
    const exported = model.clone(true);
    exported.traverse(node => { delete node.userData.constructionSurfaces; });
    const exportScene = new THREE.Scene();
    exportScene.userData = { definitionHash: definition.contentHash, constructionRevision: source.revision };
    exportScene.add(exported);
    const bytes = await new GLTFExporter().parseAsync(exportScene, { binary: true, onlyVisible: false, trs: true }) as ArrayBuffer;
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(blob); });
  };
  const trial = async (seconds = 10) => {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120) throw new Error('Trial duration must be 1–120 simulated seconds.');
    const started = performance.now();
    const revision = registerLocalShip(source, result);
    const session = await LocalBattleSession.create({ playerShipId: revision.definition.id, friendlyBots: [], enemies: [{ shipId: 'liberty-cargo', aiLevel: 'static' }], mapId: 'north-atlantic', windSpeed: 0, spawnDistance: 2500 }, { revisions: [revision], trial: true });
    try {
      const loaded = performance.now();
      const deadline = performance.now() + 120_000;
      const start = { tick: session.tick, ammo: session.player.mounts.map(m => m.ammo), integrity: session.player.damage.integrity };
      while (session.tick < seconds * 60 && session.result === 'active') {
        if (performance.now() > deadline) throw new Error('Trial worker exceeded two minutes.');
        const target = session.target?.motion;
        session.advance(.1, { throttle: .7, rudder: .2 }, { aim: [target?.x ?? 0, 2, target?.z ?? -1250], fire: true, battery: 'main' });
        await new Promise(resolve => setTimeout(resolve, 5));
        session.advance(0, { throttle: .7, rudder: .2 }, { aim: [target?.x ?? 0, 2, target?.z ?? -1250], fire: true, battery: 'main' });
      }
      const sailed = { tick: session.tick, result: session.result, motion: { ...session.ship }, ammo: session.player.mounts.map(m => m.ammo), integrity: session.player.damage.integrity };
      const sailedAt = performance.now();
      await session.resetTrial();
      return { sourceId: source.id, revision: source.revision, contentHash: result.contentHash, timingsMs: { load: loaded - started, sailing: sailedAt - loaded, reset: performance.now() - sailedAt }, start, sailed, reset: { tick: session.tick, ammo: session.player.mounts.map(m => m.ammo), integrity: session.player.damage.integrity } };
    } finally { session.dispose(); }
  };
  const inspect = () => ({
    sourceId: source.id, revision: source.revision, contentHash: definition.contentHash, published: !!input.modelUrl,
    bounds: new THREE.Box3().setFromObject(model), loading: result.loading, diagnostics: result.diagnostics,
    assemblies: source.construction.equipment.map(p => ({ ...p, sockets: catalog.equipment.find(c => c.id === p.partId)?.sockets })),
    nodes: [...nodes.keys()],
  });
  await render();
  return { render, pose, poseTorpedoes, sweep, exportGlb, trial, inspect, dispose() { articulation.free(); renderer.dispose(); disposeConstructionModel(model); renderer.domElement.remove(); } };
}

declare global {
  interface Window {
    constructionReviewInput?: ReviewInput;
    constructionReviewModule?: { openReview: typeof openReview };
    constructionReview?: Awaited<ReturnType<typeof openReview>>;
  }
}

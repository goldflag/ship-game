import * as THREE from 'three/webgpu';
import { createReviewCanvas, createReviewPresentation } from './presentation';
import { createViewStage } from './viewStage';
import { exportReviewGlb } from './export';
import { resetReviewPose } from './pose';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { loadShipModel } from '../../src/game/loadShipModel';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import type { ConstructionResult, ConstructionSource, ShipDefinition } from '../../src/ships/blueprint';
import { ShipView } from '../../src/game/ShipView';
import { createDamage, type Combatant } from '../../src/simulation/damage';
import { createShipState } from '../../src/game/session/motion';
import { createDepthChargeLauncherState } from '../../src/simulation/depthCharges';
import { createMountState } from '../../src/simulation/weapons';
import { createTubeState } from '../../src/game/torpedoAim';
import { gunTraverseAtFraction } from '../../src/ships/armament';
import { LocalBattleSession } from '../../src/game/session/LocalBattleSession';
import { registerLocalShip } from '../../src/ships/localShips';
import init, { ArticulationPreview } from '../../src/generated/naval-wasm/naval_wasm';

export type ReviewView = 'profile' | 'plan' | 'bow' | 'stern' | 'quarter';
type Pose = { train: number; elevation: number; recoil: number };
/** `draft` lets `ship:view` open a design whose compile has errors: only `view` works then, and it draws the editor's source preview. */
export interface ReviewInput { source: ConstructionSource; result: ConstructionResult; definition?: ShipDefinition; modelUrl?: string; draft?: boolean; }

export async function openReview(input: ReviewInput) {
  await init();
  const { source, result } = input;
  const definition = input.definition ?? result.definition;
  const refuse = (): never => { throw new Error('Resolve compile errors before rendering or trial.'); };
  if (!definition || result.diagnostics.some(d => d.severity === 'error')) {
    if (!input.draft) refuse();
    const canvas = createReviewCanvas(), stage = createViewStage(source, result, await loadConstructionCatalog(source.construction.catalogRevision), canvas);
    return { render: refuse, pose: refuse, poseTorpedoes: refuse, sweep: refuse, exportGlb: refuse, trial: refuse, inspect: refuse, view: stage.render, fallback: true, dispose() { stage.dispose(); canvas.dispose(); } } as unknown as CompiledReview;
  }
  return openCompiledReview(input, definition);
}
type CompiledReview = Awaited<ReturnType<typeof openCompiledReview>>;
async function openCompiledReview(input: ReviewInput, definition: ShipDefinition) {
  const { source, result } = input;
  const catalog = await loadConstructionCatalog(source.construction.catalogRevision);
  const model = input.modelUrl ? (await loadShipModel(input.modelUrl, false, definition.contentHash)).scene : await createConstructionModel(source, result);
  if (input.modelUrl && model.userData.definitionHash !== definition.contentHash) throw new Error('Published model/definition identity mismatch.');
  model.userData.definitionHash = definition.contentHash;
  const actor: Combatant = {
    motion: createShipState('construction-review'), mounts: definition.mounts.map(createMountState), damage: createDamage(definition),
    depthChargeLaunchers: (definition.depthChargeLaunchers ?? []).map(createDepthChargeLauncherState),
    torpedoTubes: (definition.torpedoTubes ?? []).map(createTubeState),
    torpedoLaunchers: (definition.torpedoLaunchers ?? []).map(l => ({ id: l.id, train: source.construction.equipment.find(p => p.id === l.id)!.bearingDeg * Math.PI / 180 })),
  };
  const view = new ShipView(model, definition, actor);
  const nodes = new Map<string, THREE.Object3D>();
  model.traverse(node => {
    const id = node.userData.nodeId;
    if (typeof id === 'string') {
      if (nodes.has(id)) throw new Error('Duplicate model node ID: ' + id);
      nodes.set(id, node);
    }
  });
  const resetPose = (neutral = false) => resetReviewPose(actor, definition, source, view, neutral);
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
  const canvas = createReviewCanvas();
  const presentation = createReviewPresentation(view, model, source, definition, resetPose, focus, canvas);
  const stage = input.modelUrl ? undefined : createViewStage(source, result, catalog, canvas, { root: view.root, model, resetPose });
  const { render } = presentation;
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
  const exportGlb = () => exportReviewGlb(model, view, actor, definition, source);
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
  const viewUnavailable = (): never => { throw new Error('ship:view draws the source design, not a published model.'); };
  return { render, pose, poseTorpedoes, sweep, exportGlb, trial, inspect, view: stage?.render ?? viewUnavailable as never, fallback: false, dispose() { articulation.free(); stage?.dispose(); presentation.dispose(); disposeConstructionModel(model); } };
}

declare global {
  interface Window {
    constructionReviewInput?: ReviewInput;
    constructionReviewModule?: { openReview: typeof openReview };
    constructionReview?: Awaited<ReturnType<typeof openReview>>;
  }
}

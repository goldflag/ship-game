import * as THREE from 'three/webgpu';
import { ShipView } from '../../src/game/ShipView';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import type { ConstructionResult, ConstructionSource, Vec3 } from '../../src/ships/blueprint';
import type { Combatant } from '../../src/simulation/damage';
import { createDamage } from '../../src/simulation/damage';
import { createShipState } from '../../src/simulation/ship';
import { createMountState } from '../../src/simulation/weapons';
import { createTubeState } from '../../src/simulation/torpedoes';
import init, { compile_construction, preview_articulation_json } from '../../src/generated/naval-wasm/naval_wasm';
import { equipmentReviewSource } from './construction-model-fixtures';
import { equipmentCombatSource } from './construction-model-fixtures';
import { LocalBattleSession } from '../../src/game/session/LocalBattleSession';
import { registerLocalShip } from '../../src/ships/localShips';
import type { CombatIntent } from '../../src/simulation/combat';

type Pose = { train: number; elevation: number; recoil: number };
type NativePose = { pose: Pose; blocked: boolean; obstructionId?: string };
export type NativeMuzzleCase = { motion: { x: number; y: number; z: number; heading: number; roll: number; pitch: number }; poses: Pose[]; launcherTrains?: Record<string, number>; muzzles: { id: string; position: Vec3 }[] };

/** Invoke from a blank same-origin browser page. Uses production composition and ShipView,
 * full published meshes/materials, and the real WASM compiler/clearance resolver. */
export async function constructionModelReview(kind: 'collection' | 'neighbors' | 'patrol' = 'collection', input?: ConstructionSource) {
  const catalog = await loadConstructionCatalog(); await init();
  const source = input ?? equipmentReviewSource(catalog, kind);
  const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
  if (!result.definition) throw new Error(JSON.stringify(result.diagnostics));
  const definition = result.definition;
  const actor: Combatant = {
    motion: createShipState('equipment-review'), mounts: definition.mounts.map(createMountState), damage: createDamage(definition),
    torpedoTubes: (definition.torpedoTubes ?? []).map(createTubeState),
    torpedoLaunchers: (definition.torpedoLaunchers ?? []).map(l => ({ id: l.id, train: source.construction.equipment.find(p => p.id === l.id)!.bearingDeg * Math.PI / 180 })),
  };
  const model = await createConstructionModel(source, result);
  const view = new ShipView(model, definition, actor);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#17242c'); scene.add(view.root);
  scene.add(new THREE.HemisphereLight('#d8e8f6', '#56616a', 2.7));
  const sun = new THREE.DirectionalLight('#fff0d2', 3); sun.position.set(60, 100, -70); scene.add(sun);
  const grid = new THREE.GridHelper(260, 52, '#728591', '#354651'); grid.position.y = -10.01; scene.add(grid);
  const camera = new THREE.PerspectiveCamera(35, 1000 / 760, .05, 5000);
  const renderer = new THREE.WebGPURenderer({ antialias: true }); await renderer.init();
  renderer.setPixelRatio(1); renderer.setSize(1000, 760);
  const host = document.createElement('div'); host.dataset.constructionReview = kind; host.style.cssText = 'position:fixed;inset:0;background:#17242c;overflow:auto;z-index:9999';
  const label = document.createElement('div'); label.style.cssText = 'font:14px monospace;padding:10px;color:white';
  label.textContent = `${source.name} · ${result.contentHash}`; host.append(label, renderer.domElement); document.body.append(host);
  const nodes = new Map<string, THREE.Object3D>();
  model.traverse(n => { if (n.userData.nodeId) { if (nodes.has(n.userData.nodeId)) throw new Error(`Duplicate installed node ${n.userData.nodeId}`); nodes.set(n.userData.nodeId, n); } });
  const render = async () => { view.updateRenderMatrices(); await renderer.renderAsync(scene, camera); };
  const focus = async (id?: string, angle: 'quarter' | 'side' | 'top' | 'under' = 'quarter') => {
    const target = id ? model.children.find(n => n.name === id) : model;
    if (!target) throw new Error(`Unknown installation ${id}`);
    view.updateRenderMatrices();
    const bounds = new THREE.Box3().setFromObject(target), center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()), radius = Math.max(...size.toArray(), 2);
    const offset = { quarter: [1.1, .75, 1.2], side: [1.65, .12, 0], top: [.001, 1.75, .001], under: [.85, -.6, 1.25] }[angle];
    camera.position.copy(center).add(new THREE.Vector3(...offset).multiplyScalar(radius)); camera.up.set(0, 1, 0); camera.lookAt(center); camera.updateMatrixWorld();
    await render();
    return renderer.domElement.toDataURL('image/png');
  };
  const pose = async (requested: Pose[], motion?: Partial<Combatant['motion']>) => {
    const current = actor.mounts.map(({ train, elevation, recoil }) => ({ train, elevation, recoil }));
    const resolved: NativePose[] = JSON.parse(preview_articulation_json(JSON.stringify(definition), JSON.stringify(current), JSON.stringify(requested)));
    view.capturePreviousPose(); resolved.forEach((r, i) => Object.assign(actor.mounts[i], r.pose));
    if (motion) Object.assign(actor.motion, motion);
    let maxCpuMuzzleErrorM = 0, maxTorpedoMuzzleErrorM = 0;
    for (const alpha of [0, .23, .61, 1]) {
      view.update(alpha); view.updateRenderMatrices();
      maxCpuMuzzleErrorM = Math.max(maxCpuMuzzleErrorM, ...view.muzzleErrors());
      maxTorpedoMuzzleErrorM = Math.max(maxTorpedoMuzzleErrorM, ...view.torpedoMuzzleErrors());
    }
    await render();
    return { maxCpuMuzzleErrorM, maxTorpedoMuzzleErrorM, resolved };
  };
  const compareNative = async (cases: NativeMuzzleCase[]) => {
    let maxErrorM = 0; const failures: { id: string; errorM: number }[] = [];
    for (const c of cases) {
      c.poses.forEach((p, i) => Object.assign(actor.mounts[i], p)); Object.assign(actor.motion, c.motion);
      actor.torpedoLaunchers?.forEach(l => { if (c.launcherTrains?.[l.id] !== undefined) l.train = c.launcherTrains[l.id]; });
      view.snap(); view.updateRenderMatrices();
      // ShipPoseMatrices prepares draw surfaces; retained static sockets need the full query pass.
      view.root.updateMatrixWorld(true);
      for (const expected of c.muzzles) {
        const node = nodes.get(expected.id); if (!node) throw new Error(`Missing native muzzle ${expected.id}`);
        const errorM = node.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...expected.position));
        maxErrorM = Math.max(maxErrorM, errorM); if (errorM > .025) failures.push({ id: expected.id, errorM });
      }
    }
    await render(); return { cases: cases.length, maxErrorM, failures };
  };
  const sweep = async () => {
    const checks = [];
    for (const f of [-1, -.61, -.23, .19, .57, 1]) {
      const requested = definition.mounts.map((m, i) => ({ train: f * (i % 2 ? -1 : 1) * m.weapon.traverseDeg * Math.PI / 180,
        elevation: (m.weapon.elevationMinDeg + (m.weapon.elevationMaxDeg - m.weapon.elevationMinDeg) * (i % 2 ? .37 : .71)) * Math.PI / 180,
        recoil: i % 2 ? .2 : .85 }));
      actor.torpedoLaunchers?.forEach((l, i) => { l.train = f * (i % 2 ? -1 : 1) * 1.2; });
      checks.push(await pose(requested, { x: 53, y: -.6, z: -72, heading: .41, roll: -.06, pitch: .035, distance: f * 8, speed: 4, rudder: f }));
    }
    return { checks, maxCpuMuzzleErrorM: Math.max(...checks.map(c => c.maxCpuMuzzleErrorM)), maxTorpedoMuzzleErrorM: Math.max(...checks.map(c => c.maxTorpedoMuzzleErrorM)), definitionHash: result.contentHash };
  };
  const attachments = () => {
    view.updateRenderMatrices(); view.root.updateMatrixWorld(true);
    const hulls = model.children.filter((n): n is THREE.Mesh => n instanceof THREE.Mesh);
    return source.construction.equipment.map(instance => {
      const part = catalog.equipment.find(p => p.id === instance.partId)!;
      const socket = part.sockets?.find(s => s.id === 'attachment');
      if (!socket) throw new Error(`Missing support metadata ${instance.id}`);
      const installation = model.children.find(n => n.name === instance.id)!;
      const seat = installation.localToWorld(new THREE.Vector3(...socket.position));
      const direction = new THREE.Vector3(...socket.direction).transformDirection(installation.matrixWorld);
      let candidates = 0, contactVertices = 0, minimumGapM = Infinity;
      const ray = new THREE.Raycaster();
      installation.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        for (let i = 0; i < node.geometry.attributes.position.count; i++) {
          const point = node.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(node.matrixWorld);
          if (Math.abs(point.clone().sub(seat).dot(direction)) > .002) continue;
          candidates++;
          ray.set(point.clone().addScaledVector(direction, -.03), direction); ray.far = .08;
          const hit = ray.intersectObjects(hulls, false)[0];
          if (!hit) continue;
          const gap = Math.abs(hit.distance - .03); minimumGapM = Math.min(minimumGapM, gap);
          // Machinery sits on inward shell plating; exterior rendering is its outer face.
          if (gap <= (part.placement === 'internal' ? .02 : .003)) contactVertices++;
        }
      });
      return { id: instance.id, candidates, contactVertices, minimumGapM: Number.isFinite(minimumGapM) ? minimumGapM : null };
    });
  };
  const independence = () => {
    const duplicates = source.construction.equipment.filter((p, i, all) => all.findIndex(q => q.partId === p.partId) !== i);
    const checks = duplicates.filter(p => nodes.has(`${p.id}.yaw`)).map(p => {
      const first = source.construction.equipment.find(q => q.partId === p.partId)!;
      const a = nodes.get(`${first.id}.yaw`)!, b = nodes.get(`${p.id}.yaw`)!;
      const before = b.quaternion.toArray(); const saved = a.quaternion.clone();
      a.rotateY(.2); const independent = a !== b && before.every((v, i) => v === b.quaternion.toArray()[i]); a.quaternion.copy(saved);
      if (!independent) throw new Error(`Shared mutable joint ${first.id}/${p.id}`);
      return [first.id, p.id];
    });
    return { independentPairs: checks };
  };
  const report = { source, result, componentCount: source.construction.equipment.length, nodeCount: nodes.size, modelHash: model.userData.definitionHash };
  await focus();
  return { ...report, actor, view, model, nodes, renderer, focus, pose, sweep, compareNative, attachments, independence,
    dispose() { renderer.dispose(); disposeConstructionModel(model); host.remove(); } };
}

/** Real local worker/WASM admission, native combat snapshots and trial lifecycle. */
export async function constructionRuntimeReview(enemy = 'liberty-cargo', trial = true, spawnDistance = 2500) {
  const catalog = await loadConstructionCatalog(); await init();
  const source = equipmentCombatSource(catalog);
  const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
  if (!result.definition) throw new Error(JSON.stringify(result.diagnostics));
  const revision = registerLocalShip(source, result);
  const session = await LocalBattleSession.create({ playerShipId: revision.definition.id, friendlyBots: [], enemies: [enemy], mapId: 'north-atlantic', weather: 'map', windSpeed: 0, spawnDistance }, { revisions: [revision], trial });
  const model = await createConstructionModel(source, result);
  const view = new ShipView(model, revision.definition, session.player);
  const events = new Map<number, typeof session.events[number]>();
  const samples: unknown[] = [];
  let maxGunMuzzleErrorM = 0, maxTorpedoMuzzleErrorM = 0;
  const advance = async (seconds: number, battery: CombatIntent['battery'] = 'main', fire = true, throttle = .5, aimOverride?: Vec3) => {
    const until = session.tick + Math.round(seconds * 60), deadline = performance.now() + 90_000;
    while (session.tick < until && session.result === 'active') {
      if (performance.now() > deadline) throw new Error('Native trial did not advance within 90 seconds');
      const target = session.target?.motion ?? { x: 0, z: -1250, y: 0 };
      const aim: Vec3 = aimOverride ?? [target.x, target.y + 2, target.z];
      session.advance(.1, { throttle, rudder: .2 }, { aim, fire, battery }, () => view.capturePreviousPose());
      await new Promise(resolve => setTimeout(resolve, 10));
      session.advance(0, { throttle, rudder: .2 }, { aim, fire, battery }, () => view.capturePreviousPose());
      view.update(1); view.updateRenderMatrices();
      maxGunMuzzleErrorM = Math.max(maxGunMuzzleErrorM, ...view.muzzleErrors());
      maxTorpedoMuzzleErrorM = Math.max(maxTorpedoMuzzleErrorM, ...view.torpedoMuzzleErrors());
      for (const event of session.events) events.set(event.sequence, event);
    }
    const telemetry = session.telemetry(battery, [session.target?.motion.x ?? 0, 0, session.target?.motion.z ?? -1250]);
    const sample = { tick: session.tick, result: session.result, status: session.connectionStatus, motion: { ...session.ship }, telemetry,
      mounts: session.player.mounts.map(m => ({ id: m.id, train: m.train, elevation: m.elevation, recoil: m.recoil, ammo: m.ammo, status: m.status })),
      events: [...events.values()], maxGunMuzzleErrorM, maxTorpedoMuzzleErrorM, aircraft: session.aircraft.length };
    samples.push(sample); return sample;
  };
  return { source, result, session, view, model, samples, advance, events,
    async reset() { await session.resetTrial(); view.snap(); return { tick: session.tick, damage: session.player.damage.integrity, sourceRevision: source.revision }; },
    dispose() { session.dispose(); disposeConstructionModel(model); } };
}

import { beforeAll, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import * as THREE from 'three/webgpu';
import init, { compile_construction, preview_articulation_json } from '../../src/generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import { barrelIds } from '../../src/ships/blueprint';
import type { ConstructionCatalog, ConstructionResult, ShipDefinition } from '../../src/ships/blueprint';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { ShipView } from '../../src/game/ShipView';
import { ShipMaterialPalette } from '../../src/game/ShipMaterialPalette';
import { batchShipModel } from '../../src/game/ShipBatching';
import { prepareShipDetail } from '../../src/game/ShipDetail';
import { ShipRenderAssemblies } from '../../src/game/ShipRenderAssemblies';
import { FleetShipDraws } from '../../src/game/FleetShipDraws';
import { createDamage, type Combatant } from '../../src/simulation/damage';
import { createShipState } from '../../src/game/session/motion';
import { createMountState } from '../../src/simulation/weapons';
import { createTubeState } from '../../src/game/torpedoAim';
import { cruiserEquipmentFixture, deckFittingsFixture, equipmentReviewSource } from './construction-model-fixtures';
import { nativeConstructionMuzzles } from './construction-model-native';
import { installedSupportContacts } from './construction-model-support';

const root = resolve(import.meta.dir, '../..'), catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => { await init({ module_or_path: await Bun.file(resolve(root, 'src/generated/naval-wasm/naval_wasm_bg.wasm')).arrayBuffer() }); });
const compile = (source: ReturnType<typeof equipmentReviewSource>): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
const actorFor = (definition: ShipDefinition): Combatant => ({ motion: createShipState('review'), mounts: definition.mounts.map(createMountState), damage: createDamage(definition),
  torpedoTubes: (definition.torpedoTubes ?? []).map(createTubeState),
  torpedoLaunchers: (definition.torpedoLaunchers ?? []).map(l => ({ id: l.id, train: definition.construction!.equipment.find(p => p.id === l.id)!.bearingDeg * Math.PI / 180 })) });
async function published<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async input => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://equipment.test').pathname;
    if (!path.startsWith('/models/components/') || path.includes('..')) throw new Error(`Non-production review request ${path}`);
    const file = Bun.file(resolve(root, 'public', path.slice(1)));
    return new Response(await file.arrayBuffer(), { status: await file.exists() ? 200 : 404 });
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('every published part has a supported fixture while weapons retain canonical stocks and tube identities', () => {
  const source = equipmentReviewSource(catalog), result = compile(source);
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(result.definition!.mounts).toHaveLength(8);
  expect(result.definition!.torpedoTubes).toHaveLength(10);
  const fittings = deckFittingsFixture(catalog), cruiser = cruiserEquipmentFixture(catalog);
  expect(compile(cruiser).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  const fitted = [...source.construction.equipment, ...fittings.construction.equipment, ...cruiser.construction.equipment];
  expect(compile(fittings).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect([...new Set(fitted.map(p => p.partId))].sort()).toEqual(catalog.equipment.map(p => p.id).sort());
  expect(result.definition!.torpedoTubes!.map(t => t.id)).toEqual(['torpedo-a', 'torpedo-b'].flatMap(id => Array.from({ length: 5 }, (_, i) => `${id}.tube-${i + 1}`)));
  const tooSmall = structuredClone(source);
  tooSmall.construction.equipment.find(p => p.id === 'aa-a-magazine')!.partId = 'generic-magazine-1000';
  expect(compile(tooSmall).diagnostics.some(d => d.code === 'magazine-capacity' && d.sourceId === 'aa-a-magazine')).toBe(true);
});

test('published deck fittings retain physical support, native loading and static searchlight behavior', async () => {
  const source = deckFittingsFixture(catalog), result = compile(source), definition = result.definition!;
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(definition.mounts).toEqual([]); expect(definition.torpedoTubes ?? []).toEqual([]);
  expect(definition.modules.map(m => [m.id, m.kind])).toEqual([['review-optical-rangefinder', 'fire-control']]);
  for (const instance of source.construction.equipment) {
    const part = catalog.equipment.find(p => p.id === instance.partId)!;
    const mass = definition.loading!.contributions.find(m => m.id === instance.id)!;
    expect(mass.kind).toBe('equipment');
    if (part.path) {
      expect(mass.massKg).toBeGreaterThan(part.massKg!);
      expect(definition.obstructions.some(o => o.id === instance.id)).toBe(false);
    } else expect(mass.massKg).toBe(part.massKg!);
  }
  await published(async () => {
    const model = await createConstructionModel(source, result, new AbortController().signal);
    try {
      const fixed = structuredClone(source);
      fixed.construction.equipment = fixed.construction.equipment.filter(e => !catalog.equipment.find(p => p.id === e.partId)!.path);
      for (const contact of installedSupportContacts(model, fixed, catalog)) {
        expect(contact.candidates, contact.id).toBeGreaterThan(0);
        expect(contact.contactVertices, contact.id).toBeGreaterThan(0);
      }
      for (const instance of source.construction.equipment.filter(e => e.path)) {
        const installed = model.children.find(n => n.userData.sourceId === instance.id)!;
        expect(installed, instance.id).toBeDefined();
        const meshes: THREE.InstancedMesh[] = [];
        installed.traverse(n => { if (n instanceof THREE.InstancedMesh) meshes.push(n); });
        expect(meshes.length, instance.id).toBeGreaterThan(0);
        expect(meshes.reduce((count, mesh) => count + mesh.count, 0), instance.id).toBeGreaterThan(1);
      }
      const searchlight = model.children.find(n => n.name === 'review-static-searchlight')!;
      let lightCount = 0;
      searchlight.traverse(node => {
        if (node instanceof THREE.Light) lightCount++;
        if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if ('emissive' in material) expect((material.emissive as THREE.Color).getHex()).toBe(0);
        }
      });
      expect(lightCount).toBe(0);
    } finally { disposeConstructionModel(model); }
  });
});

test('fleet rendering preserves every connected path instance through ship preparation, motion and inspection', async () => {
  const source = deckFittingsFixture(catalog), result = compile(source), definition = result.definition!;
  await published(async () => {
    const model = await createConstructionModel(source, result, new AbortController().signal);
    const palette = new ShipMaterialPalette(), assemblies = new ShipRenderAssemblies();
    // Match Game's template preparation before it clones a model for each actor.
    palette.apply(model); batchShipModel(model); await prepareShipDetail(model);
    const views = [0, 1].map(index => {
      const actor = actorFor(definition); actor.motion.id = `path-review-${index}`;
      return new ShipView(model.clone(true), definition, actor);
    });
    const instances = views.flatMap(view => view.renderMeshes.flatMap(({ mesh }) => mesh instanceof THREE.InstancedMesh ? [{ view, mesh, matrices: mesh.instanceMatrix.array.slice() }] : []));
    let draws: FleetShipDraws | undefined;
    try {
      expect(instances).toHaveLength(8); // Rails, feet, rope and chain on each hull.
      for (const view of views) {
        const rendered = assemblies.build(view);
        for (const { mesh } of instances.filter(instance => instance.view === view)) {
          const assembly = rendered.find(draw => draw.members.some(member => member.mesh === mesh))!;
          // Joining only an instanced surface's base geometry erases its route.
          expect(assembly.mesh.uuid).toBe(mesh.uuid); expect(assembly.owner?.uuid).toBeUndefined(); expect(assembly.members).toHaveLength(1);
        }
      }
      draws = new FleetShipDraws(views);
      for (const inspecting of [false, true, false]) {
        for (const [index, view] of views.entries()) {
          Object.assign(view.actor.motion, { x: 37 + index * 100, y: -.6, z: -72, heading: .41 + index, roll: -.06, pitch: .035 });
          view.snap(); view.updateRenderMatrices(); view.inspect(inspecting);
        }
        draws.update();
        expect(draws.diagnostics().instances > 0).toBe(!inspecting);
        for (const { view, mesh, matrices } of instances) {
          expect(view.model.visible).toBe(true); expect(mesh.layers.mask).toBe(1);
          expect(mesh.instanceMatrix.array).toEqual(matrices);
          expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBe(inspecting ? .16 : 1);
          // The last route member must retain its authored position under the
          // same hull pose used for all other ship surfaces.
          const local = new THREE.Matrix4(), actual = new THREE.Matrix4();
          mesh.getMatrixAt(mesh.count - 1, local); actual.multiplyMatrices(mesh.matrixWorld, local);
          view.root.updateMatrixWorld(true);
          const expected = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, local);
          expect(actual.elements.every((value, i) => Math.abs(value - expected.elements[i]) < 1e-6)).toBe(true);
        }
      }
    } finally {
      draws?.dispose(); assemblies.dispose();
      for (const view of views) { view.impactMarks.dispose(); disposeConstructionModel(view.model); }
      disposeConstructionModel(model);
      for (const material of palette.sharedMaterials()) material.dispose();
    }
  });
});

test('full production GLBs preserve repeated gun and tube world muzzles against native Rust poses', async () => {
  const source = equipmentReviewSource(catalog), result = compile(source), definition = result.definition!;
  const cases = [-.61, .19, .77].map(f => ({ motion: { x: 53, y: -.6, z: -72, heading: .41, roll: -.06, pitch: .035 },
    launcherTrains: { 'torpedo-a': f, 'torpedo-b': -f },
    poses: definition.mounts.map((m, i) => ({ train: f * (i % 2 ? -1 : 1) * m.weapon.traverseDeg * Math.PI / 180,
      elevation: (m.weapon.elevationMinDeg + .53 * (m.weapon.elevationMaxDeg - m.weapon.elevationMinDeg)) * Math.PI / 180, recoil: i % 2 ? .2 : .85 })) }));
  const expected = await nativeConstructionMuzzles({ definition, cases, node_ids: definition.mounts.map(m => barrelIds(m.weapon).map(id => `${m.id}.${id}.muzzle`)) });
  await published(async () => {
    // An abortable load uses the composer's fetch path in this DOM-free test process.
    const model = await createConstructionModel(source, result, new AbortController().signal), actor = actorFor(definition), view = new ShipView(model, definition, actor);
    const nodes = new Map<string, THREE.Object3D>(); model.traverse(n => { if (n.userData.nodeId) { expect(nodes.has(n.userData.nodeId)).toBe(false); nodes.set(n.userData.nodeId, n); } });
    try {
      expect(nodes.get('dd-a.yaw')).not.toBe(nodes.get('dd-b.yaw'));
      for (const contact of installedSupportContacts(model, source, catalog)) {
        expect(contact.contactVertices).toBeGreaterThan(0);
        const instance = source.construction.equipment.find(p => p.id === contact.id)!;
        const part = catalog.equipment.find(p => p.id === instance.partId)!;
        // A few polygon-boundary vertices can miss through float rounding; a roller
        // touching only the old square well's corners is not a supported installation.
        if (part.kind === 'gun' && part.occupancy?.length) expect(contact.contactVertices / contact.candidates).toBeGreaterThan(.9);
      }
      for (const c of expected) {
        c.poses.forEach((pose: object, i: number) => Object.assign(actor.mounts[i], pose)); Object.assign(actor.motion, c.motion);
        actor.torpedoLaunchers!.forEach(l => { l.train = c.launcherTrains[l.id]; });
        view.snap(); view.root.updateMatrixWorld(true);
        for (const muzzle of c.muzzles) expect(nodes.get(muzzle.id)!.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...muzzle.position))).toBeLessThan(.025);
      }
    } finally { disposeConstructionModel(model); }
  });
}, 60_000);

test('rotated duplicate launcher sockets track absolute native train through interpolation', async () => {
  const source = equipmentReviewSource(catalog), result = compile(source), definition = result.definition!;
  await published(async () => {
    const model = await createConstructionModel(source, result, new AbortController().signal), actor = actorFor(definition), view = new ShipView(model, definition, actor);
    try {
      for (const train of [-1.2, -.41, .37, 1.4]) {
        view.capturePreviousPose(); actor.torpedoLaunchers!.forEach((l, i) => { l.train = train * (i ? -1 : 1); });
        for (const alpha of [0, .23, .61, 1]) { view.update(alpha); expect(Math.max(...view.torpedoMuzzleErrors())).toBeLessThan(.002); }
      }
    } finally { disposeConstructionModel(model); }
  });
});

test('native movement stops one mount against an independently held neighboring original gunhouse', () => {
  const result = compile(equipmentReviewSource(catalog, 'neighbors'));
  const initial = result.definition!.mounts.map(() => ({ train: 0, elevation: Math.PI / 180, recoil: 0 }));
  const target = [{ train: Math.PI / 2, elevation: 0, recoil: 1 }, { train: 0, elevation: 0, recoil: 0 }];
  const resolved = JSON.parse(preview_articulation_json(JSON.stringify(result.definition), JSON.stringify(initial), JSON.stringify(target)));
  expect(resolved[0].blocked).toBe(true); expect(resolved[0].obstructionId).toContain('near-b');
  expect(resolved[0].pose.train).toBeLessThan(Math.PI / 2); expect(resolved[1].pose).toEqual(target[1]);
});

test('the original Oerlikon reaches its declared elevation and stops at a real overhead beam', () => {
  const definition = compile(equipmentReviewSource(catalog)).definition!;
  const aa = definition.mounts.findIndex(m => m.id === 'aa-a');
  let current = definition.mounts.map(() => ({ train: 0, elevation: 0, recoil: 0 }));
  for (const fraction of [.2, .4, .6, .8, 1]) {
    const requested = structuredClone(current);
    requested[aa].elevation = definition.mounts[aa].weapon.elevationMaxDeg * Math.PI / 180 * fraction;
    const resolved = JSON.parse(preview_articulation_json(JSON.stringify(definition), JSON.stringify(current), JSON.stringify(requested)));
    expect(resolved[aa].blocked).toBe(false);
    expect(resolved[aa].pose.elevation).toBeCloseTo(requested[aa].elevation, 8);
    current = resolved.map((r: { pose: typeof current[number] }) => r.pose);
  }
  const obstructed = compile(equipmentReviewSource(catalog, 'overhead')).definition!;
  const initial = obstructed.mounts.map(() => ({ train: 0, elevation: 0, recoil: 0 }));
  const blocked = JSON.parse(preview_articulation_json(JSON.stringify(obstructed), JSON.stringify(initial), JSON.stringify(current)));
  expect(blocked[aa].blocked).toBe(true);
  expect(blocked[aa].pose.elevation).toBeLessThan(current[aa].elevation);
});

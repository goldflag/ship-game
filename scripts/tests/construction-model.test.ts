import { beforeAll, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import * as THREE from 'three/webgpu';
import init, { compile_construction, preview_articulation_json } from '../../src/generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import { barrelIds } from '../../src/ships/blueprint';
import type { ConstructionCatalog, ConstructionResult, ShipDefinition } from '../../src/ships/blueprint';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { ShipView } from '../../src/game/ShipView';
import { createDamage, type Combatant } from '../../src/simulation/damage';
import { createShipState } from '../../src/simulation/ship';
import { createMountState } from '../../src/simulation/weapons';
import { createTubeState } from '../../src/simulation/torpedoes';
import { equipmentReviewSource } from './construction-model-fixtures';
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

test('every published family installs with canonical ammunition and exact original tube identities', () => {
  const source = equipmentReviewSource(catalog), result = compile(source);
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(result.definition!.mounts).toHaveLength(8);
  expect(result.definition!.torpedoTubes).toHaveLength(10);
  expect(new Set(source.construction.equipment.map(p => p.partId)).size).toBe(catalog.equipment.length);
  expect(result.definition!.torpedoTubes!.map(t => t.id)).toEqual(['torpedo-a', 'torpedo-b'].flatMap(id => Array.from({ length: 5 }, (_, i) => `${id}.tube-${i + 1}`)));
  const tooSmall = structuredClone(source);
  tooSmall.construction.equipment.find(p => p.id === 'aa-a-magazine')!.partId = 'generic-magazine-1000';
  expect(compile(tooSmall).diagnostics.some(d => d.code === 'magazine-capacity' && d.sourceId === 'aa-a-magazine')).toBe(true);
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

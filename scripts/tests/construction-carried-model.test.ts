import { beforeAll, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import * as THREE from 'three/webgpu';
import init, { compile_construction } from '../../src/generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, ShipDefinition } from '../../src/ships/blueprint';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { ShipView } from '../../src/game/ShipView';
import { createDamage, type Combatant } from '../../src/simulation/damage';
import { createShipState } from '../../src/game/session/motion';
import { createMountState } from '../../src/simulation/weapons';
import { createStarterSource } from '../../src/ships/constructionStarter';

// Trainable parents: a roof fitting and a roof gun that name a turret as their parent are drawn under
// its yaw joint, so they turn with it, and the carried gun's muzzles still match the CPU pose.
const root = resolve(import.meta.dir, '../..'),
  catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => {
  await init({ module_or_path: await Bun.file(resolve(root, 'src/generated/naval-wasm/naval_wasm_bg.wasm')).arrayBuffer() });
});
const compile = (source: ConstructionSource): ConstructionResult =>
  JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
async function published<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://equipment.test')
      .pathname;
    if (!path.startsWith('/models/components/') || path.includes('..')) throw new Error(`Non-production review request ${path}`);
    const file = Bun.file(resolve(root, 'public', path.slice(1)));
    return new Response(await file.arrayBuffer(), { status: (await file.exists()) ? 200 : 404 });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function roofSource(): ConstructionSource {
  const turret = catalog.equipment.find((p) => p.id === 'sk-c28-150-twin')!;
  const roof = 8 + turret.boundsCenter[1] + turret.size[1] / 2;
  const source = createStarterSource(catalog, 'blank');
  source.id = 'carried-roof';
  source.name = 'Carried roof';
  source.revision = 'carried-roof-1';
  source.construction.version = 2;
  source.construction.defaultThicknessMm = 16;
  source.construction.primitives = [{ id: 'hull', kind: 'box', position: [0, 0, 0], size: [40, 16, 120], rotationDeg: 0 }];
  // Riders listed before their turret: the compiler orders the mounts, the model follows the links.
  source.construction.equipment = [
    { id: 'flak', partId: 'flak38-20-vierling', position: [0, roof, -24.4], bearingDeg: 180, parent: 'turret' },
    { id: 'lamp', partId: 'generic-static-searchlight', position: [1.8, roof, -26], bearingDeg: 0, parent: 'turret' },
    { id: 'turret', partId: 'sk-c28-150-twin', position: [0, 8, -25], bearingDeg: 0 },
  ];
  return source;
}
const actorFor = (definition: ShipDefinition): Combatant => ({
  motion: createShipState('review'),
  mounts: definition.mounts.map(createMountState),
  damage: createDamage(definition),
});

test('roof riders are drawn under the turret yaw and train with it', async () => {
  const source = roofSource(),
    result = compile(source),
    definition = result.definition!;
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(definition.mounts.map((m) => [m.id, m.parentMountId])).toEqual([
    ['turret', undefined],
    ['flak', 'turret'],
  ]);
  await published(async () => {
    const model = await createConstructionModel(source, result, new AbortController().signal),
      actor = actorFor(definition),
      view = new ShipView(model, definition, actor);
    try {
      const nodes = new Map<string, THREE.Object3D>();
      model.traverse((n) => {
        if (n.userData.nodeId) nodes.set(n.userData.nodeId, n);
      });
      const yaw = nodes.get('turret.yaw')!,
        lamp = model.getObjectByName('lamp')!,
        flak = model.getObjectByName('flak')!;
      expect(lamp.parent).toBe(yaw);
      expect(flak.parent).toBe(yaw);
      // Ship coordinates, whatever the hull's pose on the water.
      const local = (node: THREE.Object3D) => view.root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
      view.snap();
      view.root.updateMatrixWorld(true);
      const lampAtRest = local(lamp);
      expect(lampAtRest.distanceTo(new THREE.Vector3(1.8, source.construction.equipment[1].position[1], -26))).toBeLessThan(1e-4);
      for (const [turretTrain, flakTrain, elevation] of [
        [30, -40, 50],
        [-70, 120, 10],
      ]) {
        actor.mounts[0].train = (turretTrain * Math.PI) / 180;
        actor.mounts[1].train = (flakTrain * Math.PI) / 180;
        actor.mounts[1].elevation = (elevation * Math.PI) / 180;
        view.snap();
        view.root.updateMatrixWorld(true);
        // The carried gun's rendered muzzles match its CPU pose through the turret's train.
        expect(Math.max(...view.muzzleErrors())).toBeLessThan(0.002);
        // The fitting swings about the turret's axis: clockwise seen from above by the train.
        const r = (-turretTrain * Math.PI) / 180,
          x = 1.8,
          z = -26 - -25;
        const expected = new THREE.Vector3(x * Math.cos(r) + z * Math.sin(r), lampAtRest.y, -25 - x * Math.sin(r) + z * Math.cos(r));
        expect(local(lamp).distanceTo(expected)).toBeLessThan(1e-4);
      }
    } finally {
      disposeConstructionModel(model);
    }
  });
}, 60_000);

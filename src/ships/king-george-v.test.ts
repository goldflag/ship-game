import { expect, test } from 'bun:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import source from '../../assets/ships/king-george-v/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { barrelIds, compileShip, type Vec3 } from './blueprint';
import { shipPreset } from './presets';
import { shipStatistics, shipScores } from './statistics';
import { shipIdentity } from '../game/shipModel';
import { ShipView } from '../game/ShipView';
import { CombatSimulation } from '../simulation/combat';
import { updateMount } from '../simulation/weapons';
import { hitShip, updateFlooding, type Shell } from '../simulation/damage';
import { hullContains } from '../simulation/hull';

const definition = () => compileShip(source, catalog);
const stop = { throttle: 0, rudder: 0 };

test('KGV is selectable with ten 14-inch guns, sixteen 5.25-inch guns and honest mixed battery totals', () => {
  const def = shipPreset('king-george-v');
  expect(def.id).toBe('king-george-v');
  expect(shipIdentity(def.id)).toEqual({ type: 'Battleship', nation: 'United Kingdom' });
  expect(def.mounts.filter(m => m.battery === 'main').map(m => [m.id, barrelIds(m.weapon).length])).toEqual([
    ['main-a', 4], ['main-b', 2], ['main-y', 4],
  ]);
  expect(def.mounts.filter(m => m.weapon.caliberM === .13335)).toHaveLength(8);
  const battery = shipStatistics(def).find(s => s.id === 'main-battery')!;
  const row = (label: string) => battery.rows.find(r => r.label === label)!.value;
  expect(row('Layout')).toBe('2 × 4 + 1 × 2');
  expect(row('Salvo damage')).toBe('640');
  expect(row('Ammunition')).toBe('1,000');
  expect(shipScores(def).find(s => s.id === 'airDefense')!.score).toBeGreaterThan(0);
});

test('the published KGV hierarchy binds every barrel at full train, elevation and recoil', async () => {
  const bytes = await Bun.file(new URL('../../public/models/king-george-v.glb', import.meta.url)).arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(definition()), view = new ShipView(model.scene, sim.definition, sim.player);
  const ids = new Set<string>();
  model.scene.traverse(o => { if (o.userData.nodeId) ids.add(o.userData.nodeId); });
  for (const id of ['main-a.left-outer.muzzle', 'main-y.right-outer.recoil', 'main-b.left.elevation', 'propeller-4.spin', 'rudder-port.yaw', 'crane-port.yaw']) expect(ids.has(id)).toBe(true);
  expect(view.muzzleErrors()).toHaveLength(26);
  for (const train of [-1, 0, 1]) for (const pitch of [0, .5, 1]) for (const recoil of [0, 1]) {
    Object.assign(sim.player.motion, { x: 341, y: -1.5, z: -837, heading: 2.6, pitch: -.08, roll: .13 });
    sim.player.mounts.forEach((state, i) => {
      const w = sim.definition.mounts[i].weapon;
      Object.assign(state, { train: train * w.traverseDeg * Math.PI / 180,
        elevation: (w.elevationMinDeg + pitch * (w.elevationMaxDeg - w.elevationMinDeg)) * Math.PI / 180, recoil });
    });
    view.update(); expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
  }
});

for (const [label, aim, battery, expected] of [
  ['bow', [0, .5, -5000], 'main', 6], ['stern', [0, .5, 5000], 'main', 4],
  ['starboard broadside', [5000, .5, 0], 'main', 10], ['port broadside', [-5000, .5, 0], 'main', 10],
  ['starboard secondary', [3000, .5, 0], 'secondary', 8], ['port secondary', [-3000, .5, 0], 'secondary', 8],
] as const) test(`KGV ${label} fires the correct barrel count and spends only that ammunition`, () => {
  const sim = new CombatSimulation(definition()), target: Vec3 = [...aim];
  const ammo = sim.player.mounts.reduce((sum, m) => sum + m.ammo, 0);
  // Let each real catalog mount train, without advancing unrelated water dynamics.
  for (let tick = 0; tick < 3600; tick++) sim.definition.mounts.forEach((m, i) => updateMount(m, sim.player.mounts[i], sim.definition, sim.player.motion, target, 1 / 60));
  sim.requestFire(); sim.step(stop, { aim: target, fire: false, battery });
  expect(sim.events.filter(e => e.kind === 'shot')).toHaveLength(expected);
  expect(sim.player.mounts.reduce((sum, m) => sum + m.ammo, 0)).toBe(ammo - expected);
  sim.step(stop, { aim: target, fire: false, battery });
  expect(sim.player.mounts.reduce((sum, m) => sum + m.ammo, 0)).toBe(ammo - expected);
  sim.reset(); expect(sim.player.mounts.reduce((sum, m) => sum + m.ammo, 0)).toBe(ammo);
});

test('KGV flood cells fit the hull and keep dry equilibrium; complete flooding loses flotation', () => {
  const def = definition(), sim = new CombatSimulation(def);
  for (const c of def.compartments) for (const cell of c.cells ?? [c]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      expect(hullContains(def.hull, cell.center.map((n, i) => n + [sx, sy, sz][i] * cell.size[i] / 2) as Vec3)).toBe(true);
    }
  }
  for (let i = 0; i < 120; i++) updateFlooding(sim.player, def, 1 / 60);
  expect(sim.player.motion.y).toBeCloseTo(0, 4); expect(sim.player.damage.sunk).toBe(false);
  def.compartments.forEach((c, i) => sim.player.damage.compartments[i].waterM3 = c.capacityM3);
  for (let i = 0; i < 60; i++) updateFlooding(sim.player, def, 1 / 60);
  expect(sim.player.damage.sunk).toBe(true); expect(sim.player.damage.defeatCause).toBe('flooding');
});

test('KGV incoming AP damages machinery and opens an inspectable underwater breach; reset restores it', () => {
  const def = definition(), sim = new CombatSimulation(def);
  const index = def.modules.findIndex(m => m.id === 'boiler-1-1'), module = def.modules[index];
  const from: Vec3 = [-60, module.center[1], module.center[2]], to: Vec3 = [60, from[1], from[2]];
  const shell: Shell = { id: 1, ownerId: 'other', position: from, velocity: [800, 0, 0], age: 1, penetrationMm: 2000, damage: 100, caliberM: .3556, visited: [] };
  // A high-energy shell can pass through; the return value means stopped.
  hitShip(shell, from, to, sim.player, def, () => {});
  expect(sim.player.damage.modules[index].hp).toBeLessThan(module.hp);
  expect(sim.player.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
  for (let i = 0; i < 120; i++) updateFlooding(sim.player, def, 1 / 60);
  expect(sim.player.damage.compartments.some(c => c.waterM3 > 0)).toBe(true);
  sim.reset(); expect(sim.player.damage.modules[index].hp).toBe(module.hp);
  expect(sim.player.damage.compartments.every(c => c.waterM3 === 0 && c.breachAreaM2 === 0)).toBe(true);
});

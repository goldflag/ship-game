import { expect, test } from 'bun:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import source from '../../assets/ships/kongo/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { barrelIds, compileShip, type Vec3 } from './blueprint';
import { shipPreset } from './presets';
import { shipIdentity } from '../game/shipModel';
import { ShipView } from '../game/ShipView';
import { CombatSimulation } from '../simulation/combat';
import { updateMount } from '../simulation/weapons';
import { hitShip, updateFlooding, type Shell } from '../simulation/damage';
import { structuralHits } from '../simulation/structure';
import { hullContains } from '../simulation/hull';
import { plateHit } from '../simulation/protection';
import { mountFrame } from '../simulation/mountFrames';
import { localToWorld } from '../simulation/geometry';

const definition = () => compileShip(source, catalog);

test('Kongo roof AA decks and shields stop shots in their parent turret frame', () => {
  const def = definition();
  for (const id of ['main-2', 'main-3']) {
    const index = def.mounts.findIndex(m => m.id === id);
    const plates = def.armor.filter(a => a.id.startsWith(`${id}-aa-roof-`));
    expect(plates).toHaveLength(14);
    for (const train of [-1.2, 0, .9]) {
      // Independent AA training must not turn the platform beneath the guns.
      const trains: number[] = def.mounts.map(m => m.parentMountId ? .7 : 0);
      trains[index] = train;
      const frame = mountFrame(def, index, trains);
      const contacts = (from: Vec3, to: Vec3) => plates.filter(a =>
        plateHit(localToWorld(from, frame), localToWorld(to, frame), a, def, trains));
      expect(contacts([4, 6.7, 2], [3, 6.7, 2]).length).toBeGreaterThan(0);
      expect(contacts([1.94, 6.5, 1.55], [1.94, 6.1, 1.55]).length).toBeGreaterThan(0);
      expect(contacts([4, 7.2, 2], [3, 7.2, 2])).toHaveLength(0);
      expect(contacts([4, 6.1, 2], [3, 6.1, 2])).toHaveLength(0);
      // The two forward points leave the centerline setback open.
      expect(contacts([0, 6.5, 0], [0, 6.1, 0])).toHaveLength(0);
    }
  }
});

test('Kongo flood spaces and internal machinery stay inside the authored hull', () => {
  const def = definition();
  const boxes = def.compartments.flatMap(c => c.cells ?? [c]);
  boxes.push(...def.modules.filter(m => m.placement !== 'fixed'));
  for (const box of boxes) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const point = box.center.map((n, i) => n + [sx, sy, sz][i] * box.size[i] / 2) as Vec3;
      expect(hullContains(def.hull, point)).toBe(true);
    }
  }
});

test('Kongo provisional belt and deck armor remain seated in the current hull', () => {
  const def = definition();
  for (const armor of def.armor.filter(a => /^(belt-|deck-)/.test(a.id))) {
    for (const vertex of armor.plate!.vertices) expect(hullContains(def.hull, vertex)).toBe(true);
  }
});

test('Kongo belt follows the hull shoulder and leaves the casemate wells open to shots', () => {
  const def = definition();
  for (const side of [-1, 1]) {
    expect(hullContains(def.hull, [side * 14.85, 0, 0])).toBe(true);
    expect(hullContains(def.hull, [side * 15, 0, 0])).toBe(false);
    const beltHits = (from: Vec3, to: Vec3) => structuralHits(from, to, def)
      .filter(hit => hit.surface.id === 'casemate-belt');
    expect(beltHits([side * 14, 6, 0], [side * 13, 6, 0]).length).toBeGreaterThan(0);
    expect(beltHits([side * 16, 6, -18.61], [side * 9, 6, -18.61])).toHaveLength(0);
    expect(beltHits([side * 9, 6, -18.61], [side * 8.8, 6, -18.61]).length).toBeGreaterThan(0);
    expect(beltHits([side * 12.5, 7.5, 0], [side * 12.5, 7.2, 0]).length).toBeGreaterThan(0);
  }
});

test('Kongo director supports preserve lightening holes and the casemate roof gap', () => {
  const def = definition();
  for (const side of [-1, 1]) {
    const supportHits = (x: number) => structuralHits([side * x, 10.63, -21.4], [side * x, 10.63, -20.9], def)
      .filter(hit => hit.surface.id.startsWith('pagoda-side-director-support-'));
    expect(supportHits(10.416)).toHaveLength(0);
    expect(supportHits(10.59).length).toBeGreaterThan(0);
    const directorContact = (from: Vec3, to: Vec3) => structuralHits(from, to, def)
      .filter(hit => hit.surface.id.startsWith('pagoda-side-director-'));
    expect(directorContact([side * 10.6, 7.9, -19.9], [side * 10.6, 7.4, -19.9])
      .some(hit => hit.surface.id.endsWith('-seat'))).toBe(true);
    expect(directorContact([side * 10.5, 7.45, -19], [side * 11.1, 7.45, -19])).toHaveLength(0);
  }
});

test('Kongo forward AA gallery stops shots at its deck and webs while keeping six lightening holes open', () => {
  const def = definition();
  const galleryHits = (from: Vec3, to: Vec3) => structuralHits(from, to, def)
    .filter(hit => hit.surface.id.startsWith('forward-aa-gallery-'));
  for (const side of [-1, 1]) for (const forward of [37.18, 38.415, 39.63]) {
    expect(galleryHits([side * 2.1, 16.026, -forward], [side * 1.7, 16.026, -forward])).toHaveLength(0);
    expect(galleryHits([side * 2.1, 16.37, -forward], [side * 1.7, 16.37, -forward]).length).toBeGreaterThan(0);
  }
  expect(galleryHits([3, 16.8, -41], [3, 16.4, -41])
    .some(hit => hit.surface.id === 'forward-aa-gallery-deck')).toBe(true);
  expect(galleryHits([3, 15.8, -42], [-3, 15.8, -42])).toHaveLength(0);
});

test('Kongo shared foundations support No. 2 turret and both funnel groups', () => {
  const def = definition();
  for (const [x, z, top, id] of [
    [0, -45, 8.44, 'bridge-foundation'],
    [7, -12, 7.75, 'uptakes'],
    [4, 6.94, 9, 'after-tower-foot'],
  ] as const) {
    expect(structuralHits([x, top + .1, z], [x, top - .1, z], def)
      .some(hit => hit.surface.id === id)).toBe(true);
  }
});

test('Kongo bridge plating leaves glazing and the crew-eye sightline open', () => {
  const def = definition();
  const contact = (from: Vec3, to: Vec3) => structuralHits(from, to, def).length > 0;
  expect(contact([0, 19.4, -40], [0, 19.4, -35.8])).toBe(false);
  expect(contact([0, 18.4, -40], [0, 18.4, -35.8])).toBe(true);
  expect(contact([8, 25, -27], [3, 25, -27])).toBe(false);
  expect(contact(def.viewpoints!.bridge, [0, def.viewpoints!.bridge[1], -90])).toBe(false);
});

test('Kongo aircraft deck preserves the aft gap and space below its overhang', () => {
  const def = definition();
  const contact = (from: Vec3, to: Vec3) => structuralHits(from, to, def).length > 0;
  expect(contact([3.8, 6, 54], [3.8, 7.1, 54])).toBe(false);
  expect(contact([3.8, 7.1, 54], [3.8, 7.4, 54])).toBe(true);
  expect(contact([0, 6, 54], [0, 7.1, 54])).toBe(true);
  expect(contact([6, 6, 58], [6, 7.4, 58])).toBe(false);
});

test('Kongo rear mast plating has physical openings and tapered bridge roofs', () => {
  const def = definition();
  // A cross-ship shot passes through the open rear gallery, but strikes the
  // sheet below it. The previous collision approximation omitted both sheets.
  expect(structuralHits([4, 24.8, -27], [-4, 24.8, -27], def)).toHaveLength(0);
  expect(structuralHits([4, 23, -27], [-4, 23, -27], def)
    .some(hit => hit.surface.id.startsWith('pagoda-rear-plating-'))).toBe(true);
  expect(structuralHits([0, 24, -32], [0, 23, -32], def)
    .some(hit => hit.surface.id === 'pagoda-compass-room-hip')).toBe(true);
});

test('Kongo funnel mouths remain open above their recessed wells', () => {
  const def = definition();
  for (const z of [-8.88, 6.94]) {
    expect(structuralHits([0, 24, z], [0, 20, z], def)).toHaveLength(0);
    expect(structuralHits([0, 20, z], [0, 18, z], def).some(h => h.surface.id.endsWith('-funnel'))).toBe(true);
    expect(structuralHits([4, 20, z], [0, 20, z], def).some(h => h.surface.id.endsWith('-funnel'))).toBe(true);
  }
});

test('Kongo is selectable with the approved 1944 fit and four carried AA mounts', () => {
  const def = shipPreset('kongo');
  expect(shipIdentity(def.id)).toEqual({ type: 'Battleship', nation: 'Japan' });
  expect(def.mounts).toHaveLength(74);
  expect(def.mounts.reduce((n, m) => n + barrelIds(m.weapon).length, 0)).toBe(128);
  const fitted = (part: string) => def.mounts.filter(m => m.partId === part).length;
  expect(['type41-356-kongo-twin', 'type41-152-kongo-casemate', 'type89-127-a1-twin',
    'type96-25-kongo-3', 'type96-25-kongo-2', 'type96-25-kongo-single'].map(fitted)).toEqual([4, 8, 6, 18, 8, 30]);
  expect(def.mounts.filter(m => m.parentMountId).map(m => [m.id, m.parentMountId])).toEqual([
    ['aa25-01', 'main-2'], ['aa25-02', 'main-2'], ['aa25-33', 'main-3'], ['aa25-34', 'main-3'],
  ]);
});

test('published Kongo muzzle sockets follow independent parent and child poses', async () => {
  const bytes = await Bun.file(new URL('../../public/models/kongo.glb', import.meta.url)).arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const jointIds = new Set<string>();
  model.scene.traverse(o => { if (o.userData.nodeId) jointIds.add(o.userData.nodeId); });
  for (const id of ['propeller-1.spin', 'propeller-2.spin', 'propeller-3.spin', 'propeller-4.spin', 'rudder-port.yaw', 'rudder-starboard.yaw']) {
    expect(jointIds.has(id)).toBe(true);
  }
  const sim = new CombatSimulation(definition()), view = new ShipView(model.scene, sim.definition, sim.player);
  expect(view.muzzleErrors()).toHaveLength(128);
  for (const fraction of [-1, -.63, -.17, 0, .38, .76, 1]) {
    Object.assign(sim.player.motion, { x: 381, y: -1.3, z: -812, heading: 2.2, pitch: -.05, roll: .12 });
    sim.player.mounts.forEach((state, i) => {
      const mount = sim.definition.mounts[i], w = mount.weapon;
      const train = mount.parentMountId ? -fraction : fraction;
      const elevation = (i % 3) / 2, recoil = (i % 4) / 3;
      Object.assign(state, { train: train * w.traverseDeg * Math.PI / 180,
        elevation: (w.elevationMinDeg + elevation * (w.elevationMaxDeg - w.elevationMinDeg)) * Math.PI / 180, recoil });
    });
    view.update();
    expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
  }
});

for (const sign of [-1, 1]) test(`Kongo ${sign < 0 ? 'port' : 'starboard'} main broadside fires eight barrels and reset restores ammunition`, () => {
  const sim = new CombatSimulation(definition()), aim: Vec3 = [sign * 5000, .5, 0];
  const ammunition = sim.player.mounts.reduce((n, m) => n + m.ammo, 0);
  for (let tick = 0; tick < 2400; tick++) sim.definition.mounts.forEach((m, i) => {
    if (m.battery === 'main') updateMount(m, sim.player.mounts[i], sim.definition, sim.player.motion, aim, 1 / 30);
  });
  sim.requestFire(); sim.step({ throttle: 0, rudder: 0 }, { aim, fire: false, battery: 'main' });
  expect(sim.events.filter(e => e.kind === 'shot')).toHaveLength(8);
  expect(sim.player.mounts.reduce((n, m) => n + m.ammo, 0)).toBe(ammunition - 8);
  sim.reset();
  expect(sim.player.mounts.reduce((n, m) => n + m.ammo, 0)).toBe(ammunition);
});

test('Kongo machinery hits open flooding damage that reset clears', () => {
  const def = definition(), sim = new CombatSimulation(def);
  const index = def.modules.findIndex(m => m.id === 'boiler-5-1'), module = def.modules[index];
  const from: Vec3 = [-60, module.center[1], module.center[2]], to: Vec3 = [60, from[1], from[2]];
  const shell: Shell = { id: 1, ownerId: 'other', position: from, velocity: [800, 0, 0], age: 1,
    penetrationMm: 2000, damage: 100, caliberM: .356, visited: [] };
  hitShip(shell, from, to, sim.player, def, () => {});
  expect(sim.player.damage.modules[index].hp).toBeLessThan(module.hp);
  expect(sim.player.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
  for (let i = 0; i < 120; i++) updateFlooding(sim.player, def, 1 / 60);
  expect(sim.player.damage.compartments.some(c => c.waterM3 > 0)).toBe(true);
  sim.reset();
  expect(sim.player.damage.modules[index].hp).toBe(module.hp);
  expect(sim.player.damage.compartments.every(c => c.waterM3 === 0 && c.breachAreaM2 === 0)).toBe(true);
});

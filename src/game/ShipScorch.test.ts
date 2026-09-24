import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import type { CombatEvent } from './session/elements';
import { impactStyle } from './ShipImpactMarks';
import { SCORCH, SCORCH_SPOTS, SCORCH_TEXELS, ShipScorch, addStrike, mainDeckHeight, type ScorchedView } from './ShipScorch';

const def = shipPreset('bismarck');
const DECK = 6;

/** A hull view as ShipView offers it: the hull frame at the actor's pose and a model whose deck is a slab topped at `DECK`. */
function hull(sim = new CombatSimulation(def), actor = sim.player) {
  const root = new THREE.Group(), model = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(def.hull.beam, 2, def.hull.length), new THREE.MeshStandardMaterial());
  deck.position.y = DECK - 1; model.add(deck); root.add(model);
  root.position.set(actor.motion.x, actor.motion.y, actor.motion.z);
  root.rotation.set(actor.motion.pitch, -actor.motion.heading, actor.motion.roll, 'YXZ');
  root.updateMatrixWorld(true);
  const view: ScorchedView = { actor, definition: def, motion: actor.motion, root, model };
  return { sim, actor, view };
}
const run = (scorch: ShipScorch, views: ScorchedView[], seconds: number, events: CombatEvent[] = [], camera = new THREE.PerspectiveCamera()) => {
  for (let i = 0; i < Math.round(seconds * 10); i++) scorch.update(views, events, .1, camera, new THREE.Vector3());
};
const vented = def.compartments.findIndex(c => c.fire?.ventPosition);
const shipId = new CombatSimulation(def).player.motion.id;
const strike = (sequence: number, outcome: 'penetration' | 'stopped' | 'ricochet', type: 'AP' | 'HE', position: [number, number, number] = [18, 4, -30]): CombatEvent => ({
  sequence, tick: sequence, kind: outcome, shipId, position, message: 'Test strike', shell: { id: sequence, caliberM: .38, type, velocity: [-700, -100, 0] },
  surfaceImpact: { position, normal: [1, 0, 0], direction: [-1, 0, 0], outcome } });

test('an undamaged fleet publishes nothing, so the paint skips the damage on one uniform', () => {
  const scorch = new ShipScorch(), { view } = hull();
  run(scorch, [view], 2);
  expect(scorch.diagnostics().drawn).toBe(0);
  expect(scorch.spots(view)).toHaveLength(0);
  scorch.dispose();
});

test('a compartment fire soots and chars the deck it vents onto while it burns, and the scorch outlasts it', () => {
  const scorch = new ShipScorch(), { actor, view } = hull(), fire = actor.damage.control.rooms[vented];
  fire.intensity = 1; fire.heat = 1;
  run(scorch, [view], 30);
  const [spot] = scorch.spots(view);
  // The authored vent stands above the deck; the scorch sits on the deck under it.
  expect(def.compartments[vented].fire!.ventPosition![1]).toBeGreaterThan(DECK + 1);
  expect(spot.position.y).toBeCloseTo(DECK, 3);
  expect(spot.soot).toBeCloseTo(30 / SCORCH.sootSeconds, 1);
  expect(spot.char).toBeGreaterThan(.2);
  expect(spot.heat).toBeGreaterThan(.9);
  expect(scorch.diagnostics().drawn).toBe(1);
  const soot = spot.soot;
  fire.intensity = 0; fire.heat = .2;
  run(scorch, [view], 120);
  expect(scorch.spots(view)[0].soot).toBe(soot);
  expect(scorch.spots(view)[0].heat).toBeLessThan(.05);
  expect(scorch.diagnostics().drawn).toBe(1);
  scorch.dispose();
});

test('fires venting at one place share its scorch, a magazine its turret\'s, and gather it once', () => {
  const scorch = new ShipScorch(), { actor, view } = hull();
  const mount = 0, turret = def.mounts[mount].position;
  const magazines = def.compartments.map((c, i) => [c, i] as const)
    .filter(([c]) => c.fire?.ventPosition && Math.hypot(c.fire.ventPosition[0] - turret[0], c.fire.ventPosition[2] - turret[2]) < .5).map(([, i]) => i);
  expect(magazines.length).toBeGreaterThan(1);
  for (const fire of [actor.damage.control.mounts[mount], ...magazines.map(i => actor.damage.control.rooms[i])]) { fire.intensity = 1; fire.heat = 1; }
  run(scorch, [view], 10);
  expect(scorch.spots(view)).toHaveLength(1);
  expect(scorch.spots(view)[0].key).toBe(`mount:${mount}`);
  expect(scorch.spots(view)[0].soot).toBeCloseTo(10 / SCORCH.sootSeconds, 2);
  scorch.dispose();
});

test('strikes scorch as widely as their impact marks reach; a stopped AP shot and a ricochet leave only their mark', () => {
  const scorch = new ShipScorch(), { view } = hull();
  run(scorch, [view], .1, [strike(1, 'ricochet', 'AP'), strike(2, 'stopped', 'AP', [18, 4, 30])]);
  expect(scorch.spots(view)).toHaveLength(0);
  run(scorch, [view], .1, [strike(3, 'stopped', 'HE'), strike(4, 'penetration', 'AP', [18, 4, 40])]);
  const [he, ap] = scorch.spots(view);
  expect(he.radius).toBeCloseTo(impactStyle(.38, 'HE', 'stopped').width * SCORCH.strikeRadius.HE, 5);
  expect(ap.radius).toBeCloseTo(impactStyle(.38, 'AP', 'penetration').width * SCORCH.strikeRadius.AP, 5);
  expect(he.soot).toBeGreaterThan(ap.soot);
  // Seen once: the ring is read by sequence.
  run(scorch, [view], .1, [strike(3, 'stopped', 'HE')]);
  expect(scorch.spots(view)).toHaveLength(2);
  scorch.dispose();
});

test('strikes close together deepen one scorch, and a full hull keeps its spots bounded', () => {
  const spots: Parameters<typeof addStrike>[0] = [];
  addStrike(spots, new THREE.Vector3(0, 5, 0), 2, .5, .3);
  addStrike(spots, new THREE.Vector3(1, 5, 0), 2, .5, .3);
  expect(spots).toHaveLength(1);
  expect(spots[0].soot).toBeCloseTo(.8, 5);
  expect(spots[0].radius).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < SCORCH_SPOTS * 3; i++) addStrike(spots, new THREE.Vector3(0, 5, i * 20), 2, .5, .3);
  expect(spots).toHaveLength(SCORCH_SPOTS);
  expect(Math.max(...spots.map(spot => spot.radius))).toBeLessThanOrEqual(SCORCH.strikeMaxRadius);
});

test('a hull shot to pieces burns out fully; one lost to flooding without fire only in part', () => {
  const scorch = new ShipScorch(), shot = hull(), flooded = hull();
  Object.assign(shot.actor.damage, { sunk: true, defeatCause: 'hull-failure' });
  Object.assign(flooded.actor.damage, { sunk: true, defeatCause: 'flooding' });
  run(scorch, [shot.view, flooded.view], SCORCH.burnoutSeconds / 2);
  expect(scorch.burnout(shot.view)).toBeCloseTo(.5, 1);
  run(scorch, [shot.view, flooded.view], SCORCH.burnoutSeconds);
  expect(scorch.burnout(shot.view)).toBe(1);
  expect(scorch.burnout(flooded.view)).toBeCloseTo(SCORCH.floodedBurnout, 5);
  expect(scorch.diagnostics().drawn).toBe(2);
  scorch.dispose();
});

test('a published row holds the hull\'s bounds, its world-to-hull matrix and its spots', () => {
  const scorch = new ShipScorch(), { actor, view } = hull();
  actor.motion.heading = .7; view.root.rotation.set(0, -.7, 0, 'YXZ'); view.root.updateMatrixWorld(true);
  run(scorch, [view], .1, [strike(1, 'penetration', 'AP')]);
  const data = scorch.data.image.data as Float32Array, texel = (i: number) => [...data.subarray(i * 4, i * 4 + 4)];
  // Row 0: the matrix rows take a world point back to the hull frame.
  const world = new THREE.Vector3(18, 4, -30).applyMatrix4(view.root.matrixWorld), rows = [1, 2, 3].map(texel);
  const local = rows.map(r => r[0] * world.x + r[1] * world.y + r[2] * world.z + r[3]);
  expect(local[0]).toBeCloseTo(18, 3); expect(local[1]).toBeCloseTo(4, 3); expect(local[2]).toBeCloseTo(-30, 3);
  expect(texel(5)[1]).toBeCloseTo(mainDeckHeight(def), 5);
  expect(texel(5)[2]).toBe(1);
  expect(texel(6).slice(0, 3)).toEqual([18, 4, -30]);
  expect(data.length).toBe(SCORCH_TEXELS * 16 * 4);
  scorch.dispose();
});

test('a new battle forgets the damage: a new damage state, or clearing', () => {
  const scorch = new ShipScorch(), { actor, view } = hull();
  run(scorch, [view], .1, [strike(1, 'penetration', 'AP')]);
  expect(scorch.spots(view)).toHaveLength(1);
  actor.damage = structuredClone(actor.damage);
  run(scorch, [view], .1);
  expect(scorch.spots(view)).toHaveLength(0);
  expect(scorch.diagnostics().drawn).toBe(0);
  run(scorch, [view], .1, [strike(2, 'penetration', 'AP')]);
  expect(scorch.spots(view)).toHaveLength(1);
  scorch.clear();
  expect(scorch.spots(view)).toHaveLength(0);
  expect(scorch.diagnostics().drawn).toBe(0);
  // The ring numbers afresh after a restart.
  run(scorch, [view], .1, [strike(1, 'penetration', 'AP')]);
  expect(scorch.spots(view)).toHaveLength(1);
  scorch.dispose();
});

test('a constructed hull whose deck line tops its whole volume takes its main deck from the model', () => {
  const scorch = new ShipScorch(), { view } = hull();
  const lofty: ScorchedView = { ...view, definition: { ...def, hull: { ...def.hull, deckHeights: [[0, 23.2], [def.hull.length, 23.2]] } } };
  run(scorch, [lofty], .1, [strike(1, 'penetration', 'AP')]);
  expect((scorch.data.image.data as Float32Array)[5 * 4 + 1]).toBeCloseTo(DECK, 3);
  scorch.dispose();
});

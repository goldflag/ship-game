import { expect, spyOn, test } from 'bun:test';
import { BoxGeometry, Group, InstancedMesh, LineSegments, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AircraftView } from './AircraftView';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { aircraftDeckSpot } from '../simulation/aircraft';
import { aircraftContactAppearance } from './AircraftContacts';

test('follow-camera zoom keeps a readable contact before thin aircraft fade into the sea', () => {
  // A 12 m aircraft at 600 m spans ~22 pixels at 1080p, but its edge-on
  // wings/fuselage cover very few of those pixels. Supplement it before 14 px.
  expect(aircraftContactAppearance(22, 600).opacity).toBeGreaterThan(.5);
  expect(aircraftContactAppearance(70, 180).opacity).toBe(0);
  expect(aircraftContactAppearance(3, 21000).opacity).toBe(0);
});

test('hangar starts hidden; explicitly spotted aircraft follow the carrier pose and respect port visibility', async () => {
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const scene = new Group(); scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  });
  const view = new AircraftView();
  try {
    await view.load();
    const def = shipPreset('enterprise-cv6');
    const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [def] });
    const carrier = new Group(); carrier.position.set(123, 5, 456); carrier.rotation.set(.04, .6, .08); carrier.updateMatrixWorld(true);
    const roots = new Map([['player', carrier]]), camera = new PerspectiveCamera();
    view.update(sim, camera, true, true, roots);
    expect(view.diagnostics().instances).toBe(0);
    sim.actors.forEach(actor => actor.airWing!.planes.slice(0, 12).forEach((p, i) => { p.deckSlot = i; }));
    view.update(sim, camera, true, true, roots);
    expect(view.diagnostics().instances).toBe(12);
    const firstBatch = view.root.children.find(c => c instanceof InstancedMesh && c !== view.root.children[1] && c.count > 0) as InstancedMesh;
    const matrix = new Matrix4(); firstBatch.getMatrixAt(0, matrix);
    const spot = aircraftDeckSpot(sim.player, sim.player.airWing!.planes[0]);
    const expected = carrier.matrixWorld.clone().multiply(new Matrix4().makeTranslation(...spot));
    matrix.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i], 3));
    sim.player.airWing!.planes[0].phase = 'lost';
    view.update(sim, camera, true, true, roots); expect(view.diagnostics().instances).toBe(11);
    view.update(sim, camera, true, false, roots); expect(view.diagnostics().instances).toBe(23);
    view.update(sim, camera, false, true, roots); expect(view.root.visible).toBe(false);
  } finally { await view.dispose(); loader.mockRestore(); }
});

test('distant flying aircraft retain a silhouette across LODs, while deck, lost and hidden aircraft do not', async () => {
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const scene = new Group(); scene.add(new Mesh(new BoxGeometry(12, .2, 8), new MeshBasicMaterial()));
    return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  });
  const view = new AircraftView();
  try {
    await view.load();
    const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
    sim.aircraft.forEach(p => { p.phase = 'lost'; });
    const plane = sim.player.airWing!.planes[0]; plane.phase = 'outbound';
    plane.position = plane.previousPosition = [0, 300, 0];
    const camera = new PerspectiveCamera(52, 1, .5, 60000);
    const contacts = () => view.root.getObjectByName('Distant aircraft silhouettes') as InstancedMesh | undefined;
    for (const distance of [100, 121, 401, 1500, 3000, 6000]) {
      camera.position.set(0, 300, distance); camera.lookAt(0, 300, 0); camera.updateMatrixWorld(true);
      view.update(sim, camera, true);
      expect(view.diagnostics().instances).toBe(1);
      if (distance >= 1500) expect(contacts()?.count).toBe(1);
      else if (distance === 100) expect(contacts()?.visible).toBe(false);
    }
    camera.zoom = 24; camera.updateProjectionMatrix(); view.update(sim, camera, true);
    expect(contacts()?.visible).toBe(false); // Binoculars resolve the actual model again.
    camera.zoom = 1; camera.updateProjectionMatrix();
    plane.phase = 'ready'; view.update(sim, camera, true); expect(contacts()?.visible).toBe(false);
    plane.phase = 'lost'; view.update(sim, camera, true); expect(contacts()?.visible).toBe(false);
    plane.phase = 'outbound'; view.update(sim, camera, false); expect(view.root.visible).toBe(false);
  } finally { await view.dispose(); loader.mockRestore(); }
});

test('large carrier fleets retain every visible aircraft without oversized GPU uniform bindings', async () => {
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const scene = new Group(); scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  });
  const view = new AircraftView();
  try {
    await view.load();
    const sim = new CombatSimulation(shipPreset('enterprise-cv6'), { friendlyBots: [], enemies: [shipPreset('bismarck')] });
    const template = sim.aircraft[0];
    // Isolate rendering of the largest permitted shared model population:
    // 60 decks of 24 aircraft plus the battle's 144 airborne capacity.
    sim.player.airWing!.planes = Array.from({ length: 1584 }, (_, i) => ({ ...structuredClone(template), id: `player/render-${i}`, phase: 'outbound', payload: false }));
    view.update(sim, new PerspectiveCamera(), true);
    expect(view.diagnostics().instances).toBe(1584);
    const modelBatches = view.root.children.filter(c => c instanceof InstancedMesh && c.count > 0 && c !== view.root.children[1] && c.name !== 'Distant aircraft silhouettes') as InstancedMesh[];
    expect(modelBatches.reduce((n, b) => n + b.count, 0)).toBe(1584);
    for (const batch of modelBatches) {
      expect(batch.instanceMatrix.array.byteLength).toBeLessThanOrEqual(65536);
      expect(batch.count).toBeLessThanOrEqual(batch.instanceMatrix.count);
    }
  } finally { await view.dispose(); loader.mockRestore(); }
});

test('ship AA tracers travel from the muzzle and expire after reaching their endpoint', async () => {
  const view = new AircraftView();
  try {
    const sim = new CombatSimulation(shipPreset('bismarck'));
    sim.events.push({ sequence: 1, tick: 0, kind: 'aircraft-fire', position: [0, 20, 0], shipId: 'player', message: 'AA fire',
      aircraft: { id: 'hostile', target: [0, 20, -1000], tracerSpeed: 800 } });
    const camera = new PerspectiveCamera();
    sim.tick = 30; view.update(sim, camera, true);
    const lines = view.root.children.find(c => c instanceof LineSegments) as LineSegments;
    expect(lines.geometry.drawRange.count).toBe(2);
    const positions = lines.geometry.getAttribute('position');
    expect(positions.getZ(0)).toBeCloseTo(-375);
    expect(positions.getZ(1)).toBeCloseTo(-420);
    sim.tick = 120; view.update(sim, camera, true);
    expect(lines.geometry.drawRange.count).toBe(0);
  } finally { await view.dispose(); }
});

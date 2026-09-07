import { expect, spyOn, test } from 'bun:test';
import { BoxGeometry, Group, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AircraftView } from './AircraftView';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { aircraftDeckSpot } from '../simulation/aircraft';
import { aircraftGroundPose } from '../simulation/aircraftGroundPose';
import { aircraftContactAppearance } from './AircraftContacts';

const drawCount = (mesh: InstancedMesh) => (mesh.geometry as InstancedBufferGeometry).instanceCount;

test('distant contacts stay faint and never enlarge or darken a resolved airframe', () => {
  for (const span of [.25, .5, 1, 2, 3, 6, 10, 12, 22, 70]) {
    const appearance = aircraftContactAppearance(span);
    expect(appearance.pixels).toBeLessThanOrEqual(span);
    expect(appearance.pixels).toBeLessThanOrEqual(3);
    expect(appearance.opacity).toBeLessThanOrEqual(.3);
    if (span >= 12) expect(appearance.opacity).toBe(0);
    else expect(appearance.opacity).toBeGreaterThan(0);
  }
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
    const firstBatch = view.root.children.find(c => c instanceof InstancedMesh && c.name.startsWith('Aircraft model ') && c.visible) as InstancedMesh;
    const matrix = new Matrix4(); firstBatch.getMatrixAt(0, matrix);
    const spot = aircraftDeckSpot(sim.player, sim.player.airWing!.planes[0]);
    const expected = carrier.matrixWorld.clone().multiply(new Matrix4().makeTranslation(...spot))
      .multiply(new Matrix4().makeRotationX(aircraftGroundPose(sim.player.airWing!.planes[0].modelId).pitch));
    matrix.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i], 3));
    sim.player.airWing!.planes[0].phase = 'lost';
    view.update(sim, camera, true, true, roots); expect(view.diagnostics().instances).toBe(11);
    camera.position.set(0, 12000, 0); camera.lookAt(0, 0, 0); camera.far = 60000; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
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
    for (const distance of [100, 121, 401, 1500, 3000, 6000, 21000, 35000]) {
      camera.position.set(0, 300, distance); camera.lookAt(0, 300, 0); camera.updateMatrixWorld(true);
      view.update(sim, camera, true);
      expect(view.diagnostics().instances).toBe(1);
      expect(view.diagnostics().contacts).toBe(distance >= 1500 ? 1 : 0);
      if (distance >= 1500) expect(view.root.children.filter(c => c instanceof InstancedMesh && c.name.endsWith('/2')).reduce((n, c) => n + drawCount(c as InstancedMesh), 0)).toBe(1);
      if (distance >= 1500) expect(contacts()?.count).toBe(contacts()?.instanceMatrix.count);
      else if (distance === 100) expect(contacts()?.visible).toBe(false);
    }
    camera.position.set(0, 300, 6000); camera.updateMatrixWorld(true);
    camera.zoom = 24; camera.updateProjectionMatrix(); view.update(sim, camera, true);
    expect(contacts()?.visible).toBe(false); // Binoculars resolve the actual model again.
    expect(view.diagnostics().instances).toBe(1);
    camera.lookAt(0, 300, 12000); camera.updateMatrixWorld(true); view.update(sim, camera, true);
    expect(view.diagnostics().culled).toBe(1); expect(view.diagnostics().instances).toBe(0); expect(contacts()?.visible).toBe(false);
    camera.lookAt(0, 300, 0); camera.updateMatrixWorld(true);
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
    // Cross the former fleet-wide limit and allocate a fourth GPU batch.
    const population = 2305;
    sim.player.airWing!.planes = Array.from({ length: population }, (_, i) => ({ ...structuredClone(template), id: `player/render-${i}`, phase: 'outbound', payload: false }));
    for (const count of [0, 1, 6, 2, 769, 800, 1, population]) {
      sim.player.airWing!.planes.forEach((plane, i) => { plane.phase = i < count ? 'outbound' : 'lost'; });
      view.update(sim, new PerspectiveCamera(), true);
      const batches = view.root.children.filter(c => c instanceof InstancedMesh && c.name.startsWith('Aircraft model ')) as InstancedMesh[];
      expect(batches.reduce((n, batch) => n + drawCount(batch), 0)).toBe(count);
      for (const batch of batches) {
        expect(batch.count).toBe(batch.instanceMatrix.count); // Shader capacity must survive growth after the first draw.
        expect(batch.visible).toBe(drawCount(batch) > 0);
      }
    }
    expect(view.diagnostics().instances).toBe(population);
    const modelBatches = view.root.children.filter(c => c instanceof InstancedMesh && c.visible && c.name.startsWith('Aircraft model ')) as InstancedMesh[];
    expect(modelBatches.reduce((n, b) => n + drawCount(b), 0)).toBe(population);
    for (const batch of modelBatches) {
      expect(batch.instanceMatrix.array.byteLength).toBeLessThanOrEqual(65536);
      expect(batch.count).toBe(batch.instanceMatrix.count);
      expect(drawCount(batch)).toBeLessThanOrEqual(batch.count);
    }
    const distant = new PerspectiveCamera(52, 1, .5, 60000);
    distant.position.set(0, 300, 6000); distant.lookAt(0, 0, 0); distant.updateMatrixWorld(true);
    view.update(sim, distant, true);
    expect(view.diagnostics().instances).toBe(population);
    expect(view.root.children.filter(c => c instanceof InstancedMesh && c.name.endsWith('/2')).reduce((n, c) => n + drawCount(c as InstancedMesh), 0)).toBe(population);
    expect(view.diagnostics().contacts).toBe(population);
    expect(modelBatches.every(batch => !batch.visible)).toBe(true); // Near LOD batches give way to LOD2.
    for (const count of [1, 6, 0, population]) {
      sim.player.airWing!.planes.forEach((plane, i) => { plane.phase = i < count ? 'outbound' : 'lost'; });
      view.update(sim, distant, true);
      const contacts = view.root.getObjectByName('Distant aircraft silhouettes') as InstancedMesh;
      expect(view.diagnostics().contacts).toBe(count);
      expect(contacts.count).toBe(contacts.instanceMatrix.count);
    }
  } finally { await view.dispose(); loader.mockRestore(); }
});

test('bombs retain their release attitude, interpolate ballistics and never draw an artillery glow', async () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6')), view = new AircraftView();
  const { CombatEffects } = await import('./CombatEffects');
  const effects = new CombatEffects(), camera = new PerspectiveCamera();
  sim.aircraft.forEach(p => { p.phase = 'lost'; });
  const shell = { id: 100, ownerId: 'player', position: [0, 100, 0] as [number, number, number], velocity: [0, -20, -90] as [number, number, number],
    bomb: { heading: .2, pitch: -.3, bank: .4 }, age: 0, damage: 380, penetrationMm: 0, caliberM: .35, visited: [], ammunition: 'he' as const };
  sim.shells.push(shell);
  try {
    view.update(sim, camera, true); effects.update(sim, 0, camera);
    expect(view.diagnostics().bombs).toBe(1); expect(effects.diagnostics().shells).toBe(0);
    const bombs = view.root.getObjectByName('Aircraft bombs') as InstancedMesh;
    const matrix = new Matrix4(); bombs.getMatrixAt(0, matrix);
    const expected = new Group(); expected.position.fromArray(shell.position); expected.rotation.set(-.3, -.2, .4, 'YXZ'); expected.updateMatrix();
    matrix.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.matrix.elements[i], 5));
    shell.age = 1; shell.position = [0, 75.095, -90]; shell.velocity = [0, -29.81, -90];
    const before = structuredClone(shell); view.update(sim, camera, true); bombs.getMatrixAt(0, matrix);
    expect(matrix.elements[14]).toBeCloseTo(-88.5, 4); expect(matrix.elements[13]).toBeGreaterThan(shell.position[1]);
    expect(shell).toEqual(before); expect(bombs.count).toBe(bombs.instanceMatrix.count);
    sim.shells.length = 0; view.update(sim, camera, true);
    expect(view.diagnostics().bombs).toBe(0); expect([...bombs.instanceMatrix.array].every(n => n === 0)).toBe(true);
  } finally { effects.dispose(); await view.dispose(); }
});

test('fold joints retain full-size geometry and independent per-plane poses across every LOD', async () => {
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const scene = new Group(), wing = new Group();
    wing.userData = { nodeId: 'wing.fold.port', foldAxis: [0, 0, -1], foldAngleDegrees: 90 };
    wing.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial())); scene.add(wing);
    return { scene } as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
  });
  const view = new AircraftView();
  try {
    await view.load();
    const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
    const planes = sim.player.airWing!.planes;
    for (const plane of sim.aircraft) plane.phase = 'lost';
    planes.slice(0, 2).forEach((plane, i) => { plane.phase = 'ready'; plane.deckSlot = i; });
    planes[0].wingFold = .5; planes[1].wingFold = 1;
    const carrier = new Group(); carrier.updateMatrixWorld(true);
    const roots = new Map([['player', carrier]]), camera = new PerspectiveCamera();
    for (const distance of [40, 220, 600]) {
      camera.position.set(0, distance, -90); view.update(sim, camera, true, true, roots);
      const batch = view.root.children.find(c => c instanceof InstancedMesh && c.name.startsWith('Aircraft model ') && drawCount(c) === 2) as InstancedMesh;
      expect(batch).toBeDefined();
      for (let i = 0; i < 2; i++) {
        const actual = new Matrix4(); batch.getMatrixAt(i, actual);
        const expected = new Matrix4().makeTranslation(...aircraftDeckSpot(sim.player, planes[i]))
          .multiply(new Matrix4().makeRotationX(aircraftGroundPose(planes[i].modelId).pitch))
          .multiply(new Matrix4().makeRotationZ(-planes[i].wingFold * Math.PI / 2));
        actual.elements.forEach((value, n) => expect(value).toBeCloseTo(expected.elements[n], 4));
        expect(new Vector3().setFromMatrixColumn(actual, 0).length()).toBeCloseTo(1, 5);
      }
    }
  } finally { await view.dispose(); loader.mockRestore(); }
});

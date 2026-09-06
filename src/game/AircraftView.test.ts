import { expect, spyOn, test } from 'bun:test';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AircraftView } from './AircraftView';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { aircraftDeckSpot } from '../simulation/aircraft';

test('port renders only the player deck, follows its displayed pose, and retains parked battle aircraft', async () => {
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
    expect(view.diagnostics().instances).toBe(18);
    const firstBatch = view.root.children.find(c => c instanceof InstancedMesh && c !== view.root.children[1] && c.count > 0) as InstancedMesh;
    const matrix = new Matrix4(); firstBatch.getMatrixAt(0, matrix);
    const spot = aircraftDeckSpot(sim.player, sim.player.airWing!.planes[0]);
    const expected = carrier.matrixWorld.clone().multiply(new Matrix4().makeTranslation(...spot));
    matrix.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i], 3));
    sim.player.airWing!.planes[0].phase = 'lost';
    view.update(sim, camera, true, true, roots); expect(view.diagnostics().instances).toBe(17);
    view.update(sim, camera, true, false, roots); expect(view.diagnostics().instances).toBe(35);
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

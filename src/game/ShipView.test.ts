import { expect, test } from 'bun:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { CombatSimulation } from '../simulation/combat';
import { compileShip } from '../ships/blueprint';
import { ShipView } from './ShipView';

test('Baltimore exported hierarchy binds all 21 muzzles through train, pitch and recoil', async () => {
  const source = await Bun.file(new URL('../../assets/ships/baltimore/blueprint.json', import.meta.url)).json();
  const bytes = await Bun.file(new URL('../../public/models/baltimore.glb', import.meta.url)).arrayBuffer();
  const chunkLength = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(compileShip(source, catalog));
  const view = new ShipView(model.scene, sim.definition, sim.player);
  expect(view.muzzleErrors()).toHaveLength(21);
  for (const train of [-2.3, 0, 2.3]) {
    for (const elevation of [-.08, .35, .7]) {
      Object.assign(sim.player.motion, { x: 534, y: -1.2, z: -294, heading: 1.3, roll: -.07, pitch: .04 });
      sim.player.mounts.forEach(m => Object.assign(m, { train, elevation, recoil: .75 }));
      view.update();
      expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
    }
  }
});

test('actual exported joints follow authoritative muzzle positions through rear traverse and recoil', async () => {
  const bytes = await Bun.file(new URL('../../public/models/bismarck.glb', import.meta.url)).arrayBuffer();
  const chunkLength = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
  // Load the real exported hierarchy without GPU geometry or texture decoding.
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const simulation = new CombatSimulation(compileShip(blueprint, catalog));
  const view = new ShipView(model.scene, simulation.definition, simulation.player);
  for (const train of [-.7, 0, .7]) {
    Object.assign(simulation.player.motion, { x: 122, y: -2, z: -876, heading: .8, roll: .08, pitch: -.04 });
    simulation.player.mounts.forEach(m => Object.assign(m, { train, elevation: .2, recoil: .6 }));
    view.update();
    expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
  }
});

test('Enterprise single and quadruple exported guns align at their traverse and elevation limits', async () => {
  const enterprise = await Bun.file(new URL('../../assets/ships/enterprise-cv6/blueprint.json', import.meta.url)).json();
  const bytes = await Bun.file(new URL('../../public/models/enterprise-cv6.glb', import.meta.url)).arrayBuffer();
  const chunkLength = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(compileShip(enterprise, catalog));
  const view = new ShipView(model.scene, sim.definition, sim.player);
  expect(view.muzzleErrors()).toHaveLength(54);
  const stableIds = new Set<string>();
  model.scene.traverse(o => { if (o.userData.nodeId) stableIds.add(o.userData.nodeId); });
  for (const id of ['elevator-forward.lift', 'elevator-middle.lift', 'elevator-aft.lift', 'rudder.yaw', 'radar-cxam.yaw']) {
    expect(stableIds.has(id)).toBe(true);
  }
  for (const trainFraction of [-1, 0, 1]) for (const elevationFraction of [0, .5, 1]) for (const recoil of [0, 1]) {
    Object.assign(sim.player.motion, { x: 581, y: -1.3, z: -763, heading: 2.7, roll: -.13, pitch: .07 });
    sim.player.mounts.forEach((state, i) => {
      const w = sim.definition.mounts[i].weapon;
      Object.assign(state, {
        train: trainFraction * w.traverseDeg * Math.PI / 180,
        elevation: (w.elevationMinDeg + (w.elevationMaxDeg - w.elevationMinDeg) * elevationFraction) * Math.PI / 180,
        recoil,
      });
    });
    view.update();
    expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
  }
});

test('Yamato center and outer barrels remain aligned through fore and aft traverse, elevation and recoil', async () => {
  const yamato = await Bun.file(new URL('../../assets/ships/yamato/blueprint.json', import.meta.url)).json();
  const bytes = await Bun.file(new URL('../../public/models/yamato.glb', import.meta.url)).arrayBuffer();
  const chunkLength = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(compileShip(yamato, catalog));
  const view = new ShipView(model.scene, sim.definition, sim.player);
  expect(view.muzzleErrors()).toHaveLength(15);
  for (const train of [-2.4, 0, 2.4]) {
    for (const elevation of [-.08, .35, .78]) {
      Object.assign(sim.player.motion, { x: -287, y: -.7, z: 399, heading: 1.4, roll: -.09, pitch: .06 });
      sim.player.mounts.forEach(m => Object.assign(m, { train, elevation, recoil: .8 }));
      view.update();
      expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
    }
  }
});

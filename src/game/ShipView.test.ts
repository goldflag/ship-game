import { expect, test } from 'bun:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { CombatSimulation } from '../simulation/combat';
import { compileShip } from '../ships/blueprint';
import { ShipView } from './ShipView';
import { shipPreset } from '../ships/presets';

test('a turret disabled during a tick stops its rendered traverse and elevation immediately', async () => {
  const bytes = await Bun.file(new URL('../../public/models/baltimore.glb', import.meta.url)).arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(shipPreset('baltimore'));
  const view = new ShipView(model.scene, sim.definition, sim.player);
  const mount = sim.player.mounts[0], definition = sim.definition.mounts[0];
  view.capturePreviousPose();
  sim.step({ throttle: 0, rudder: 0 }, { aim: [5000, 100, 0], fire: false, battery: 'main' });
  expect(mount.train).not.toBe(0);
  // A hit lands after gun training in this same fixed tick.
  mount.hp = 0; mount.status = 'disabled';
  const joints = new Map<string, typeof model.scene>();
  model.scene.traverse(node => { if (node.userData.nodeId) joints.set(node.userData.nodeId, node as typeof model.scene); });
  const yaw = joints.get(`${definition.id}.yaw`)!;
  const elevation = joints.get(`${definition.id}.left.elevation`)!;
  const expectedTrain = -(definition.bearingDeg * Math.PI / 180 + mount.train);
  for (const alpha of [0, .25, .75, 1]) {
    view.update(alpha);
    expect(yaw.rotation.y).toBeCloseTo(expectedTrain, 10);
    expect(elevation.rotation.x).toBeCloseTo(mount.elevation, 10);
  }
  for (let tick = 0; tick < 120; tick++) {
    view.capturePreviousPose();
    sim.step({ throttle: 1, rudder: 1 }, { aim: [-5000, 0, 500], fire: true, battery: 'main' });
    view.update(.5);
    expect(yaw.rotation.y).toBeCloseTo(expectedTrain, 10);
  }
});

for (const id of ['liberty-cargo', 'liberty-collier', 'victory-cargo', 'flower-corvette']) {
  test(`${id}: exported guns follow full train/elevation/recoil and preserve appendage pivots`, async () => {
    const source=await Bun.file(`assets/ships/${id}/blueprint.json`).json();
    const bytes=await Bun.file(`public/models/${id}.glb`).arrayBuffer();
    const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,new DataView(bytes).getUint32(12,true))));
    const nodes=gltf.nodes.map(({mesh:_mesh,...node}:{mesh?:number})=>node);
    const model=await new GLTFLoader().parseAsync(JSON.stringify({asset:gltf.asset,scene:gltf.scene,scenes:gltf.scenes,nodes}),'');
    const sim=new CombatSimulation(compileShip(source,catalog)),view=new ShipView(model.scene,sim.definition,sim.player);
    const stableIds=new Set<string>();model.scene.traverse(o=>{if(o.userData.nodeId)stableIds.add(o.userData.nodeId);});
    for(const node of ['hull.surface','propeller-main.pivot','rudder-main.pivot'])expect(stableIds.has(node)).toBe(true);
    expect(view.muzzleErrors()).toHaveLength(sim.definition.mounts.reduce((n,m)=>n+(m.weapon.barrelCount??2),0));
    for(const train of [-1,0,1])for(const elevation of [0,.5,1])for(const recoil of [0,1]) {
      Object.assign(sim.player.motion,{x:123,y:-.7,z:-461,heading:2.6,roll:.09,pitch:-.035});
      sim.player.mounts.forEach((m,i)=>{const w=sim.definition.mounts[i].weapon;Object.assign(m,{train:train*w.traverseDeg*Math.PI/180,elevation:(w.elevationMinDeg+(w.elevationMaxDeg-w.elevationMinDeg)*elevation)*Math.PI/180,recoil});});
      view.update();expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
    }
  });
}

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

test('fleet exteriors defer inspection geometry until a ship is inspected', async () => {
  const { ShipInspection } = await import('./ShipInspection');
  const inspection = new ShipInspection(compileShip(blueprint, catalog));
  expect(inspection.entries.length).toBeGreaterThan(0);
  expect(inspection.root.children).toHaveLength(0);
  inspection.setMode('exterior');
  expect(inspection.root.children).toHaveLength(0);
  inspection.setMode('armor');
  expect(inspection.root.children.length).toBeGreaterThan(0);
  const children = [...inspection.root.children];
  inspection.setMode('exterior');
  expect(inspection.root.visible).toBe(false);
  inspection.setMode('internals');
  expect(inspection.root.children).toEqual(children);
});

test('fleet meshes reuse materials within each ship while inspection stays independent', async () => {
  const { Group, Mesh, BoxGeometry, MeshStandardMaterial } = await import('three/webgpu');
  const definition = compileShip(blueprint, catalog);
  // A mount-free fixture isolates material ownership from the separately tested joints.
  const fixture = { ...definition, mounts: [] };
  const sim = new CombatSimulation(fixture);
  const model = new Group(), source = new MeshStandardMaterial({ opacity: .9 });
  model.add(new Mesh(new BoxGeometry(), source), new Mesh(new BoxGeometry(), source));
  const a = new ShipView(model.clone(true), fixture, sim.player);
  const b = new ShipView(model.clone(true), fixture, sim.target);
  const materials = (view: ShipView) => (view.root.children[0].children as InstanceType<typeof Mesh>[]).map(mesh => mesh.material);
  expect(materials(a)[0]).toBe(materials(a)[1]);
  expect(materials(a)[0]).not.toBe(materials(b)[0]);
  a.inspect(true);
  expect((materials(a)[0] as InstanceType<typeof MeshStandardMaterial>).opacity).toBe(.16);
  expect((materials(b)[0] as InstanceType<typeof MeshStandardMaterial>).opacity).toBe(.9);
  expect(source.opacity).toBe(.9);
  a.inspect(false);
  expect((materials(a)[0] as InstanceType<typeof MeshStandardMaterial>).opacity).toBe(.9);
});

test('VIIC dive planes, rudders and screws use the retained pivot hierarchy underwater', async () => {
  const source = await Bun.file(new URL('../../assets/ships/type-viic/blueprint.json', import.meta.url)).json();
  const bytes = await Bun.file(new URL('../../public/models/type-viic.glb', import.meta.url)).arrayBuffer();
  const chunkLength = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(compileShip(source, catalog));
  const view = new ShipView(model.scene, sim.definition, sim.player);
  Object.assign(sim.ship, { y: -50, pitch: -.08, heading: .8, rudder: .5, speed: 2, distance: 30 });
  sim.player.submarine!.planes = .7;
  view.update();
  expect(view.root.position.y).toBe(-50);
  expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
  const joints: Record<string, number> = {};
  model.scene.traverse(o => {
    if (o.userData.nodeId === 'bow-plane-port.pivot') joints.bow = o.rotation.x;
    if (o.userData.nodeId === 'stern-plane-port.pivot') joints.stern = o.rotation.x;
    if (o.userData.nodeId === 'rudder-port.pivot') joints.rudder = o.rotation.y;
    if (o.userData.nodeId === 'propeller-port.pivot') joints.propeller = o.rotation.z;
  });
  expect(joints.bow).toBeCloseTo(-.7 * 20 * Math.PI / 180);
  expect(joints.stern).toBeCloseTo(.7 * 20 * Math.PI / 180);
  expect(joints.rudder).toBeCloseTo(-.5 * 35 * Math.PI / 180);
  expect(Math.abs(joints.propeller)).toBeGreaterThan(.1);
});

test('Fletcher gun and torpedo joints follow interpolated CPU poses on both broadsides and after reset', async () => {
  const source = await Bun.file(new URL('../../assets/ships/fletcher/blueprint.json', import.meta.url)).json();
  const bytes = await Bun.file(new URL('../../public/models/fletcher.glb', import.meta.url)).arrayBuffer();
  const chunkLength = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(compileShip(source, catalog)), view = new ShipView(model.scene, sim.definition, sim.player);
  expect(view.muzzleErrors()).toHaveLength(13); expect(view.torpedoMuzzleErrors()).toHaveLength(10);
  for (const train of [-2.44, 0, 2.44, 3.12, -3.12]) {
    view.capturePreviousPose();
    sim.player.torpedoLaunchers!.forEach(l => l.train = train);
    sim.player.mounts.forEach(m => Object.assign(m, { train, elevation: .8, recoil: .6 }));
    Object.assign(sim.ship, { x: 384, z: -240, heading: 1.4, roll: .07, pitch: -.03 });
    for (const alpha of [0, .25, .5, .75, 1]) {
      view.update(alpha);
      expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
      expect(Math.max(...view.torpedoMuzzleErrors())).toBeLessThan(.025);
    }
  }
  sim.reset(); view.snap();
  expect(Math.max(...view.torpedoMuzzleErrors())).toBeLessThan(.025);
});

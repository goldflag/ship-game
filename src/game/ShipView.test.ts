import { expect, test } from 'bun:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { CombatSimulation } from '../simulation/combat';
import { compileShip } from '../ships/blueprint';
import { ShipView } from './ShipView';
import { shipPreset } from '../ships/presets';
import { gunTraverseAtFraction, gunTraverseLimitsDeg } from '../ships/armament';
import * as THREE from 'three/webgpu';

test('Cleveland exported joints retain asymmetric wing travel and independent neighboring poses during interpolation', async () => {
  const definition = shipPreset('cleveland');
  const bytes = await Bun.file('public/models/cleveland.glb').arrayBuffer();
  const length = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(definition), view = new ShipView(model.scene, definition, sim.player);
  expect(view.muzzleErrors()).toHaveLength(67);
  const joint = (id: string) => { let result: THREE.Object3D | undefined; model.scene.traverse(o => { if (o.userData.nodeId === id) result = o; }); return result!; };
  for (const fraction of [-1, -.5, 0, .5, 1]) for (const elevation of [0, .5, 1]) {
    view.capturePreviousPose();
    sim.player.mounts.forEach((state, i) => {
      const m = definition.mounts[i], w = m.weapon;
      state.train = gunTraverseAtFraction(m, i % 2 ? -fraction : fraction);
      state.elevation = (w.elevationMinDeg + elevation * (w.elevationMaxDeg - w.elevationMinDeg)) * Math.PI / 180;
      state.recoil = i % 2 ? .8 : .2;
    });
    for (const alpha of [0, .35, .7, 1]) {
      view.update(alpha);
      expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
      for (const m of definition.mounts.filter(m => m.traverseLimitsDeg)) {
        const train = -joint(`${m.id}.yaw`).rotation.y - m.bearingDeg * Math.PI / 180;
        const [low, high] = gunTraverseLimitsDeg(m).map(n => n * Math.PI / 180);
        expect(train).toBeGreaterThanOrEqual(low - 1e-6);
        expect(train).toBeLessThanOrEqual(high + 1e-6);
      }
    }
  }
});

test('Iowa exported blast bags keep fixed seams and follow gun collars through interpolated elevation', async () => {
  const definition = shipPreset('iowa');
  const model = await new GLTFLoader().parseAsync(await Bun.file('public/models/iowa.glb').arrayBuffer(), '');
  const sim = new CombatSimulation(definition), view = new ShipView(model.scene, definition, sim.player);
  const nodes = new Map<string, THREE.Object3D>(), covers: THREE.Mesh[] = [];
  model.scene.traverse(o => {
    if (o.userData.nodeId) nodes.set(o.userData.nodeId, o);
    if (o instanceof THREE.Mesh && o.userData.gunCoverElevationId) covers.push(o);
  });
  expect(covers).toHaveLength(9);
  sim.player.mounts.forEach(m => { m.elevation = 0; });
  view.snap(); view.root.updateMatrixWorld(true);
  const seams = covers.map(mesh => {
    const elevation = nodes.get(mesh.userData.gunCoverElevationId)!;
    const fixed: { index: number; position: THREE.Vector3 }[] = [], collar: number[] = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const p = mesh.getVertexPosition(i, new THREE.Vector3());
      if (mesh.geometry.morphAttributes.position!.every(a => new THREE.Vector3().fromBufferAttribute(a, i).length() < 1e-7)) fixed.push({ index: i, position: p.clone() });
      elevation.worldToLocal(mesh.localToWorld(p));
      if (Math.abs(p.z + 6.91 - 3.657) < .003 && Math.abs(Math.hypot(p.x, p.y) - .647) < .003) collar.push(i);
    }
    expect(fixed.length).toBeGreaterThanOrEqual(40); expect(collar.length).toBeGreaterThanOrEqual(40);
    return { mesh, elevation, fixed, collar };
  });
  for (const degrees of [2.5, 11, 22.5, 38, 45]) {
    view.capturePreviousPose();
    sim.player.mounts.forEach((m, i) => {
      if (i < 3) Object.assign(m, { elevation: degrees * Math.PI / 180, recoil: i / 2 });
    });
    for (const alpha of [.37, 1]) {
      view.update(alpha); view.root.updateMatrixWorld(true);
      for (const { mesh, elevation, fixed, collar } of seams) {
        for (const { index, position } of fixed) expect(mesh.getVertexPosition(index, new THREE.Vector3()).distanceTo(position)).toBeLessThan(1e-6);
        for (const index of collar) {
          const p = elevation.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(index, new THREE.Vector3())));
          expect(Math.abs(p.z + 6.91 - 3.657)).toBeLessThan(.01);
          expect(Math.abs(Math.hypot(p.x, p.y) - .647)).toBeLessThan(.01);
        }
      }
      expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
    }
  }
});

test('Iowa exported roof AA inherits turret train while aiming and recoiling independently', async () => {
  const definition = shipPreset('iowa');
  const bytes = await Bun.file('public/models/iowa.glb').arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(definition), view = new ShipView(model.scene, definition, sim.player);
  const child = definition.mounts.findIndex(m => m.parentMountId === 'main-3');
  expect(child).toBeGreaterThan(0);
  expect(view.muzzleErrors()).toHaveLength(99);
  for (const train of [-1, -.6, -.17, .31, .78, 1]) for (const elevation of [0, .5, 1]) for (const recoil of [0, 1]) {
    view.capturePreviousPose();
    Object.assign(sim.player.motion, { x: 143, y: -.8, z: -672, heading: 2.1, roll: -.11, pitch: .07 });
    sim.player.mounts.forEach((state, i) => {
      const w = definition.mounts[i].weapon;
      Object.assign(state, { train: train * (i % 2 ? -1 : 1) * w.traverseDeg * Math.PI / 180,
        elevation: (w.elevationMinDeg + (w.elevationMaxDeg - w.elevationMinDeg) * elevation) * Math.PI / 180, recoil: i === child ? 1 - recoil : recoil });
    });
    for (const alpha of [0, .37, 1]) {
      view.update(alpha);
      expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
    }
    // Renderer interpolation must not become the simulation's authoritative frame.
    expect(sim.player.mounts[child].carrier).toBeUndefined();
  }
});

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

test('Baltimore exported hierarchy binds all 69 main, DP and Bofors muzzles through train, pitch and recoil', async () => {
  const source = await Bun.file(new URL('../../assets/ships/baltimore/blueprint.json', import.meta.url)).json();
  const bytes = await Bun.file(new URL('../../public/models/baltimore.glb', import.meta.url)).arrayBuffer();
  const chunkLength = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, chunkLength)));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(compileShip(source, catalog));
  const view = new ShipView(model.scene, sim.definition, sim.player);
  expect(view.muzzleErrors()).toHaveLength(69);
  for (const train of [-2.3, 0, 2.3]) {
    for (const elevation of [-.08, .35, .7, 85 * Math.PI / 180]) {
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
  expect(view.muzzleErrors()).toHaveLength(39);
  for (const train of [-2.4, 0, 2.4]) {
    for (const elevation of [-.08, .35, .78, 85 * Math.PI / 180]) {
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
  // A joint-free fixture isolates material ownership from the separately tested articulation.
  const fixture = { ...definition, mounts: [], rig: undefined };
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

test('launcher IDs bind reordered battle snapshots and bounded interpolation stays inside travel stops', async () => {
  const def = shipPreset('yukikaze');
  const bytes = await Bun.file('public/models/yukikaze.glb').arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const sim = new CombatSimulation(def);
  sim.player.torpedoLaunchers!.reverse(); // Rust's sorted snapshot order differs from the blueprint.
  for (const state of sim.player.torpedoLaunchers!) {
    state.train = def.torpedoLaunchers!.find(l => l.id === state.id)!.traverseLimitsDeg![1] * Math.PI / 180;
  }
  const view = new ShipView(model.scene, def, sim.player);
  const joints = new Map<string, typeof model.scene>();
  model.scene.traverse(node => { if (node.userData.nodeId) joints.set(node.userData.nodeId, node as typeof model.scene); });
  expect(Math.max(...view.torpedoMuzzleErrors())).toBeLessThan(.001);
  view.capturePreviousPose();
  sim.player.torpedoLaunchers!.reverse();
  sim.player.torpedoLaunchers!.forEach(l => { l.train *= -1; });
  for (const alpha of [0, .25, .5, .75, 1]) {
    view.update(alpha);
    for (const l of def.torpedoLaunchers!) {
      const limit = l.traverseLimitsDeg![1] * Math.PI / 180;
      expect(joints.get(`${l.id}.yaw`)!.rotation.y).toBeCloseTo(-limit * (1 - 2 * alpha), 10);
    }
    expect(Math.max(...view.torpedoMuzzleErrors())).toBeLessThan(.001);
  }
  sim.reset(); view.snap();
  expect(Math.max(...view.torpedoMuzzleErrors())).toBeLessThan(.001);
});

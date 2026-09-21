import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { ShipInspection } from './ShipInspection';

test('armor surfaces share draws while exact plate picking, isolation, colors and turret poses remain available', () => {
  const definition = shipPreset('bismarck'), sim = new CombatSimulation(definition), inspection = new ShipInspection(definition);
  const entries = new Map(inspection.entries.map(entry => [entry.id, entry]));
  const fills = () => inspection.root.children.filter(group => group.userData.inspectionId && group.visible)
    .map(group => group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>);
  const drawn = () => {
    const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
    inspection.root.traverseVisible(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    return meshes;
  };
  inspection.setMode('armor'); inspection.update(sim.player); inspection.root.updateMatrixWorld(true);
  expect(fills().length).toBeGreaterThan(500);
  expect(drawn().length).toBeLessThanOrEqual(definition.mounts.length + 1);
  for (const train of [-.7, 1.3]) {
    sim.player.mounts.forEach(mount => mount.train = train);
    inspection.update(sim.player); inspection.root.updateMatrixWorld(true);
    for (const batch of drawn()) {
      const mount = entries.get(batch.parent!.userData.inspectionId)!.mountIndex;
      const members = fills().filter(fill => entries.get(fill.parent!.userData.inspectionId)!.mountIndex === mount);
      const expected = new THREE.Vector3(), actual = new THREE.Vector3(), color = new THREE.Color();
      let vertex = 0, positionError = 0, colorError = 0;
      for (const fill of members) {
        const positions = fill.geometry.attributes.position, index = fill.geometry.index;
        for (let i = 0; i < (index?.count ?? positions.count); i++, vertex++) {
          expected.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(fill.matrixWorld);
          actual.fromBufferAttribute(batch.geometry.attributes.position, vertex).applyMatrix4(batch.matrixWorld);
          positionError = Math.max(positionError, actual.distanceTo(expected));
          color.fromBufferAttribute(batch.geometry.attributes.color, vertex);
          colorError = Math.max(colorError, Math.abs(color.r - fill.material.color.r), Math.abs(color.g - fill.material.color.g), Math.abs(color.b - fill.material.color.b));
        }
      }
      expect(vertex).toBe(batch.geometry.attributes.position.count);
      expect(positionError).toBeLessThan(.001); expect(colorError).toBeLessThan(.000001);
    }
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(-40, 0, 0), new THREE.Vector3(1, 0, 0));
  const id = inspection.pick(ray)!.id;
  expect(id).toBe('armor:port-main-belt-2');
  const colors = drawn().map(mesh => Array.from(mesh.geometry.attributes.color.array));
  inspection.setHovered(id);
  expect(drawn().map(mesh => Array.from(mesh.geometry.attributes.color.array))).not.toEqual(colors);
  inspection.setHovered(undefined);
  expect(drawn().map(mesh => Array.from(mesh.geometry.attributes.color.array))).toEqual(colors);
  inspection.setMode('armor', id); inspection.update(sim.player);
  expect(drawn()).toEqual(fills()); expect(drawn()).toHaveLength(1);
  expect(inspection.pick(ray)!.id).toBe(id);
  inspection.setMode('internals'); inspection.update(sim.player);
  expect(drawn()).toEqual(fills());
  inspection.setMode('armor'); inspection.update(sim.player);
  expect(drawn().length).toBeLessThanOrEqual(definition.mounts.length + 1);
});

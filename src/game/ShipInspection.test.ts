import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { ShipInspection } from './ShipInspection';

test('port inspection picks, highlights and isolates both triangles of an authored hull panel together', () => {
  const definition = shipPreset('valiant');
  const first = definition.armor.find(a => a.plate?.surfaceId?.startsWith('hull:port:') && a.plate.vertices.length === 3)!;
  const halves = definition.armor.filter(a => a.plate?.surfaceId === first.plate!.surfaceId);
  expect(halves).toHaveLength(2);
  const before = JSON.stringify(definition.armor);
  const inspection = new ShipInspection(definition), sim = new CombatSimulation(definition);
  const panels = inspection.entries.filter(e => e.plate?.surfaceId === first.plate!.surfaceId);
  expect(panels).toHaveLength(1);
  const panel = panels[0];
  expect(panel.plate!.vertices).toHaveLength(4);
  inspection.setMode('armor', panel.id); inspection.update(sim.player);
  const group = inspection.root.children.find(g => g.userData.inspectionId === panel.id)!;
  const fill = group.children[0] as THREE.Mesh;
  const outline = group.children[1] as THREE.LineSegments;
  for (const half of halves) {
    const [a, b, c] = half.plate!.vertices.map(p => new THREE.Vector3(...p));
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const center = a.clone().add(b).add(c).divideScalar(3);
    const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, 2), normal.negate());
    expect(inspection.pick(ray)?.id).toBe(panel.id);
    // The original outside triangles still lie on the rendered hull.
    const hit = ray.intersectObject(fill, false)[0];
    expect(hit.point.distanceTo(center)).toBeLessThan(.0001);
  }
  inspection.setHovered(panel.id);
  expect(outline.visible).toBe(true);
  // Four perimeter edges on each face and four thickness edges, no diagonal.
  expect(outline.geometry.getAttribute('position').count).toBe(24);
  expect(inspection.root.children.filter(g => g.visible && g.userData.inspectionId)).toEqual([group]);
  expect(JSON.stringify(definition.armor)).toBe(before);
});

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

test('the port isolates a whole armor zone or equipment group at once', () => {
  const definition = shipPreset('bismarck'), sim = new CombatSimulation(definition), inspection = new ShipInspection(definition);
  const visible = () => inspection.root.children.filter(group => group.visible && group.userData.inspectionId).map(group => group.userData.inspectionId as string).sort();
  const belt = inspection.entries.filter(entry => /main belt/i.test(entry.name)).map(entry => entry.id);
  expect(belt.length).toBeGreaterThan(1);
  inspection.setMode('armor', belt); inspection.update(sim.player);
  expect(visible()).toEqual([...belt].sort());
  expect(inspection.selectedIds.size).toBe(belt.length);
  expect(inspection.selectedId).toBeUndefined();
  // Only isolated volumes answer the pointer, and ids from another view are ignored.
  const other = inspection.entries.find(entry => entry.kind === 'armor' && !belt.includes(entry.id))!.id;
  inspection.setHovered(other); expect(inspection.hoveredId).toBeUndefined();
  inspection.setHovered(belt[0]); expect(inspection.hoveredId).toBe(belt[0]);
  const magazines = inspection.entries.filter(entry => entry.kind === 'magazine').map(entry => entry.id);
  inspection.setMode('internals', [...magazines, belt[0]]); inspection.update(sim.player);
  expect(visible()).toEqual([...magazines].sort());
  inspection.setMode('internals'); inspection.update(sim.player);
  expect(inspection.selectedIds.size).toBe(0);
  expect(visible().length).toBeGreaterThan(magazines.length);
});

import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { hashKey, portholeTable, registerPortholes, releasePortholes, WEEP } from './portholeWeeps';

/** Look a plan point up as the shader does: every porthole whose cells hold it. */
function lookup(table: NonNullable<ReturnType<typeof portholeTable>>, x: number, z: number): number[] {
  const key = (Math.floor(z / WEEP.cell) + 2048) * 1024 + Math.floor(x / WEEP.cell) + 512 + 1, mask = table.keys.length - 1, found: number[] = [];
  for (let slot = hashKey(key) & mask, probe = 0; probe < WEEP.probes && table.keys[slot]; slot = (slot + 1) & mask, probe++) if (table.keys[slot] === key) found.push(table.entries[slot]);
  return found;
}

test('a porthole table finds each weeping porthole from the wall below it, and nothing far off', () => {
  // A row of 60 scuttles along a starboard side, 1.2 m apart; a merged duplicate pane at the first.
  const list: number[] = [];
  for (let i = 0; i < 60; i++) list.push(8, 5, -40 + 1.2 * i, .15, 1, 0);
  list.push(8.02, 5, -40, .15, 1, 0);
  const table = portholeTable(list)!;
  const count = table.portholes.length / 8;
  expect(count).toBeGreaterThan(30); expect(count).toBeLessThan(60);
  expect(portholeTable(list)!.portholes).toEqual(table.portholes);
  expect(table.keys.length & (table.keys.length - 1)).toBe(0);
  for (let i = 0; i < count; i++) {
    const [x, , z, , , , length, strength] = table.portholes.slice(i * 8, i * 8 + 8);
    expect(length).toBeGreaterThanOrEqual(WEEP.length[0]); expect(length).toBeLessThanOrEqual(WEEP.length[1]);
    expect(strength).toBeGreaterThanOrEqual(WEEP.strength[0]);
    // The wall below, a little in board of the pane on a tumblehome side.
    expect(lookup(table, x - .2, z)).toContain(i + 1);
  }
  expect(lookup(table, 0, 0)).toEqual([]);
  expect(portholeTable([])).toBeUndefined();
});

test('a template registers its table, marks its still paint with it and gives it back', () => {
  const list: number[] = [];
  for (let i = 0; i < 20; i++) list.push(-6, 3, 1.5 * i, .12, -1, 0);
  const worn = (amount: number) => { const g = new THREE.BoxGeometry(); g.setAttribute('shipWear', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 4).fill(amount), 4)); return new THREE.Mesh(g); };
  const template = () => {
    const root = new THREE.Group(), hull = worn(.4), glass = worn(0), turret = worn(.4), yaw = new THREE.Group();
    yaw.userData.nodeId = 'anton.yaw'; yaw.add(turret); root.add(hull, glass, yaw);
    return { root, hull, glass, turret };
  };
  const a = template(), b = template();
  registerPortholes(a.root, list); registerPortholes(b.root, list);
  const ta = a.root.userData.portholeWeeps, tb = b.root.userData.portholeWeeps;
  expect(ta).toBeGreaterThan(0); expect(tb).not.toBe(ta);
  const x = (mesh: THREE.Mesh) => mesh.geometry.getAttribute('shipWear').getX(0);
  expect(x(a.hull)).toBeCloseTo(.4 + 2 * ta, 5);
  expect(x(a.hull) - 2 * Math.floor(x(a.hull) / 2)).toBeCloseTo(.4, 5);
  // Unworn paint and a surface on a joint carry no table.
  expect(x(a.glass)).toBe(0); expect(x(a.turret)).toBeCloseTo(.4, 5);
  // A ship at sea is a clone of its template and finds the same table.
  expect(a.root.clone().userData.portholeWeeps).toBe(ta);
  releasePortholes(a.root);
  expect(a.root.userData.portholeWeeps).toBeUndefined();
  const c = template(); registerPortholes(c.root, list);
  expect(c.root.userData.portholeWeeps).toBe(ta);
  releasePortholes(b.root); releasePortholes(c.root);
});

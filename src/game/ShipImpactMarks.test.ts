import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import type { CombatEvent } from '../simulation/combat';
import { impactStyle, MAX_SHIP_IMPACT_MARKS, ShipImpactMarks } from './ShipImpactMarks';

const event = (sequence = 1): CombatEvent => ({ sequence, tick: sequence, kind: 'penetration', shipId: 'target',
  position: [0, 0, 1], message: 'Test strike', shell: { id: sequence, caliberM: .38, type: 'AP', velocity: [0, 0, -820] },
  impact: { position: [0, 0, 1], normal: [0, 0, 1], direction: [.2, 0, -1], outcome: 'penetration' } });

function fixture(mounted = false) {
  const root = new THREE.Group(), model = new THREE.Group(), mount = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 2), new THREE.MeshStandardMaterial());
  root.add(model); model.add(mount); mount.add(receiver);
  const marks = new ShipImpactMarks(root, model, new Map(mounted ? [['turret', mount]] : []));
  return { root, mount, receiver, marks };
}

test('caliber, ammunition and penetration select distinct wound size and material', () => {
  const small = impactStyle(.15, 'AP', 'penetration'), big = impactStyle(.46, 'AP', 'penetration');
  expect(big.width / small.width).toBeCloseTo(.46 / .15);
  expect(impactStyle(.38, 'AP', 'stopped').tile).not.toBe(impactStyle(.38, 'AP', 'penetration').tile);
  expect(impactStyle(.38, 'HE', 'stopped').tile).toBe(3);
  expect(impactStyle(.38, 'HE', 'penetration').width).toBeGreaterThan(impactStyle(.38, 'AP', 'penetration').width);
  expect(impactStyle(.38, 'AP', 'ricochet').width).toBeGreaterThan(impactStyle(.38, 'AP', 'ricochet').height * 2);
});

test('decals conform to the struck face, remain depth-tested and batch repeated salvos', () => {
  const { marks, receiver } = fixture();
  try {
    marks.update([event(), event(2)], 'target');
    expect(marks.count).toBe(2); expect(marks.drawCalls).toBe(1);
    const batch = receiver.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const positions = batch.geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBeCloseTo(1);
    expect(batch.material.depthTest).toBe(true); expect(batch.material.depthWrite).toBe(false);
    marks.update([event(), event(2)], 'target'); expect(marks.count).toBe(2);
    marks.setVisible(false); expect(batch.visible).toBe(false);
    marks.setVisible(true); expect(batch.visible).toBe(true);
  } finally { marks.dispose(); }
});

test('mount-local hits follow rendered turret articulation and the hull pose', () => {
  const { root, mount, receiver, marks } = fixture(true), strike = event();
  strike.impact!.mountId = 'turret';
  root.position.set(280, -3, 190); root.rotation.set(.1, 1.3, -.12, 'YXZ');
  mount.position.set(0, 10, -60); mount.rotation.y = 1.1;
  try {
    marks.update([strike], 'target'); expect(marks.count).toBe(1);
    const batch = receiver.children[0] as THREE.Mesh;
    const vertex = new THREE.Vector3().fromBufferAttribute(batch.geometry.getAttribute('position'), 0);
    root.updateMatrixWorld(true);
    const before = batch.localToWorld(vertex.clone());
    mount.rotation.y -= .7; root.position.x += 30; root.updateMatrixWorld(true);
    expect(batch.localToWorld(vertex.clone()).distanceTo(before)).toBeGreaterThan(10);
    expect(batch.localToWorld(vertex.clone()).distanceTo(receiver.localToWorld(vertex.clone()))).toBeLessThan(1e-6);
  } finally { marks.dispose(); }
});

test('interior events, other ships and unmatched surfaces cannot leave floating marks', () => {
  const { marks } = fixture();
  try {
    const interior = { ...event(), kind: 'module', impact: undefined } as CombatEvent;
    const miss = event(3); miss.impact!.position = [200, 0, 1];
    marks.update([interior, { ...event(2), shipId: 'player' }, miss], 'target');
    expect(marks.count).toBe(0); expect(marks.drawCalls).toBe(0);
  } finally { marks.dispose(); }
});

test('plate winding does not hide port-side strikes or exit wounds', () => {
  const { marks, receiver } = fixture();
  try {
    const strike = event(); strike.impact!.position = [0, 0, -1];
    marks.update([strike], 'target'); expect(marks.count).toBe(1);
    const positions = (receiver.children[0] as THREE.Mesh).geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBeCloseTo(-1);
  } finally { marks.dispose(); }
});

test('the mark budget evicts old geometry, and clear permits a fresh battle sequence', () => {
  const { marks, receiver } = fixture();
  try {
    marks.update(Array.from({ length: MAX_SHIP_IMPACT_MARKS + 20 }, (_, i) => event(i + 1)), 'target');
    expect(marks.count).toBe(MAX_SHIP_IMPACT_MARKS); expect(marks.drawCalls).toBe(1);
    marks.clear(); expect(marks.count).toBe(0); expect(receiver.children).toHaveLength(0);
    marks.update([event()], 'target'); expect(marks.count).toBe(1);
  } finally { marks.dispose(); }
});

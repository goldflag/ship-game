import { expect, test } from 'bun:test';
import { BoxGeometry, Euler, Group, Mesh, Quaternion } from 'three/webgpu';
import { ObservedShipViews } from './ObservedShipViews';
import type { ObservedShip } from './session/BattleSession';

test('a remote ship report gives the chart an exterior but cannot reveal it to another ship camera', () => {
  const views = new ObservedShipViews();
  const template = new Group(); template.name = 'Public recognition model';
  views.setModels(new Map([['fletcher', template]]));
  const report: ObservedShip = { id: 'contact-0-1', presetId: 'fletcher', position: [1000, 0, -2000], heading: 0, velocity: [0, 0, -10], observedTick: 120, observers: ['forward-destroyer'] };
  views.update([report], 150, true, 'rear-carrier');
  expect(views.root.children).toHaveLength(1);
  const exterior = views.root.children[0];
  expect(exterior.visible).toBe(false);
  views.update([report], 150, true, 'forward-destroyer');
  expect(exterior.visible).toBe(true);
  expect(exterior.position.toArray()).toEqual([1000, 0, -2001]);
  views.update([report], 150, true);
  expect(exterior.visible).toBe(true);
  views.update([], 180, true);
  expect(views.root.children).toHaveLength(0);
  expect(template.parent).toBeNull();
});

const report = (overrides: Partial<ObservedShip> = {}): ObservedShip => ({
  id: 'contact-0-1', presetId: 'fletcher', position: [0, 0, 0], heading: 0,
  velocity: [0, 0, -10], observedTick: 0, observers: ['forward-destroyer'], ...overrides,
});
const renderer = () => {
  const views = new ObservedShipViews();
  views.setModels(new Map([['fletcher', new Group()]]));
  return views;
};

test('measured report corrections move and turn over render frames, including between worker snapshots', () => {
  const views = renderer();
  views.update([report()], 0, true, undefined, 1 / 60);
  const exterior = views.root.children[0];
  const next = report({ position: [20, 0, -20], heading: Math.PI / 2, observedTick: 60 });
  const wire = JSON.stringify(next);
  views.update([next], 60, true, undefined, 1 / 60);
  expect(exterior.position.x).toBeGreaterThan(0);
  expect(exterior.position.x).toBeLessThan(4);
  expect(exterior.rotation.y).toBeLessThan(0);
  expect(exterior.rotation.y).toBeGreaterThan(-Math.PI / 12);
  const first = exterior.position.x;
  views.update([next], 60, true, undefined, 1 / 60);
  expect(exterior.position.x).toBeGreaterThan(first);
  expect(exterior.position.x).toBeLessThan(7);
  for (let frame = 0; frame < 180; frame++) views.update([next], 60, true, undefined, 1 / 60);
  expect(exterior.position.x).toBeCloseTo(20, 2);
  expect(exterior.rotation.y).toBeCloseTo(-Math.PI / 2, 3);
  expect(JSON.stringify(next)).toBe(wire);
});

test('report heading follows the short turn across north and smoothing is frame-rate independent', () => {
  const sample = (fps: number) => {
    const views = renderer();
    views.update([report({ heading: Math.PI - .02 })], 0, true, undefined, 0);
    const next = report({ heading: -Math.PI + .02, position: [20, 0, -20], observedTick: 60 });
    for (let frame = 0; frame < fps; frame++) views.update([next], 60, true, undefined, 1 / fps);
    const exterior = views.root.children[0];
    expect(exterior.quaternion.angleTo(new Quaternion().setFromEuler(new Euler(0, Math.PI - .02, 0, 'YXZ')))).toBeLessThan(.001);
    return [exterior.position.x, exterior.rotation.y];
  };
  const slow = sample(30), fast = sample(120);
  slow.forEach((n, i) => expect(n).toBeCloseTo(fast[i], 10));
});

test('paused reports stay still, extrapolation stays bounded, and removed observations disappear immediately', () => {
  const views = renderer();
  views.update([report()], 0, true, undefined, 0);
  const exterior = views.root.children[0];
  views.update([report()], 600, true, undefined, 0);
  expect(exterior.position.toArray()).toEqual([0, 0, 0]);
  for (let frame = 0; frame < 180; frame++) views.update([report()], 600, true, undefined, 1 / 60);
  expect(exterior.position.z).toBeGreaterThanOrEqual(-1);
  expect(exterior.position.z).toBeCloseTo(-1, 2);
  views.update([], 600, true, undefined, 0);
  expect(views.root.children).toHaveLength(0);
  views.update([report({ position: [500, 0, 0], observedTick: 600 })], 600, true, undefined, 0);
  expect(views.root.children[0].position.toArray()).toEqual([500, 0, 0]);
});

test('a visible exterior offers an overhead label anchor above the hull; a hidden one offers none', () => {
  const views = new ObservedShipViews();
  const template = new Group();
  const mesh = new Mesh(new BoxGeometry(20, 30, 200)); mesh.position.y = 15; template.add(mesh);
  views.setModels(new Map([['fletcher', template]]));
  const sighting = report({ position: [1000, 0, -2000], observers: ['forward-destroyer'] });
  views.update([sighting], 0, true, 'forward-destroyer', 0);
  const anchor = views.labelAnchor('contact-0-1')!;
  expect(anchor.x).toBeCloseTo(1000, 3); expect(anchor.z).toBeCloseTo(-2000, 3);
  // Top of the measured hull plus clearance, whatever pose the root later takes.
  expect(anchor.y).toBeCloseTo(35, 3);
  views.update([sighting], 0, true, 'rear-carrier', 0);
  expect(views.labelAnchor('contact-0-1')).toBeUndefined();
  views.update([sighting], 0, false, 'forward-destroyer', 0);
  expect(views.labelAnchor('contact-0-1')).toBeUndefined();
  expect(views.labelAnchor('nobody')).toBeUndefined();
});

import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { GunAimIndicators, projectGunAim } from './GunAimIndicators';
import type { GunAimPoint } from './gunAim';

class Element {
  children: Element[] = [];
  className = ''; textContent = ''; hidden = false;
  style: Record<string, string> = {};
  offsetWidth = 100; offsetHeight = 19;
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.append(child); }
  setAttribute() {}
  remove() {}
}

function withIndicators(run: (overlay: GunAimIndicators, camera: PerspectiveCamera, marks: () => Element[]) => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
  const host = new Element(), overlay = new GunAimIndicators(host as unknown as HTMLElement);
  const camera = new PerspectiveCamera(2 * Math.atan(Math.tan(52 * Math.PI / 360) / 16) * 180 / Math.PI, 1.6, .25, 60000);
  camera.updateMatrixWorld();
  overlay.resize(1440, 900);
  try { run(overlay, camera, () => host.children[0].children.filter(mark => !mark.hidden)); }
  finally {
    overlay.dispose();
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

const point = (id: string, x: number, status: GunAimPoint['status'] = 'ready'): GunAimPoint => ({
  id, number: Number(id), name: `Turret ${id}`, point: [x, 0, -1000], status,
  aligned: status === 'ready', reload: 0,
});
const position = (mark: Element) => mark.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
const projected = (aim: GunAimPoint, camera: PerspectiveCamera) => projectGunAim(new Vector3(...aim.point), camera, 1440, 900);

test('scope circles damp snapshot jitter and settle promptly without overshoot or changing gun data', () => withIndicators((overlay, camera, marks) => {
  const ship = {};
  overlay.update([point('1', 0)], camera, true, 1 / 60, ship);
  const xs: number[] = [];
  for (let frame = 0; frame < 120; frame++) {
    // Small alternating corrections in the interpolated barrel solution become
    // visible pixel jumps at high magnification, even with a stationary sight.
    const aim = point('1', frame % 2 ? -.5 : .5), before = JSON.stringify(aim);
    overlay.update([aim], camera, true, 1 / 60, ship);
    expect(JSON.stringify(aim)).toBe(before);
    if (frame > 30) xs.push(position(marks()[0])[0]);
  }
  const rawWidth = projected(point('1', .5), camera).x - projected(point('1', -.5), camera).x;
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(rawWidth * .3);

  const aim = point('1', 5, 'blocked'), target = projected(aim, camera).x;
  let previous = position(marks()[0])[0];
  for (let frame = 0; frame < 24; frame++) {
    overlay.update([aim], camera, true, 1 / 60, ship);
    const x = position(marks()[0])[0];
    expect(x).toBeGreaterThanOrEqual(previous);
    expect(x).toBeLessThanOrEqual(target + .005);
    expect(marks()[0].className).toContain('gun-aim-blocked');
    previous = x;
  }
  expect(Math.abs(previous - target)).toBeLessThan(1);
}));

test('circle smoothing uses elapsed time and does not delay camera pan or zoom', () => {
  const positions: number[] = [];
  for (const fps of [30, 60, 144]) withIndicators((overlay, camera, marks) => {
    const ship = {};
    overlay.update([point('1', 0)], camera, true, 1 / fps, ship);
    for (let frame = 0; frame < fps / 2; frame++) overlay.update([point('1', 5)], camera, true, 1 / fps, ship);
    positions.push(position(marks()[0])[0]);
  });
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(.01);

  withIndicators((overlay, camera, marks) => {
    const ship = {}, aim = point('1', 3);
    overlay.update([aim], camera, true, 1 / 60, ship);
    camera.position.x = 5; camera.lookAt(10, 1, -1000);
    camera.fov *= .5; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    overlay.update([aim], camera, true, 1 / 60, ship);
    const screen = projected(aim, camera), [x, y] = position(marks()[0]);
    expect(x).toBeCloseTo(screen.x, 2); expect(y).toBeCloseTo(screen.y, 2);
  });
});

test('circles retain turret identity when groups split or reorder and clear history when hidden or replaced', () => withIndicators((overlay, camera, marks) => {
  const ship = {};
  overlay.update([point('1', 0), point('2', 0)], camera, true, 1 / 60, ship);
  expect(marks()).toHaveLength(1);
  overlay.update([point('2', 0, 'blocked'), point('1', 10)], camera, true, 1 / 60, ship);
  expect(marks()).toHaveLength(2);
  expect(position(marks()[0])[0]).toBe(720);
  expect(position(marks()[1])[0]).toBeGreaterThan(720);
  expect(position(marks()[1])[0]).toBeLessThan(projected(point('1', 10), camera).x - 1);
  const movingX = position(marks()[1])[0];
  overlay.update([point('1', 10), point('2', 0, 'blocked')], camera, true, 1 / 60, ship);
  expect(position(marks()[0])[0]).toBeGreaterThan(movingX + 1);
  expect(position(marks()[1])[0]).toBe(720);

  overlay.update([], camera, false, 1 / 60, ship);
  overlay.update([point('1', -10)], camera, true, 1 / 60, ship);
  expect(position(marks()[0])[0]).toBeCloseTo(projected(point('1', -10), camera).x, 2);
  overlay.update([point('1', 10)], camera, true, 1 / 60, {});
  expect(position(marks()[0])[0]).toBeCloseTo(projected(point('1', 10), camera).x, 2);
  // Switching away from guns removes their histories, even if the overlay stays visible.
  overlay.update([], camera, true, 1 / 60, ship);
  overlay.update([point('1', 0)], camera, true, 1 / 60, ship);
  expect(position(marks()[0])[0]).toBe(720);
}));

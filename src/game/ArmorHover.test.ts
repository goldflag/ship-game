import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three/webgpu';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { ShipInspection } from './ShipInspection';
import { ArmorHover, type ArmorHoverInfo } from './ArmorHover';

const globals = ['window', 'document'] as const;
let originals: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: new EventTarget() }));
});
afterEach(() => globals.forEach((name, i) => {
  if (originals[i]) Object.defineProperty(globalThis, name, originals[i]!); else Reflect.deleteProperty(globalThis, name);
}));

test('port hover clears during dragging, HUD occlusion, inspection exit and disposal', () => {
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
    setAttribute() {}, removeAttribute() {},
  }) as unknown as HTMLCanvasElement;
  let front: Element = canvas;
  Object.assign(document, { elementFromPoint: () => front });
  const camera = new PerspectiveCamera(52, 4 / 3, .5, 1000);
  camera.position.set(-40, 0, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), inspection = new ShipInspection(def);
  inspection.setMode('armor'); inspection.update(sim.player);
  const hover = new ArmorHover(canvas, camera), updates: (ArmorHoverInfo | null)[] = [];
  hover.subscribe(value => updates.push(value));
  const move = (buttons = 0) => canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 210, clientY: 170, buttons }));
  move(); hover.update(inspection);
  expect(updates.at(-1)?.entry.id).toBe('armor:port-main-belt-2');
  expect(updates.at(-1)?.x).toBe(210);
  const count = updates.length;
  hover.update(inspection);
  expect(updates.length).toBe(count);
  move(1); hover.update(inspection);
  expect(updates.at(-1)).toBeNull();
  expect(inspection.hoveredId).toBeUndefined();
  move(); hover.update(inspection);
  front = {} as Element; hover.update(inspection);
  expect(updates.at(-1)).toBeNull();
  front = canvas; hover.update(inspection);
  expect(inspection.hoveredId).toBe('armor:port-main-belt-2');
  hover.update(undefined);
  expect(inspection.hoveredId).toBeUndefined();
  expect(updates.at(-1)).toBeNull();
  hover.update(inspection); hover.dispose();
  expect(updates.at(-1)).toBeNull();
  expect(inspection.hoveredId).toBeUndefined();
  move(); hover.update(inspection);
  expect(inspection.hoveredId).toBeUndefined();
});

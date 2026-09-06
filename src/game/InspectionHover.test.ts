import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three/webgpu';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { ShipInspection } from './ShipInspection';
import { InspectionHover, type InspectionHoverInfo } from './InspectionHover';

const globals = ['window', 'document'] as const;
let originals: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: new EventTarget() }));
});
afterEach(() => globals.forEach((name, i) => {
  if (originals[i]) Object.defineProperty(globalThis, name, originals[i]!); else Reflect.deleteProperty(globalThis, name);
}));

test('port armor hover clears during dragging, HUD occlusion, inspection exit and disposal', () => {
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
  const hover = new InspectionHover(canvas, camera), updates: (InspectionHoverInfo | null)[] = [];
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

test('internals hover prefers the module inside an enclosing compartment and clears with the pointer', () => {
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    setAttribute() {}, removeAttribute() {},
  }) as unknown as HTMLCanvasElement;
  Object.assign(document, { elementFromPoint: () => canvas });
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), inspection = new ShipInspection(def);
  const engine = def.modules.find(m => m.kind === 'engine')!;
  const camera = new PerspectiveCamera(52, 4 / 3, .5, 1000);
  camera.position.set(engine.center[0], engine.center[1] + 60, engine.center[2]); camera.lookAt(...engine.center); camera.updateMatrixWorld();
  inspection.setMode('internals'); inspection.update(sim.player);
  const hover = new InspectionHover(canvas, camera), updates: (InspectionHoverInfo | null)[] = [];
  hover.subscribe(value => updates.push(value));
  canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: 200, clientY: 150, buttons: 0 }));
  hover.update(inspection);
  expect(updates.at(-1)?.entry.id).toBe(`module:${engine.id}`);
  expect(inspection.hoveredId).toBe(`module:${engine.id}`);
  canvas.dispatchEvent(new Event('pointerleave'));
  expect(updates.at(-1)).toBeNull();
  expect(inspection.hoveredId).toBeUndefined();
  hover.dispose();
});

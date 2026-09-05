import { expect, test } from 'bun:test';
import { InputController, type InputActions } from './InputController';

test('Shift taps toggle optics, but Shift-plus only enlarges the chart; pause clears held fire', () => {
  const names = ['window', 'document', 'HTMLElement'] as const;
  const original = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: class {} });
  let optics = 0, chart = 0;
  const actions: InputActions = { pause() {}, camera() {}, recenter() {}, hud() {}, fullscreen() {}, battery() {}, cursor() {}, gunnery() {},
    optics: () => optics++, chartSize: direction => { chart += direction; } };
  const input = new InputController(actions);
  const key = (type: string, code: string, repeat = false) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat }));
  try {
    key('keydown', 'ShiftLeft'); key('keyup', 'ShiftLeft');
    expect(optics).toBe(1);
    key('keydown', 'ShiftLeft'); key('keydown', 'Equal'); key('keyup', 'Equal'); key('keyup', 'ShiftLeft');
    expect(chart).toBe(1);
    expect(optics).toBe(1);
    key('keydown', 'NumpadSubtract'); key('keyup', 'NumpadSubtract');
    expect(chart).toBe(0);
    key('keydown', 'KeyQ');
    expect(input.firing).toBe(true);
    input.setEnabled(false);
    expect(input.firing).toBe(false);
    input.setEnabled(true);
    expect(input.firing).toBe(false);
    key('keydown', 'ShiftLeft'); target.dispatchEvent(new Event('blur')); key('keyup', 'ShiftLeft');
    expect(optics).toBe(1);
  } finally {
    input.dispose();
    names.forEach((name, i) => { if (original[i]) Object.defineProperty(globalThis, name, original[i]!); else Reflect.deleteProperty(globalThis, name); });
  }
});

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { InputController, type InputActions } from './InputController';
import { defaultKeybindings } from './keybindings';

describe('keyboard gameplay controls', () => {
  const originals = Object.fromEntries(['window', 'document', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let events: EventTarget;
  let modal: boolean;
  let input: InputController;
  let actions: Record<keyof InputActions, ReturnType<typeof mock>>;
  function key(type: 'keydown' | 'keyup', code: string, options = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ...options });
    events.dispatchEvent(event);
    return event;
  }
  beforeEach(() => {
    events = new EventTarget(); modal = false;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => modal ? {} : null } });
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: class {} });
    actions = { pause: mock(), camera: mock(), recenter: mock(), hud: mock(), fullscreen: mock(), optics: mock(), battery: mock(), cursor: mock(), chartSize: mock(), gunnery: mock(), shellFollow: mock(), depth: mock(), emergencyBlow: mock(), airOperations: mock() };
    input = new InputController(actions, defaultKeybindings());
  });
  afterEach(() => {
    input.dispose();
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  test('custom engine keys replace defaults and only notch once per press', () => {
    const bindings = defaultKeybindings(); bindings.throttleUp = ['KeyI', 'Numpad8'];
    input.setBindings(bindings);
    key('keydown', 'KeyW'); expect(input.order).toBe(1);
    key('keydown', 'ArrowUp'); expect(input.order).toBe(1);
    expect(key('keydown', 'KeyI').defaultPrevented).toBe(true);
    key('keydown', 'KeyI', { repeat: true }); expect(input.order).toBe(2);
    key('keyup', 'KeyI'); key('keydown', 'Numpad8'); expect(input.order).toBe(3);
    key('keydown', 'Space'); expect(input.order).toBe(1);
  });

  test('custom steering latches one notch per tap while firing clears on release or pause', () => {
    const bindings = defaultKeybindings(); bindings.port = ['KeyJ', null]; bindings.fire = [null, 'KeyL'];
    input.setBindings(bindings);
    key('keydown', 'KeyA'); key('keydown', 'KeyQ');
    expect(input.sample().rudder).toBe(0); expect(input.firing).toBe(false);
    key('keydown', 'KeyJ'); key('keydown', 'KeyL');
    expect(input.sample().rudder).toBe(-.5); expect(input.firing).toBe(true);
    key('keydown', 'KeyJ', { repeat: true }); expect(input.sample().rudder).toBe(-.5);
    key('keyup', 'KeyJ'); key('keyup', 'KeyL');
    expect(input.sample().rudder).toBe(-.5); expect(input.firing).toBe(false);
    key('keydown', 'KeyL'); input.setBindings(defaultKeybindings()); expect(input.firing).toBe(false);
    key('keydown', 'KeyQ'); input.setEnabled(false); expect(input.firing).toBe(false);
    input.setEnabled(true); expect(input.firing).toBe(false);
    expect(input.sample().rudder).toBe(-.5);
    key('keydown', 'KeyD'); key('keyup', 'KeyD'); expect(input.sample().rudder).toBe(0);
    for (let i = 0; i < 5; i++) { key('keydown', 'KeyD'); key('keyup', 'KeyD'); }
    expect(input.sample().rudder).toBe(1);
    input.setRudder(0); expect(input.sample().rudder).toBe(0);
  });

  test('view shortcuts honor custom bindings and keep Esc available', () => {
    const bindings = defaultKeybindings(); bindings.camera = ['KeyV', null];
    input.setBindings(bindings);
    key('keydown', 'KeyC'); expect(actions.camera).not.toHaveBeenCalled();
    key('keydown', 'KeyV'); key('keydown', 'KeyV', { repeat: true });
    expect(actions.camera).toHaveBeenCalledTimes(1);
    input.setEnabled(false); key('keydown', 'KeyV');
    expect(actions.camera).toHaveBeenCalledTimes(1);
    key('keydown', 'Escape'); expect(actions.pause).toHaveBeenCalledTimes(1);
  });
  test('air operations opens once per press and respects remapped controls', () => {
    key('keydown', 'KeyM'); key('keydown', 'KeyM', { repeat: true });
    expect(actions.airOperations).toHaveBeenCalledTimes(1);
    const bindings = defaultKeybindings(); bindings.airOperations = ['KeyV', null]; input.setBindings(bindings);
    key('keydown', 'KeyM'); expect(actions.airOperations).toHaveBeenCalledTimes(1);
    key('keydown', 'KeyV'); expect(actions.airOperations).toHaveBeenCalledTimes(2);
  });

  test('shell follow toggles once per press, supports rebinding and is inactive while paused', () => {
    key('keydown', 'KeyT'); key('keydown', 'KeyT', { repeat: true }); key('keyup', 'KeyT');
    expect(actions.shellFollow).toHaveBeenCalledTimes(1);
    const bindings = defaultKeybindings(); bindings.shellFollow = ['KeyV', null];
    input.setBindings(bindings);
    key('keydown', 'KeyT'); key('keyup', 'KeyT');
    expect(actions.shellFollow).toHaveBeenCalledTimes(1);
    key('keydown', 'KeyV'); key('keyup', 'KeyV');
    expect(actions.shellFollow).toHaveBeenCalledTimes(2);
    input.setEnabled(false); key('keydown', 'KeyV');
    expect(actions.shellFollow).toHaveBeenCalledTimes(2);
  });

  test('Shift taps toggle optics, Shift-plus resizes chart, and Ctrl holds the cursor', () => {
    key('keydown', 'ShiftLeft', { shiftKey: true }); key('keyup', 'ShiftLeft');
    expect(actions.optics).toHaveBeenCalledTimes(1);
    key('keydown', 'ShiftLeft', { shiftKey: true }); key('keydown', 'Equal', { shiftKey: true });
    key('keyup', 'Equal'); key('keyup', 'ShiftLeft');
    expect(actions.chartSize).toHaveBeenLastCalledWith(1);
    expect(actions.optics).toHaveBeenCalledTimes(1);
    key('keydown', 'NumpadSubtract'); key('keyup', 'NumpadSubtract');
    expect(actions.chartSize).toHaveBeenLastCalledWith(-1);
    key('keydown', 'ControlLeft', { ctrlKey: true });
    expect(actions.cursor).toHaveBeenLastCalledWith(true);
    key('keyup', 'ControlLeft'); expect(actions.cursor).toHaveBeenLastCalledWith(false);
    key('keydown', 'ShiftLeft'); events.dispatchEvent(new Event('blur')); key('keyup', 'ShiftLeft');
    expect(actions.optics).toHaveBeenCalledTimes(1);
  });

  test('depth orders notch once, emergency blow is reachable, and pause blocks both', () => {
    key('keydown', 'KeyZ'); key('keydown', 'KeyZ', { repeat: true }); key('keyup', 'KeyZ');
    expect(actions.depth).toHaveBeenCalledTimes(1); expect(actions.depth).toHaveBeenLastCalledWith(1);
    key('keydown', 'KeyX'); key('keyup', 'KeyX'); expect(actions.depth).toHaveBeenLastCalledWith(-1);
    key('keydown', 'KeyB'); key('keyup', 'KeyB'); expect(actions.emergencyBlow).toHaveBeenCalledTimes(1);
    input.setEnabled(false); key('keydown', 'KeyZ'); key('keydown', 'KeyB');
    expect(actions.depth).toHaveBeenCalledTimes(2); expect(actions.emergencyBlow).toHaveBeenCalledTimes(1);
  });

  test('battery, chart and gunnery bindings replace the new HUD defaults', () => {
    const bindings = defaultKeybindings();
    bindings.mainBattery = ['KeyM', null]; bindings.secondaryBattery = ['KeyN', null];
    bindings.chartLarger = ['KeyP', null]; bindings.chartSmaller = ['KeyO', null]; bindings.gunnery = ['KeyV', null];
    input.setBindings(bindings);
    for (const code of ['Digit1', 'Digit2', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'KeyG']) key('keydown', code);
    expect(actions.battery).not.toHaveBeenCalled(); expect(actions.chartSize).not.toHaveBeenCalled(); expect(actions.gunnery).not.toHaveBeenCalled();
    key('keydown', 'KeyM'); expect(actions.battery).toHaveBeenLastCalledWith('main');
    key('keydown', 'KeyN'); expect(actions.battery).toHaveBeenLastCalledWith('secondary');
    key('keydown', 'KeyP'); expect(actions.chartSize).toHaveBeenLastCalledWith(1);
    key('keydown', 'KeyO'); expect(actions.chartSize).toHaveBeenLastCalledWith(-1);
    key('keydown', 'KeyV'); expect(actions.gunnery).toHaveBeenCalledTimes(1);
  });

  test('dialogs and browser shortcuts do not trigger or consume gameplay input', () => {
    modal = true;
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false);
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(actions.pause).not.toHaveBeenCalled(); expect(input.order).toBe(1);
    modal = false;
    expect(key('keydown', 'KeyW', { metaKey: true }).defaultPrevented).toBe(false);
    key('keydown', 'KeyW', { ctrlKey: true }); expect(input.order).toBe(1);
    key('keydown', 'KeyQ'); events.dispatchEvent(new Event('blur')); expect(input.firing).toBe(false);
  });
});

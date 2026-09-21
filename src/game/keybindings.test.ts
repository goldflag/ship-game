import { describe, expect, test } from 'bun:test';
import { bindingError, bindingLabel, defaultKeybindings, isBindableKey, keybindingsOf, keyLabel } from './keybindings';

describe('player keybindings', () => {
  test('older saves gain range controls without taking custom G or L bindings', () => {
    const { rangefind: _rangefind, rangeLock: _rangeLock, ...saved } = defaultKeybindings();
    saved.camera = ['KeyG', null]; saved.fire = ['KeyL', null];
    const loaded = keybindingsOf(saved);
    expect(loaded.camera).toEqual(saved.camera); expect(loaded.fire).toEqual(saved.fire);
    for (const action of ['rangefind', 'rangeLock'] as const) {
      expect(loaded[action][0]).toBeTruthy();
      expect(loaded[action]).not.toContain('KeyG'); expect(loaded[action]).not.toContain('KeyL');
    }
    expect(keybindingsOf(loaded)).toEqual(loaded);
  });
  test('older saves gain shell selection without taking a custom E binding', () => {
    const { shellType: _newAction, ...saved } = defaultKeybindings();
    saved.camera = ['KeyE', null];
    const loaded = keybindingsOf(saved);
    expect(loaded.camera).toEqual(saved.camera);
    expect(loaded.shellType[0]).toBeTruthy();
    expect(loaded.shellType).not.toContain('KeyE');
    expect(keybindingsOf(loaded)).toEqual(loaded);
  });
  test('older saves gain shell follow without losing a custom T binding', () => {
    const { shellFollow: _newAction, ...saved } = defaultKeybindings();
    saved.camera = ['KeyT', null];
    saved.fire = ['KeyK', null];
    const loaded = keybindingsOf(saved);
    expect(loaded.camera).toEqual(saved.camera);
    expect(loaded.fire).toEqual(saved.fire);
    expect(loaded.shellFollow[0]).toBeTruthy();
    expect(loaded.shellFollow).not.toContain('KeyT');
    expect(keybindingsOf(loaded)).toEqual(loaded);
  });
  test('round-trips customized primary and alternate bindings', () => {
    const bindings = defaultKeybindings();
    bindings.throttleUp = ['KeyI', 'Numpad8'];
    bindings.shipDamage = ['KeyV', null];
    bindings.fire = [null, 'KeyK'];
    expect(keybindingsOf(JSON.parse(JSON.stringify(bindings)))).toEqual(bindings);
    expect(bindingLabel(bindings, 'throttleUp')).toBe('I / Num 8');
    expect(bindingLabel(bindings, 'fire')).toBe('K');
  });

  test('rejects conflicts across actions and within alternate slots', () => {
    const bindings = defaultKeybindings();
    expect(bindingError(bindings, 'fire', 0, 'KeyW')).toContain('raise engine order');
    expect(bindingError(bindings, 'throttleUp', 0, 'ArrowUp')).toContain('already assigned');
    expect(bindingError(bindings, 'fire', 0, 'KeyQ')).toBeNull();
    expect(bindingError(bindings, 'fire', 0, 'KeyK')).toBeNull();
  });

  test('keeps every action reachable and reserves menu navigation', () => {
    const bindings = defaultKeybindings();
    expect(bindingError(bindings, 'fire', 0, null)).toContain('at least one key');
    expect(bindingError(bindings, 'throttleUp', 0, null)).toBeNull();
    for (const key of ['Escape', 'Tab', 'Enter', 'MetaLeft', 'F5']) {
      expect(bindingError(bindings, 'fire', 0, key)).not.toBeNull();
    }
  });

  test('recovers from malformed, duplicate, empty, or reserved saved controls', () => {
    const defaults = defaultKeybindings();
    for (const saved of [null, [], 'bad', { fire: [] }, { fire: [null, null] },
      { fire: ['Escape', null] }, { fire: ['KeyW', null] }, { fire: [23, null] }]) {
      expect(keybindingsOf(saved)).toEqual(defaults);
    }
    expect(keybindingsOf({ fire: ['KeyK', null] }).fire).toEqual(['KeyK', null]);
    const changed = defaultKeybindings();
    changed.fire[0] = 'KeyK';
    expect(defaultKeybindings().fire[0]).toBe('KeyQ');
  });
});

test('older saves gain ship damage inspection without taking a custom I binding', () => {
  const { shipDamage: _newAction, ...saved } = defaultKeybindings();
  saved.camera = ['KeyI', null];
  const loaded = keybindingsOf(saved);
  expect(loaded.camera).toEqual(saved.camera);
  expect(loaded.shipDamage[0]).toBeTruthy();
  expect(loaded.shipDamage).not.toContain('KeyI');
  expect(keybindingsOf(loaded)).toEqual(loaded);
});

test('older custom controls survive new diving actions even when Z, X and B are taken', () => {
  const { dive: _d, rise: _r, emergencyBlow: _b, ...saved } = defaultKeybindings();
  saved.camera = ['KeyZ', null]; saved.fire = ['KeyX', null]; saved.recenter = ['KeyB', null];
  const loaded = keybindingsOf(saved);
  expect(loaded.camera).toEqual(saved.camera); expect(loaded.fire).toEqual(saved.fire); expect(loaded.recenter).toEqual(saved.recenter);
  expect(loaded.dive).not.toContain('KeyZ'); expect(loaded.rise).not.toContain('KeyX'); expect(loaded.emergencyBlow).not.toContain('KeyB');
  expect(keybindingsOf(loaded)).toEqual(loaded);
});

test('older saves gain depth charges without taking an existing custom 4 binding', () => {
  const saved: Partial<ReturnType<typeof defaultKeybindings>> = defaultKeybindings();
  delete saved.weaponGroup4; saved.fire = ['Digit4', null];
  const result = keybindingsOf(saved);
  expect(result.fire).toEqual(['Digit4', null]);
  expect(result.weaponGroup4[0]).not.toBe('Digit4');
  expect(result.weaponGroup4[0]).not.toBeNull();
  expect(keybindingsOf(result)).toEqual(result);
});

test('older saves gain periscope without taking a custom P binding', () => {
  const { periscope: _newAction, ...saved } = defaultKeybindings();
  saved.camera = ['KeyP', null];
  const loaded = keybindingsOf(saved);
  expect(loaded.camera).toEqual(saved.camera);
  expect(loaded.periscope[0]).toBeTruthy();
  expect(loaded.periscope).not.toContain('KeyP');
  expect(keybindingsOf(loaded)).toEqual(loaded);
});

test('older saves gain the simulation speed key without taking a custom N binding', () => {
  const { simulationSpeed: _newAction, ...saved } = defaultKeybindings();
  saved.camera = ['KeyN', null];
  const loaded = keybindingsOf(saved);
  expect(loaded.camera).toEqual(saved.camera);
  expect(loaded.simulationSpeed[0]).toBeTruthy();
  expect(loaded.simulationSpeed).not.toContain('KeyN');
  expect(keybindingsOf(loaded)).toEqual(loaded);
});

test('older saves gain surface and deep-dive shortcuts without taking custom U or J keys', () => {
  const { surface: _surface, dive50: _dive50, ...saved } = defaultKeybindings();
  saved.camera = ['KeyU', null]; saved.fire = ['KeyJ', null];
  const loaded = keybindingsOf(saved);
  expect(loaded.camera).toEqual(saved.camera);
  expect(loaded.fire).toEqual(saved.fire);
  for (const action of ['surface', 'dive50'] as const) {
    expect(loaded[action][0]).toBeTruthy();
    expect(loaded[action]).not.toContain('KeyU');
    expect(loaded[action]).not.toContain('KeyJ');
  }
  expect(keybindingsOf(loaded)).toEqual(loaded);
});

test('retired gunnery bindings are discarded while other saved controls survive', () => {
  const saved = { ...defaultKeybindings(), gunnery: ['KeyG', null] };
  saved.fire = ['KeyK', null];
  const loaded = keybindingsOf(saved);
  expect(loaded.fire).toEqual(['KeyK', null]);
  expect(loaded).not.toHaveProperty('gunnery');
  expect(bindingError(loaded, 'fire', 0, 'KeyG')).toContain('measure target range');
});

test('older saves gain the helm wheel on Tab, and Tab is bindable while other menu keys stay reserved', () => {
  const { helmWheel: _helmWheel, ...saved } = defaultKeybindings();
  const loaded = keybindingsOf(saved);
  expect(loaded.helmWheel).toEqual(['Tab', null]);
  expect(keybindingsOf(loaded)).toEqual(loaded);
  expect(isBindableKey('Tab')).toBe(true);
  expect(isBindableKey('Enter')).toBe(false);
  expect(isBindableKey('Escape')).toBe(false);
  expect(keyLabel('Tab')).toBe('Tab');
});

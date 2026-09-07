import { describe, expect, test } from 'bun:test';
import { bindingError, bindingLabel, defaultKeybindings, keybindingsOf } from './keybindings';

describe('player keybindings', () => {
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
    saved.fire = ['KeyL', null];
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
    bindings.fire = [null, 'KeyL'];
    expect(keybindingsOf(JSON.parse(JSON.stringify(bindings)))).toEqual(bindings);
    expect(bindingLabel(bindings, 'throttleUp')).toBe('I / Num 8');
    expect(bindingLabel(bindings, 'fire')).toBe('L');
  });

  test('rejects conflicts across actions and within alternate slots', () => {
    const bindings = defaultKeybindings();
    expect(bindingError(bindings, 'fire', 0, 'KeyW')).toContain('raise engine order');
    expect(bindingError(bindings, 'throttleUp', 0, 'ArrowUp')).toContain('already assigned');
    expect(bindingError(bindings, 'fire', 0, 'KeyQ')).toBeNull();
    expect(bindingError(bindings, 'fire', 0, 'KeyL')).toBeNull();
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
    expect(keybindingsOf({ fire: ['KeyL', null] }).fire).toEqual(['KeyL', null]);
    const changed = defaultKeybindings();
    changed.fire[0] = 'KeyL';
    expect(defaultKeybindings().fire[0]).toBe('KeyQ');
  });
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
  delete saved.depthCharges; saved.fire = ['Digit4', null];
  const result = keybindingsOf(saved);
  expect(result.fire).toEqual(['Digit4', null]);
  expect(result.depthCharges[0]).not.toBe('Digit4');
  expect(result.depthCharges[0]).not.toBeNull();
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
  saved.fire = ['KeyL', null];
  const loaded = keybindingsOf(saved);
  expect(loaded.fire).toEqual(['KeyL', null]);
  expect(loaded).not.toHaveProperty('gunnery');
  expect(bindingError(loaded, 'fire', 0, 'KeyG')).toBeNull();
});

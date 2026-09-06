import { describe, expect, test } from 'bun:test';
import { bindingError, bindingLabel, defaultKeybindings, keybindingsOf } from './keybindings';

describe('player keybindings', () => {
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

test('older saves gain depth charges without taking an existing custom 4 binding', () => {
  const saved: Partial<ReturnType<typeof defaultKeybindings>> = defaultKeybindings();
  delete saved.depthCharges; saved.fire = ['Digit4', null];
  const result = keybindingsOf(saved);
  expect(result.fire).toEqual(['Digit4', null]);
  expect(result.depthCharges[0]).not.toBe('Digit4');
  expect(result.depthCharges[0]).not.toBeNull();
  expect(keybindingsOf(result)).toEqual(result);
});

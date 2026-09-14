import { expect, test } from 'bun:test';
import { finiteFieldValue, snapCoordinate, normalizedBearing } from './editorNumbers';

test('partial and non-finite input does not turn into a source coordinate', () => {
  for (const value of ['', ' ', '-', '1e', 'Infinity', 'NaN', '1001']) expect(finiteFieldValue(value, -500, 500)).toBeUndefined();
  expect(finiteFieldValue('0', -500, 500)).toBe(0);
  expect(finiteFieldValue('-3.25', -500, 500)).toBe(-3.25);
});

test('hull and equipment placement use their own finite snap grid', () => {
  expect(snapCoordinate(3.4, 1)).toBe(3);
  expect(snapCoordinate(3.4, 0.25)).toBe(3.5);
  expect(snapCoordinate(-3.4, 0.25)).toBe(-3.5);
  expect(normalizedBearing(-90)).toBe(270);
  expect(() => snapCoordinate(Infinity, 1)).toThrow();
});

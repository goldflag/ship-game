import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { SHIP_GLYPHS, shipClassFromReport, shipClassOf } from './shipGlyphs';

test('ship classes come from what a hull carries, and reports from observed size', () => {
  expect(shipClassOf(shipPreset('bismarck'))).toBe('battleship');
  expect(shipClassOf(shipPreset('baltimore'))).toBe('cruiser');
  expect(shipClassOf(shipPreset('fletcher'))).toBe('destroyer');
  expect(shipClassOf(shipPreset('enterprise-cv6'))).toBe('carrier');
  expect(shipClassOf(shipPreset('type-viic'))).toBe('submarine');
  expect(shipClassOf(shipPreset('liberty-cargo'))).toBe('auxiliary');
  expect(shipClassFromReport('Large warship')).toBe('battleship');
  expect(shipClassFromReport('Small warship')).toBe('destroyer');
  expect(shipClassFromReport(null)).toBe('cruiser');
  for (const glyph of Object.values(SHIP_GLYPHS)) { expect(glyph.hull).toMatch(/^M/); expect(glyph.mark).toMatch(/^M/); }
});

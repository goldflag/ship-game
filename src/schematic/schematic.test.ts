import { describe, expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import {
  formatLength, SCHEMATIC_DEFAULTS, schematicChoicesOf, schematicDrawingKey, schematicFileName,
} from './options';
import { layOutSchematic, ORTHOGRAPHIC_VIEWS, type Span, type View } from './layout';
import { VIEW_BASES } from './render';

describe('schematic preferences and units', () => {
  test('untrusted saved preferences fall back per field, including prototype property names', () => {
    expect(schematicChoicesOf(null)).toEqual(SCHEMATIC_DEFAULTS);
    expect(schematicChoicesOf({ layout: 'constructor', stock: 'missing', page: 4, units: 'imperial', format: 'webp' }))
      .toEqual({ ...SCHEMATIC_DEFAULTS, units: 'imperial', format: 'webp' });
  });
  test('changing the output format preserves the drawing, while changing units replaces it', () => {
    expect(schematicDrawingKey({ ...SCHEMATIC_DEFAULTS, format: 'webp' } as typeof SCHEMATIC_DEFAULTS))
      .toBe(schematicDrawingKey(SCHEMATIC_DEFAULTS));
    expect(schematicDrawingKey({ ...SCHEMATIC_DEFAULTS, units: 'imperial' })).not.toBe(schematicDrawingKey(SCHEMATIC_DEFAULTS));
    expect(schematicFileName({ ...SCHEMATIC_DEFAULTS, format: 'webp' })).toEndWith('.webp');
  });
  test('imperial dimensions convert the geometry rather than only relabeling it', () => {
    expect(formatLength(30.48, 'imperial')).toBe('100.0 ft');
    expect(formatLength(250.5, 'metric')).toBe('250.5 m');
  });
});

describe('ship projections', () => {
  test('bow is right in side and deck views, and bow/stern elevations face opposite ways', () => {
    const bow = new THREE.Vector3(0, 0, -1), starboard = new THREE.Vector3(1, 0, 0);
    expect(bow.dot(VIEW_BASES.side.right)).toBe(1);
    expect(bow.dot(VIEW_BASES.plan.right)).toBe(1);
    expect(starboard.dot(VIEW_BASES.front.right)).toBe(-1);
    expect(starboard.dot(VIEW_BASES.rear.right)).toBe(1);
    for (const { right, up, forward } of Object.values(VIEW_BASES)) {
      expect(right.length()).toBeCloseTo(1);
      expect(up.length()).toBeCloseTo(1);
      expect(forward.dot(right)).toBeCloseTo(0);
      expect(new THREE.Vector3().crossVectors(right, up).dot(forward)).toBeCloseTo(-1);
    }
  });

  const span = (width: number, height: number): Span => ({ width, height, centerRight: 0, centerUp: 0, near: -125, far: 125 });
  const spans: Record<View, Span> = {
    side: span(250.5, 57.6), plan: span(250.5, 36), front: span(36, 57.6), rear: span(36, 57.6), hero: span(240, 105),
  };
  test('the full hull fits every orthographic frame at one physical scale', () => {
    for (const layout of ['standard', 'fourView'] as const) {
      const sheet = layOutSchematic(spans, layout);
      for (const view of ORTHOGRAPHIC_VIEWS) {
        const box = sheet.views[view]!;
        expect(spans[view].width / sheet.metersPerPixel).toBeLessThan(box.width);
        expect(spans[view].height / sheet.metersPerPixel).toBeLessThan(box.height);
        expect(box.y + box.height + 25).toBeLessThan(860);
      }
      // Equal physical lengths in different projections occupy equal pixel lengths.
      expect(spans.side.width / sheet.metersPerPixel).toBe(spans.plan.width / sheet.metersPerPixel);
      expect(spans.plan.height / sheet.metersPerPixel).toBe(spans.front.width / sheet.metersPerPixel);
    }
  });
  test('showcase has a single independent view and makes no shared-scale claim', () => {
    const sheet = layOutSchematic(spans, 'showcase');
    expect(Object.keys(sheet.views)).toEqual(['hero']);
    expect(sheet.metersPerPixel).toBe(0);
  });
});

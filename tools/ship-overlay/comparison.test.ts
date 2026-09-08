import { describe, expect, test } from 'bun:test';
import { comparisonPanels, views } from './comparison';

describe('synchronized comparison', () => {
  test('both panels cover the canvas equally without overlap at desktop and narrow widths', () => {
    for (const [width, height] of [[1100, 700], [391, 501], [640, 500]]) {
      const [ours, reference] = comparisonPanels(width, height, 'side-by-side');
      expect(ours.width / ours.height).toBe(reference.width / reference.height);
      expect(ours.width * ours.height + reference.width * reference.height).toBe(width * height);
      expect(Math.max(ours.x, reference.x) >= Math.min(ours.x + ours.width, reference.x + reference.width)
        || Math.max(ours.y, reference.y) >= Math.min(ours.y + ours.height, reference.y + reference.height)).toBe(true);
      expect(ours.x).toBe(0);
      expect(reference.y).toBe(0);
    }
    expect(comparisonPanels(1100, 700, 'overlay')).toEqual([{ x: 0, y: 0, width: 1100, height: 700 }]);
  });
  test('all six orthographic faces have unique directions and perpendicular up vectors', () => {
    const faces = views.filter(v => v.name !== 'quarter');
    expect(faces).toHaveLength(6);
    expect(new Set(faces.map(v => v.direction.join(','))).size).toBe(6);
    for (const { direction, up } of faces) {
      expect(direction.reduce((sum, n) => sum + n * n, 0)).toBe(1);
      expect(up.reduce((sum, n) => sum + n * n, 0)).toBe(1);
      expect(direction.reduce((sum, n, i) => sum + n * up[i], 0)).toBe(0);
    }
    expect(faces.find(v => v.name === 'bow')?.direction).toEqual([0, 0, -1]);
    expect(faces.find(v => v.name === 'bottom')?.direction).toEqual([0, -1, 0]);
  });
});

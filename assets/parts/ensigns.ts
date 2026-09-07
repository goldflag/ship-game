import type { EnsignDesign } from '../../src/ships/rig';

/** Original raster recipe; source register is ensigns-sources.md. Units are hoist heights. */
export const ensignAspects: Record<EnsignDesign, number> = { 'us-48': 1.9, 'white-ensign': 2, ijn: 1.5, kriegsmarine: 5 / 3 };
type Point = [number, number];
const white = [239, 235, 218], red = [184, 30, 43], blue = [25, 43, 77], black = [20, 22, 24];

export function rasterEnsign(design: EnsignDesign, height = 256) {
  const aspect = ensignAspects[design], width = Math.round(height * aspect), data = new Uint8Array(width * height * 4);
  const paint = (x: number, y: number, color: number[]) => { const i = (y * width + x) * 4; data.set([...color, 255], i); };
  const shape = (color: number[], contains: (x: number, y: number) => boolean, bounds = [0, 0, aspect, 1]) => {
    for (let y = Math.max(0, Math.floor(bounds[1] * height)); y < Math.min(height, Math.ceil(bounds[3] * height)); y++) {
      for (let x = Math.max(0, Math.floor(bounds[0] * height)); x < Math.min(width, Math.ceil(bounds[2] * height)); x++) {
        if (contains((x + .5) / height, (y + .5) / height)) paint(x, y, color);
      }
    }
  };
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => shape(color, () => true, [x, y, x + w, y + h]);
  const circle = (x: number, y: number, r: number, color: number[]) => shape(color, (a, b) => (a - x) ** 2 + (b - y) ** 2 < r * r, [x - r, y - r, x + r, y + r]);
  const polygon = (points: Point[], color: number[]) => shape(color, (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[i], [bx, by] = points[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }, [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]);
  rect(0, 0, aspect, 1, white);
  if (design === 'us-48') {
    for (let row = 0; row < 13; row += 2) rect(0, row / 13, aspect, 1 / 13, red);
    const w = aspect * .4, h = 7 / 13;
    rect(0, 0, w, h, blue);
    for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) {
      const cx = (col + .5) * w / 8, cy = (row + .5) * h / 6;
      polygon(Array.from({ length: 10 }, (_, i): Point => {
        const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .012 : .031;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      }), white);
    }
  } else if (design === 'white-ensign') {
    // Union canton with counterchanged St Patrick saltire, under St George's cross.
    rect(0, 0, 1, .5, blue);
    shape(white, (x, y) => Math.abs(y - x / 2) < .055 || Math.abs(y - (.5 - x / 2)) < .055, [0, 0, 1, .5]);
    shape(red, (x, y) => {
      const a = y - x / 2, b = y - (.5 - x / 2);
      return (x < .5 ? a > 0 && a < .033 : a < 0 && a > -.033) || (x < .5 ? b > -.033 && b < 0 : b > 0 && b < .033);
    }, [0, 0, 1, .5]);
    rect(.417, 0, .166, .5, white); rect(0, .167, 1, .166, white);
    rect(.45, 0, .1, .5, red); rect(0, .2, 1, .1, red);
    rect(aspect / 2 - 1 / 12, 0, 1 / 6, 1, red); rect(0, .5 - 1 / 12, aspect, 1 / 6, red);
  } else if (design === 'ijn') {
    // Naval disc offset toward the hoist; sixteen rays (the army disc was centered).
    shape(red, (x, y) => Math.cos(Math.atan2(y - .5, x - .5) * 16) >= 0);
    circle(.5, .5, .25, red);
  } else {
    rect(0, 0, aspect, 1, red);
    const cx = .625;
    for (const [thickness, color] of [[.28, black], [.23, white], [.15, black]] as const) {
      rect(cx - thickness / 2, 0, thickness, 1, [...color]); rect(0, .5 - thickness / 2, aspect, thickness, [...color]);
    }
    circle(cx, .5, .365, black); circle(cx, .5, .325, white);
    // Period naval ensign emblem, independently drawn from geometric strokes.
    const stroke = (points: Point[]) => polygon(points.map(([x, y]): Point => [cx + (x - y) / Math.SQRT2, .5 + (x + y) / Math.SQRT2]), black);
    stroke([[-.045, -.235], [.045, -.235], [.045, .235], [-.045, .235]]);
    stroke([[-.235, -.045], [.235, -.045], [.235, .045], [-.235, .045]]);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      stroke([[0, -.235], [.235, -.235], [.235, -.145], [0, -.145]].map(([x, y]): Point => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]));
    }
    // Small Iron Cross in the upper hoist canton.
    for (const [size, color] of [[.14, white], [.118, black]] as const) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      polygon([[-.28, 0], [-.7, -1], [.7, -1], [.28, 0]].map(([x, y]): Point => [.2 + size * (x * Math.cos(a) - y * Math.sin(a)), .19 + size * (x * Math.sin(a) + y * Math.cos(a))]), [...color]);
    }
  }
  // DataTexture UVs start at the bottom; designs above use the familiar top-left origin.
  const flipped = new Uint8Array(data.length), stride = width * 4;
  for (let row = 0; row < height; row++) flipped.set(data.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
  return { data: flipped, width, height };
}

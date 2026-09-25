/** Section cuts for `ship:overlay --sections`: the reference and our published model cut by the same plane, drawn
 * together on a metre grid (reference blue, ours red) with half-breadth differences, so a hull station or a deck
 * plan can be compared line for line instead of by eye from two renders. Replaces the per-ship plancuts.py and
 * wire3.py scratch scripts. Pure geometry and a small PNG writer; the caller supplies both meshes. */
import { deflateSync } from 'node:zlib';
import { planeSegments, sectionHalfBreadth, type Axis, type MeshView, type Point2 } from '../construction/slice';
import type { Box, Vec3 } from '../construction/reference';

export interface SectionSpec { axis: Axis; value: number }
/** `z=-40,y=6.5,x=0`: stations across the hull (z), plans at a height (y), profiles along it (x). */
export function parseSections(text: string): SectionSpec[] {
  return text.split(',').map((item) => {
    const match = /^\s*([xyz])\s*=\s*(-?\d+(?:\.\d+)?)\s*$/.exec(item);
    if (!match) throw new Error(`--sections takes axis=value items such as z=-40,y=6.5,x=0; got "${item}".`);
    return { axis: match[1] as Axis, value: Number(match[2]) };
  });
}

/** Image axes per cut, in runtime terms: stations look forward from astern (starboard right); plans put the bow right
 * and port up, like ship:overlay's top view; profiles put the bow right. Each entry maps a segment point (the two
 * in-plane axes in slice.ts order) to (image right, image up). */
const PICTURE: Record<Axis, { right: string; up: string; map: (p: Point2) => Point2 }> = {
  z: { right: '+x (starboard)', up: '+y', map: ([x, y]) => [x, y] },
  y: { right: '-z (bow)', up: '-x (port)', map: ([x, z]) => [-z, -x] },
  x: { right: '-z (bow)', up: '+y', map: ([z, y]) => [-z, y] },
};
const IN_PLANE: Record<Axis, [number, number]> = { x: [2, 1], y: [0, 2], z: [0, 1] };

/** The cut of a mesh shifted by `offset`, in the plane's two remaining axes. */
export function cut(view: MeshView, spec: SectionSpec, offset: Vec3 = [0, 0, 0], box?: Box): Point2[][] {
  const along = 'xyz'.indexOf(spec.axis);
  const [u, v] = IN_PLANE[spec.axis];
  const local = box && { min: box.min.map((m, i) => m - offset[i]) as Vec3, max: box.max.map((m, i) => m - offset[i]) as Vec3 };
  return planeSegments(view, spec.axis, spec.value - offset[along], local).map((s) => s.map(([a, b]): Point2 => [a + offset[u], b + offset[v]]));
}

export interface SectionDifference {
  /** The height (stations) or z (plans) of the largest half-breadth difference, and that difference (ours − reference). */
  at: number;
  difference: number;
  /** Mean absolute difference over the levels both cuts reach. */
  mean: number;
  levels: number;
}
/** Half-breadths of the two cuts compared every `step` metres along the plane's second axis (height for a station,
 * z for a plan), where both have material. Profiles (x cuts) have no half-breadth. */
export function compareCuts(spec: SectionSpec, reference: Point2[][], ours: Point2[][], step = 0.25): SectionDifference | undefined {
  if (spec.axis === 'x' || !reference.length || !ours.length) return undefined;
  const range = (segs: Point2[][]) => {
    let lo = Infinity, hi = -Infinity;
    for (const s of segs) for (const p of s) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    return [lo, hi];
  };
  const [a0, a1] = range(reference), [b0, b1] = range(ours);
  const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
  let worst: SectionDifference | undefined, sum = 0, n = 0;
  for (let at = Math.ceil(lo / step) * step; at <= hi; at += step) {
    const r = sectionHalfBreadth(reference, at), o = sectionHalfBreadth(ours, at);
    if (!(r > 0 && o > 0)) continue;
    const d = o - r;
    sum += Math.abs(d); n++;
    if (!worst || Math.abs(d) > Math.abs(worst.difference)) worst = { at: round(at), difference: round(d), mean: 0, levels: 0 };
  }
  return worst && { ...worst, mean: round(sum / n), levels: n };
}
const round = (v: number) => Math.round(v * 1000) / 1000;

export interface Drawing { png: Buffer; width: number; height: number; pixelsPerMetre: number; origin: Point2; right: string; up: string }
/** Both cuts on a metre grid (light every metre, darker every five, black through zero): reference blue, ours red. */
export function drawSections(spec: SectionSpec, reference: Point2[][], ours: Point2[][], maxPixels = 2400): Drawing {
  const picture = PICTURE[spec.axis];
  const ref = reference.map((s) => s.map(picture.map));
  const own = ours.map((s) => s.map(picture.map));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of [...ref, ...own]) for (const [x, y] of s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!Number.isFinite(x0)) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
  x0 = Math.floor(x0 - 1); x1 = Math.ceil(x1 + 1); y0 = Math.floor(y0 - 1); y1 = Math.ceil(y1 + 1);
  const ppm = Math.max(4, Math.min(80, Math.floor(maxPixels / Math.max(x1 - x0, y1 - y0))));
  const width = Math.round((x1 - x0) * ppm) + 1, height = Math.round((y1 - y0) * ppm) + 1;
  const rgb = new Uint8Array(width * height * 3).fill(255);
  const px = (x: number) => Math.round((x - x0) * ppm), py = (y: number) => height - 1 - Math.round((y - y0) * ppm);
  const set = (x: number, y: number, c: readonly number[]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    rgb.set(c, (y * width + x) * 3);
  };
  const shade = (m: number) => (m === 0 ? [40, 40, 40] : m % 5 === 0 ? [185, 188, 192] : [228, 230, 233]);
  for (const pass of [1, 5, 0])
    for (let m = x0; m <= x1; m++) {
      if (pass === 1 ? m % 5 === 0 : pass === 5 ? m % 5 !== 0 || m === 0 : m !== 0) continue;
      for (let y = 0; y < height; y++) set(px(m), y, shade(m));
    }
  for (const pass of [1, 5, 0])
    for (let m = y0; m <= y1; m++) {
      if (pass === 1 ? m % 5 === 0 : pass === 5 ? m % 5 !== 0 || m === 0 : m !== 0) continue;
      for (let x = 0; x < width; x++) set(x, py(m), shade(m));
    }
  const line = (a: Point2, b: Point2, c: readonly number[]) => {
    const ax = px(a[0]), ay = py(a[1]), bx = px(b[0]), by = py(b[1]);
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / steps), y = Math.round(ay + ((by - ay) * i) / steps);
      set(x, y, c); set(x + 1, y, c); set(x, y + 1, c);
    }
  };
  for (const s of ref) line(s[0], s[1], [40, 90, 220]);
  for (const s of own) line(s[0], s[1], [215, 40, 40]);
  return { png: encodePng(rgb, width, height), width, height, pixelsPerMetre: ppm, origin: [x0, y0], right: picture.right, up: picture.up };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** An 8-bit RGB PNG. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

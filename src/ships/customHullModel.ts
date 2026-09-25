// Section editing and display helpers. Rust owns solid validity and physical derivation.
import { hullPaintBandsError } from './hullPaintBands';
import { bilgeKeelError, bilgeKeelFaces } from './constructionBilgeKeels';
import type { ConstructionBilgeKeels, ConstructionHullPaintBands, ConstructionPrimitive, ConstructionHullPoint, ConstructionHullStation, Vec3 } from './blueprint';
import { contourAt, contourWeight, hullCreasesError, hullEdgeId, MAX_HULL_POINTS, MAX_HULL_SECTIONS, MIN_HULL_POINTS, MIN_HULL_SECTIONS, outlineTopologyError } from './customHullTopology';
import { endCap, spanCut } from './customHullSpans';
export type Point = ConstructionHullPoint;
export type Station = ConstructionHullStation;
export type Hull = {
  id: string; name: string; length: number; beam: number; depth: number; offset: number;
  bulb: number; rake: number; redPaintY?: number; paintBands?: ConstructionHullPaintBands; bilgeKeels?: ConstructionBilgeKeels;
  /** Port contour positions of crease lines (`customHull.creases`). */
  creases?: number[];
  stations: Station[];
  region: { enabled: boolean; start: number; end: number; low: number; high: number; armor: number; color: string };
};
export const uid = () => crypto.randomUUID().slice(0, 8);
export const clone = <T,>(v: T): T => structuredClone(v);
export function lockSymmetry(h: Hull): Hull {
  const { id, name, length, beam, depth, offset, bulb, rake, redPaintY, paintBands, bilgeKeels, creases, region } = h;
  const stations = h.stations.map(s => {
    const points = s.points.map(p => ({ ...p })), last = points.length - 1, keel = last / 2;
    points[keel].x = 0;
    for (let i = 0; i < keel; i++) points[i] = { ...points[i], x: points[last - i].x ? -points[last - i].x : 0, y: points[last - i].y };
    return { id: s.id, t: s.t, points };
  });
  return { id, name, length, beam, depth, offset, bulb, rake, redPaintY, paintBands, bilgeKeels, ...(creases ? { creases } : {}), region, stations };
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function sectionAt(h: Hull, t: number): Station {
  const ss = h.stations;
  const i = Math.max(0, Math.min(ss.length - 2, ss.findIndex(s => s.t >= t) - 1));
  const j = t >= ss.at(-1)!.t ? ss.length - 2 : i;
  const b = ss[j], c = ss[j + 1];
  const f = Math.max(0, Math.min(1, (t - b.t) / (c.t - b.t)));
  return { id: '', t, points: b.points.map((p, k) => ({
    ...p,
    x: mix(p.x, c.points[k].x, f),
    y: mix(p.y, c.points[k].y, f),
  })) };
}
// Keep existing shaping sections when adding detail. When simplifying, remove
// the section closest to the interpolated profile of its surviving neighbors.
export function setSectionCount(h: Hull, count: number): void {
  if (!Number.isInteger(count) || count < MIN_HULL_SECTIONS || count > MAX_HULL_SECTIONS) throw new Error(`Use a whole section count from ${MIN_HULL_SECTIONS} to ${MAX_HULL_SECTIONS}.`);
  while (h.stations.length < count) {
    let gap = 0;
    for (let i = 1; i < h.stations.length - 1; i++) {
      if (h.stations[i + 1].t - h.stations[i].t > h.stations[gap + 1].t - h.stations[gap].t) gap = i;
    }
    const s = sectionAt(h, (h.stations[gap].t + h.stations[gap + 1].t) / 2);
    s.id = uid(); h.stations.splice(gap + 1, 0, s);
  }
  while (h.stations.length > count) {
    let remove = 1, lowestError = Infinity;
    for (let i = 1; i < h.stations.length - 1; i++) {
      const a = h.stations[i - 1], s = h.stations[i], b = h.stations[i + 1];
      const f = (s.t - a.t) / (b.t - a.t);
      const error = s.points.reduce((sum, p, k) => sum
        + ((p.x - mix(a.points[k].x, b.points[k].x, f)) * h.beam / 2) ** 2
        + ((p.y - mix(a.points[k].y, b.points[k].y, f)) * h.depth) ** 2, 0);
      if (error < lowestError) { lowestError = error; remove = i; }
    }
    h.stations.splice(remove, 1);
  }
}
export function displayPoints(h: Hull, s: Station): Point[] {
  return s.points.map((p, i) => ({ ...p,
    x: p.x + Math.sign(p.x) * contourWeight(s.points, i, [0, 0, 1, 0, 0, 0, 1, 0, 0]) * h.bulb * .38 * Math.exp(-Math.pow((s.t - .055) / .075, 2)),
  }));
}
export const outline = (h: Hull, s: Station): Point[] => displayPoints(h, s);
export function worldPoint(h: Hull, t: number, p: Point): [number, number, number] {
  const rake = h.rake * h.depth * .6 * Math.max(0, .6 - p.y) * Math.exp(-t * 30);
  const bulbForward = h.bulb * h.depth * .7 * Math.exp(-Math.pow((p.y + .24) / .17, 2)) * Math.exp(-t * 35);
  return [h.offset + p.x * h.beam / 2, p.y * h.depth, (t - .5) * h.length + rake - bulbForward];
}
export function sampledStations(h: Hull): Station[] {
  return h.stations;
}
// Reopening a zero-width end must not divide by zero or leave it impossible to edit.
export function resizeSection(s: Station, halfWidth: number) {
  if (Math.abs(halfWidth) < 1e-10) halfWidth = 0;
  const last = s.points.length - 1, keel = last / 2, previous = Math.abs(s.points[last].x);
  const profile = [1, .96, .74, .36, 0, .36, .74, .96, 1];
  s.points.forEach((p, i) => { p.x = i === keel ? 0 : (i < keel ? -1 : 1) * (previous > 1e-10 ? Math.abs(p.x) / previous : contourWeight(s.points, i, profile)) * halfWidth; });
}
/** Re-space each side along its old outline, measuring distance in hull metres.
 * Sample before changing topology so removal does not first cut off a corner.
 * Keep contour identities for panel assignments; deck edges, keel and crease
 * points stay fixed, and the points between them share out that stretch. */
function redistributeOutline(h: Hull, original: Point[], topology: Point[]): Point[] {
  const oldKeel = (original.length - 1) / 2, keel = (topology.length - 1) / 2;
  const next = topology.map(p => ({ ...p }));
  // Port indices of each crease before and after; creases are mirrored, so the reversed starboard side shares them.
  const pins = (h.creases ?? []).map(c => [original.findIndex((_, i) => i > 0 && i < oldKeel && contourAt(original, i) === c), topology.findIndex((_, i) => i > 0 && i < keel && contourAt(topology, i) === c)])
    .filter(([from, to]) => from > 0 && to > 0);
  const anchors = [[0, 0], ...pins, [oldKeel, keel]];
  for (const side of [0, 1]) {
    const source = side ? original.slice(oldKeel).reverse() : original.slice(0, oldKeel + 1);
    const distances = [0];
    for (let i = 1; i < source.length; i++) distances.push(distances[i - 1] + Math.hypot(
      (source[i].x - source[i - 1].x) * h.beam / 2,
      (source[i].y - source[i - 1].y) * h.depth,
    ));
    let edge = 1, anchor = 0;
    for (let i = 0; i <= keel; i++) {
      while (anchor < anchors.length - 2 && anchors[anchor + 1][1] <= i && i !== keel) anchor++;
      const [[fromOld, fromNew], [toOld, toNew]] = [anchors[anchor], anchors[anchor + 1]];
      const pinned = anchors.find(([, to]) => to === i);
      const distance = distances[fromOld] + (distances[toOld] - distances[fromOld]) * (i - fromNew) / (toNew - fromNew);
      while (edge < oldKeel && distances[edge] < distance) edge++;
      const span = distances[edge] - distances[edge - 1];
      const t = span > 0 ? (distance - distances[edge - 1]) / span : 0;
      const point = pinned ? source[pinned[0]] : {
        x: mix(source[edge - 1].x, source[edge].x, t),
        y: mix(source[edge - 1].y, source[edge].y, t),
      };
      Object.assign(next[side ? next.length - 1 - i : i], { x: point.x, y: point.y });
    }
  }
  return next;
}
/** Mark or clear a crease at a selected outline point (either side; creases are mirrored). Deck edges and the keel are
 * already sharp. Returns whether the point is now a crease. */
export function toggleHullCrease(h: Hull, selected: number): boolean {
  const points = h.stations[0].points, last = points.length - 1, port = Math.min(selected, last - selected);
  if (!canCreaseHullPoint(points, selected)) throw new Error('Choose a side point between the deck edge and the keel.');
  const c = contourAt(points, port), creases = h.creases ?? [];
  const next = creases.includes(c) ? creases.filter(v => v !== c) : [...creases, c].sort((a, b) => a - b);
  if (next.length) h.creases = next; else delete h.creases;
  return next.includes(c);
}
export const canCreaseHullPoint = (points: Point[], selected: number) => Number.isInteger(selected) && selected > 0 && selected < points.length - 1 && selected !== (points.length - 1) / 2;
export const isHullCrease = (h: Hull, selected: number) => {
  const points = h.stations[0].points, port = Math.min(selected, points.length - 1 - selected);
  return canCreaseHullPoint(points, selected) && (h.creases ?? []).includes(contourAt(points, port));
};
/** Add a mirrored pair, then redistribute controls around every section. */
export function addHullPointPair(h: Hull, selected: number): number {
  const count = h.stations[0].points.length, last = count - 1, keel = last / 2;
  if (count >= MAX_HULL_POINTS || !Number.isInteger(selected) || selected < 0 || selected > last) throw new Error('Select an outline point; each section supports at most 33 points.');
  const edge = Math.min(selected, last - selected, keel - 1);
  for (const s of h.stations) {
    const points = s.points.map((p, i) => ({ ...p, contour: contourAt(s.points, i) }));
    const midpoint = (i: number) => ({ x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2, contour: (points[i].contour + points[i + 1].contour) / 2 });
    const port = midpoint(edge), starboard = midpoint(last - edge - 1);
    points.splice(last - edge, 0, starboard);
    points.splice(edge + 1, 0, port);
    s.points = redistributeOutline(h, s.points, points);
  }
  return selected > keel ? count - edge : edge + 1;
}
export function canRemoveHullPointPair(points: Point[], selected: number): boolean {
  return points.length > MIN_HULL_POINTS && Number.isInteger(selected) && selected > 0 && selected < points.length - 1 && selected !== (points.length - 1) / 2;
}
export function removeHullPointPair(h: Hull, selected: number): number {
  const points = h.stations[0].points, last = points.length - 1, port = Math.min(selected, last - selected);
  if (!canRemoveHullPointPair(points, selected)) throw new Error('Keep the deck edges, center keel and at least five outline points.');
  for (const s of h.stations) {
    const topology = s.points.map((p, i) => ({ ...p, contour: contourAt(s.points, i) })).filter((_, i) => i !== port && i !== last - port);
    s.points = redistributeOutline(h, s.points, topology);
  }
  if (h.creases) {
    const kept = h.creases.filter(c => h.stations[0].points.some((_, i) => contourAt(h.stations[0].points, i) === c));
    if (kept.length) h.creases = kept; else delete h.creases;
  }
  const nextPort = Math.min(port, (last - 2) / 2 - 1);
  return selected > last / 2 ? last - 2 - nextPort : nextPort;
}
function crosses(a: Point, b: Point, c: Point, d: Point) {
  const orient = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return orient(a, b, c) * orient(a, b, d) < -1e-10 && orient(c, d, a) * orient(c, d, b) < -1e-10;
}
export function invalidReason(h: Hull): string | undefined {
  if (h.bilgeKeels) { const reason = bilgeKeelError(h.bilgeKeels); if (reason) return reason; }
  if (h.paintBands !== undefined) { const reason = hullPaintBandsError(h.paintBands); if (reason) return reason; }
  const topology = outlineTopologyError(h.stations); if (topology) return topology;
  if (![h.length, h.beam, h.depth, h.offset, h.bulb, h.rake].every(Number.isFinite)) return 'Enter a finite dimension.';
  if (h.redPaintY !== undefined && (!Number.isFinite(h.redPaintY) || Math.abs(h.redPaintY) > 500)) return 'Use a red paint Y from −500 to 500 m.';
  if (h.creases !== undefined) { const reason = hullCreasesError(h.creases, h.stations[0].points); if (reason) return reason; }
  if (h.length < 5 || h.length > 500 || h.beam < 1 || h.beam > 100 || h.depth < 1 || h.depth > 60) return 'Use length 5–500 m, beam 1–100 m and depth 1–60 m.';
  for (let i = 1; i < h.stations.length; i++) if (h.stations[i].t - h.stations[i - 1].t < .005) return 'Sections cannot cross or sit less than 0.5% of the hull length apart.';
  for (const s of sampledStations(h)) {
    const last = s.points.length - 1, keel = last / 2;
    if (s.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'Enter finite outline coordinates.';
    if (s.points.slice(0, keel).some(p => p.x > 1e-10) || s.points.slice(keel + 1).some(p => p.x < -1e-10)) return 'Keep each side on its own side of the centerline.';
    if (Math.min(s.points[0].y, s.points[last].y) - s.points[keel].y < .06) return 'The deck must stay above the keel.';
    const p = outline(h, s);
    const area = Math.abs(p.reduce((sum, v, i) => sum + v.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * v.y, 0));
    if (area < 1e-10 && s !== h.stations[0] && s !== h.stations.at(-1)) return 'Only the bow or stern can taper to zero width.';
    for (let a = 0; a < p.length; a++) for (let b = a + 2; b < p.length; b++) {
      if (a === 0 && b === p.length - 1) continue;
      if (crosses(p[a], p[(a + 1) % p.length], p[b], p[(b + 1) % p.length])) return 'The hull outline crosses itself. Move the point back outside the hull.';
    }
  }
  if (h.region.start >= h.region.end || h.region.low >= h.region.high) return 'A surface region needs its start before its end, and its lower edge below its upper edge.';
}
/** Blend reach as a fraction of hull length. At 0.2 an eight-section starter's
 * neighbours followed only 1–4 % of an edit, so blending starts wider. */
export const BLEND_REACH = { initial: .35, min: .08, max: .6 };
export function influence(h: Hull, selected: string[], t: number, soft: boolean, reach = BLEND_REACH.initial): number {
  const chosen = h.stations.filter(s => selected.includes(s.id));
  if (chosen.some(s => Math.abs(s.t - t) < .00001)) return 1;
  if (!soft || !chosen.length) return 0;
  const distance = Math.min(...chosen.map(s => Math.abs(s.t - t)));
  return Math.max(0, 1 - distance / reach) ** 2;
}
/** Section outline in hull metres: x out to starboard, y up from the hull origin. */
export const sectionMetres = (h: Hull, s: Station): Point[] => displayPoints(h, s).map(p => ({ ...p, x: p.x * h.beam / 2, y: p.y * h.depth }));
/** Lowest keel and highest deck in hull metres; heights in the editor count from this base. */
export function hullExtent(h: Hull): { base: number; deck: number } {
  const ys = h.stations.flatMap(s => s.points.map(p => p.y * h.depth));
  return { base: Math.min(...ys), deck: Math.max(...ys) };
}
/** Starboard half-breadth where a horizontal level crosses a section, or undefined when it misses. */
export function breadthAt(points: Point[], level: number): number | undefined {
  let best: number | undefined;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    if ((p.y - level) * (q.y - level) > 0 || p.y === q.y) continue;
    const x = p.x + (q.x - p.x) * (level - p.y) / (q.y - p.y);
    if (best === undefined || x > best) best = x;
  }
  return best;
}

/** Convert the editor draft to the shared versioned construction source. */
export function customHullPrimitive(h: Hull, previous?: ConstructionPrimitive): ConstructionPrimitive {
  return { id: previous?.id ?? h.id, kind: 'custom-hull', size: [h.beam, h.depth, h.length],
    position: previous ? [...previous.position] : [h.offset, 0, 0], rotationDeg: previous?.rotationDeg ?? 0, ...(previous?.tilt ? { tilt: { ...previous.tilt } } : {}),
    customHull: { version: 1, ...(h.paintBands ? { paintBands: clone(h.paintBands) } : {}), ...(h.bilgeKeels ? { bilgeKeels: clone(h.bilgeKeels) } : {}), rake: h.rake, bulb: h.bulb, ...(h.redPaintY !== undefined ? { redPaintY: h.redPaintY } : {}), ...(h.creases?.length ? { creases: [...h.creases] } : {}), stations: clone(h.stations) } };
}
export function editableCustomHull(p: ConstructionPrimitive): Hull {
  if (!p.customHull) throw new Error('Custom hull sections are missing.');
  return { id: p.id, name: 'Custom hull', beam: p.size[0], depth: p.size[1], length: p.size[2],
    region: { enabled: false, start: .25, end: .75, low: .32, high: .7, armor: 200, color: '#9aac9b' },
    ...(p.customHull.paintBands ? { paintBands: clone(p.customHull.paintBands) } : {}),
    ...(p.customHull.bilgeKeels ? { bilgeKeels: clone(p.customHull.bilgeKeels) } : {}),
    ...(p.customHull.creases?.length ? { creases: [...p.customHull.creases] } : {}),
    offset: 0, redPaintY: p.customHull.redPaintY, rake: p.customHull.rake, bulb: p.customHull.bulb, stations: clone(p.customHull.stations) };
}
/** Local display vertices, before the primitive's position and yaw. */
export function customHullPoints(p: ConstructionPrimitive): Vec3[] {
  const h = editableCustomHull(p);
  return h.stations.flatMap(s => outline(h, s).map(point => worldPoint(h, s.t, point)));
}
/** Display-only boundary tessellation matching the native section recipe. */
export function customHullFaces(p: ConstructionPrimitive): { vertices: Vec3[]; group: string }[] {
  const points = customHullPoints(p), count = p.customHull!.stations.length, faces: { vertices: Vec3[]; group: string }[] = [];
  const outline = p.customHull!.stations[0].points, n = outline.length;
  for (let j = 0; j < count - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n;
    const group = i === n - 1 ? '8' : hullEdgeId(contourAt(outline, i), contourAt(outline, i + 1));
    if (i >= (n - 1) / 2 && i < n - 1) faces.push({ vertices: [points[a], points[b], points[d]], group }, { vertices: [points[a], points[d], points[c]], group });
    else faces.push({ vertices: [points[a], points[b], points[c]], group }, { vertices: [points[b], points[d], points[c]], group });
  }
  const stations = p.customHull!.stations, ring = (j: number) => points.slice(j * n, j * n + n);
  for (const [j, span] of [[0, 0], [count - 1, count - 2]]) {
    // An end span the native builder cuts into bands has banded caps; any other keeps the fan.
    const banded = spanCut(ring(span), ring(span + 1), [stations[span].points.map(q => q.y), stations[span + 1].points.map(q => q.y)]).cut === 'bands';
    for (const vertices of endCap(ring(j), j === 0, banded)) faces.push({ vertices, group: j === 0 ? 'bow' : 'stern' });
  }
  return faces;
}

/** Local visual appendages, separate from the buoyant hull and armor panels. */
export function customHullBilgeKeelFaces(h: Hull, cut = 1): Vec3[][] {
  const rings = h.stations.map(s => outline(h,s).map(p => worldPoint(h,s.t,p)));
  // The editor offset belongs to the whole model, not the mirrored keel recipe.
  for (const ring of rings) for (const p of ring) p[0] -= h.offset;
  return bilgeKeelFaces(rings, h.stations.map(s => s.t), h.stations[0].points.map((_,i) => contourAt(h.stations[0].points,i)), h.bilgeKeels, cut)
    .map(face => face.map(p => [p[0]+h.offset,p[1],p[2]]));
}

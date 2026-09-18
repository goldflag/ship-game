import {
  breadthAt,
  clone,
  hullExtent,
  influence,
  resizeSection,
  sectionMetres,
  worldPoint,
  type Hull,
  type Station,
} from "../../ships/customHullModel";
import { contourAt, contourWeight } from "../../ships/customHullTopology";
import type { Vec3 } from "../../ships/blueprint";

/** How far a shape edit spreads: selected sections take all of it, neighbours fade out over `reach`. */
export interface Blend {
  soft: boolean;
  reach: number;
}
/** Sections are at least this far apart (fraction of length), matching the model's validity rule. */
export const STATION_GAP = 0.0051;

const weights = (base: Hull, ids: string[], blend: Blend) =>
  base.stations.map((s) => influence(base, ids, s.t, blend.soft, blend.reach));
const keelOf = (s: Station) => (s.points.length - 1) / 2;

/** Copy point k to its mirror; the keel stays on the centerline. */
export function mirror(s: Station, k: number) {
  const last = s.points.length - 1,
    keel = last / 2;
  if (k === keel) {
    s.points[k].x = 0;
    return;
  }
  const p = s.points[k];
  s.points[last - k] = { ...s.points[last - k], x: -p.x, y: p.y };
}

/** Move point k of every reached section by metres along ship X and Y. */
export function movePoint(
  base: Hull,
  ids: string[],
  blend: Blend,
  k: number,
  dx: number,
  dy: number,
): Hull {
  const next = clone(base),
    w = weights(base, ids, blend);
  next.stations.forEach((s, i) => {
    if (!w[i]) return;
    const p = s.points[k];
    if (k !== keelOf(s)) p.x += (dx / (next.beam / 2)) * w[i];
    p.y += (dy / next.depth) * w[i];
    mirror(s, k);
  });
  return next;
}

/** Slide one section along the hull, stopping short of its neighbours. The ends stay put. */
export function moveStation(base: Hull, id: string, dz: number): Hull {
  const next = clone(base),
    i = next.stations.findIndex((s) => s.id === id);
  if (i <= 0 || i >= next.stations.length - 1) return next;
  const low = next.stations[i - 1].t + STATION_GAP,
    high = next.stations[i + 1].t - STATION_GAP;
  next.stations[i].t = Math.min(
    high,
    Math.max(low, base.stations[i].t + dz / next.length),
  );
  return next;
}

/** Scale reached sections out or in by a deck-edge half-breadth change in metres. */
export function resizeWidth(
  base: Hull,
  ids: string[],
  blend: Blend,
  id: string,
  dHalf: number,
): Hull {
  const next = clone(base),
    reached = ids.includes(id) ? ids : [id],
    w = weights(base, reached, blend);
  next.stations.forEach((s, i) => {
    if (!w[i]) return;
    const last = s.points.length - 1,
      start = base.stations[i].points[last].x;
    resizeSection(s, Math.max(0, start + (dHalf / (next.beam / 2)) * w[i]));
  });
  return next;
}

/** Raise the deck edge (or the keel) of reached sections, easing the neighbouring points as the side profile always has. */
export function moveDeckKeel(
  base: Hull,
  ids: string[],
  blend: Blend,
  id: string,
  keel: boolean,
  dy: number,
): Hull {
  const next = clone(base),
    reached = ids.includes(id) ? ids : [id],
    w = weights(base, reached, blend),
    profile = keel
      ? [0, 0, 0.6, 1, 1, 1, 0.6, 0, 0]
      : [1, 0.4, 0, 0, 0, 0, 0, 0.4, 1];
  next.stations.forEach((s, i) => {
    if (!w[i]) return;
    const delta = (dy / next.depth) * w[i];
    s.points.forEach((p, k) => {
      p.y += delta * contourWeight(s.points, k, profile);
    });
  });
  return next;
}

const nearestContour = (s: Station, target: number) => {
  let best = 1;
  for (let i = 1; i < keelOf(s); i++)
    if (
      Math.abs(contourAt(s.points, i) - target) <
      Math.abs(contourAt(s.points, best) - target)
    )
      best = i;
  return best;
};

export interface SectionReadings {
  /** Deck-edge breadth in metres. */
  width: number;
  /** Deck edge above the hull's base, in metres. */
  deck: number;
  /** How much narrower the upper side is than the deck edge, in percent. */
  flare: number;
  /** How far the bilge turns in from the deck edge, in percent. */
  bilge: number;
}
export function sectionReadings(h: Hull, s: Station): SectionReadings {
  const last = s.points.length - 1,
    x0 = s.points[0].x,
    ratio = (k: number) => (x0 ? (1 - Math.abs(s.points[k].x / x0)) * 100 : 0);
  return {
    width: ((s.points[last].x - s.points[0].x) * h.beam) / 2,
    deck: s.points[0].y * h.depth - hullExtent(h).base,
    flare: ratio(nearestContour(s, 1)),
    bilge: ratio(nearestContour(s, 2)),
  };
}
export type ReadingKey = keyof SectionReadings;
/** Apply a typed reading to the selected sections and blended neighbours. Width and deck move by the
 * primary section's change; flare and bilge set the same percentage everywhere they reach. */
export function applyReading(
  base: Hull,
  ids: string[],
  blend: Blend,
  primary: Station,
  key: ReadingKey,
  value: number,
): Hull {
  const next = clone(base),
    w = weights(base, ids, blend),
    now = sectionReadings(base, primary);
  next.stations.forEach((s, i) => {
    if (!w[i]) return;
    const last = s.points.length - 1;
    if (key === "width")
      resizeSection(
        s,
        Math.max(
          0,
          Math.abs(s.points[last].x) + ((value - now.width) / next.beam) * w[i],
        ),
      );
    if (key === "deck") {
      const delta = ((value - now.deck) / next.depth) * w[i];
      s.points[0].y += delta;
      s.points[last].y += delta;
    }
    if (key === "flare" || key === "bilge") {
      const k = nearestContour(s, key === "flare" ? 1 : 2);
      for (const [a, b] of [
        [k, 0],
        [last - k, last],
      ])
        s.points[a].x +=
          (s.points[b].x * (1 - value / 100) - s.points[a].x) * w[i];
    }
  });
  return next;
}

/** Metres the stem's mid-height point moves aft per unit of rake, where the Profile view's rake handle sits. */
export function rakeArm(h: Hull) {
  const bow = h.stations[0].points,
    mid = (bow[0].y + bow[keelOf(h.stations[0])].y) / 2;
  return h.depth * 0.6 * Math.max(0.05, 0.6 - mid);
}

/** "Deck edge", "Keel" or "Point n", counted from the deck edge down one side. */
export function pointName(s: Station, k: number): string {
  const last = s.points.length - 1,
    keel = last / 2;
  if (k === keel) return "Keel";
  if (k === 0 || k === last) return "Deck edge";
  return `Point ${Math.min(k, last - k) + 1}`;
}

/** Where a horizontal level meets the hull on both sides, bow to stern, in hull coordinates. */
export function levelRing(h: Hull, level: number): Vec3[][] {
  const port: Vec3[] = [],
    starboard: Vec3[] = [];
  for (const s of h.stations) {
    const b = breadthAt(sectionMetres(h, s), level);
    if (b === undefined) continue;
    const z = worldPoint(h, s.t, { x: 0, y: level / h.depth })[2];
    starboard.push([h.offset + b, level, z]);
    port.push([h.offset - b, level, z]);
  }
  return starboard.length > 1 ? [starboard, port] : [];
}

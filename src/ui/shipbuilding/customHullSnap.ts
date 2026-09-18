import {
  hullExtent,
  sectionMetres,
  worldPoint,
  type Hull,
} from "../../ships/customHullModel";
import type { Vec3 } from "../../ships/blueprint";

/** Hull-section snapping. N toggles it, S cycles the step and holding Alt/Option inverts it for one drag. */
export interface HullSnapSettings {
  enabled: boolean;
  /** Metres for points, widths, heights and section positions; stem rake and bulb snap to 5 %. */
  step: number;
  grid: boolean;
  /** The same point on the sections either side, and the neighbouring points of the edited section. */
  sections: boolean;
  /** Waterline, deck height and the hull's base. */
  levels: boolean;
  guides: boolean;
}
export const HULL_SNAP_STEPS = [0.05, 0.1, 0.25, 0.5, 1];
export const DEFAULT_HULL_SNAP: HullSnapSettings = {
  enabled: true,
  step: 0.1,
  grid: true,
  sections: true,
  levels: true,
  guides: true,
};
/** Screen distance at which a geometry target captures the dragged value. */
export const SNAP_PIXELS = 10;

export interface SnapTarget {
  value: number;
  /** Shown in the hint line while the drag holds this target. */
  label: string;
  /** Where the guide runs to, in hull coordinates. Levels have none and draw across the view instead. */
  at?: Vec3;
  level?: boolean;
}
export interface AxisSnap {
  value: number;
  target?: SnapTarget;
}

/** Geometry targets within `threshold` win; otherwise the value rounds to the grid, counted from `origin`. */
export function snapAxis(
  raw: number,
  targets: SnapTarget[],
  options: {
    settings: HullSnapSettings;
    enabled: boolean;
    threshold: number;
    origin?: number;
    step?: number;
  },
): AxisSnap {
  if (!options.enabled) return { value: raw };
  let best: SnapTarget | undefined,
    distance = options.threshold;
  for (const target of targets) {
    const d = Math.abs(target.value - raw);
    if (d <= distance) {
      best = target;
      distance = d;
    }
  }
  if (best) return { value: best.value, target: best };
  if (!options.settings.grid) return { value: raw };
  const origin = options.origin ?? 0,
    step = options.step ?? options.settings.step;
  return { value: origin + Math.round((raw - origin) / step) * step };
}

const pad = (i: number) => String(i + 1).padStart(2, "0");
const at = (h: Hull, t: number, x: number, y: number): Vec3 =>
  worldPoint(h, t, { x: x / (h.beam / 2), y: y / h.depth });

/** Values a section point can align with, along ship X ("out" from the centerline) or Y (height). */
export function pointTargets(
  h: Hull,
  stationId: string,
  k: number,
  axis: "x" | "y",
  settings: HullSnapSettings,
  waterline?: number,
): SnapTarget[] {
  const i = h.stations.findIndex((s) => s.id === stationId);
  if (i < 0) return [];
  const s = h.stations[i],
    points = sectionMetres(h, s),
    last = points.length - 1,
    keel = last / 2,
    side = k < keel ? -1 : 1,
    targets: SnapTarget[] = [];
  const value = (p: { x: number; y: number }) =>
    axis === "x" ? Math.abs(p.x) * side : p.y;
  if (settings.sections) {
    for (const j of [i - 1, i + 1]) {
      const other = h.stations[j];
      if (!other) continue;
      const p = sectionMetres(h, other)[k];
      targets.push({
        value: value(p),
        label: `section ${pad(j)}`,
        at: at(h, other.t, p.x, p.y),
      });
    }
    for (const n of [k - 1, k + 1]) {
      // A point never aligns with its own mirror; the keel only offers heights.
      if (n < 0 || n > last || n === last - k || (axis === "x" && n === keel))
        continue;
      const p = points[n];
      targets.push({
        value: value(p),
        label: n === keel ? "the keel" : "the next point",
        at: at(h, s.t, p.x, p.y),
      });
    }
  }
  if (settings.levels && axis === "y") {
    const e = hullExtent(h);
    if (waterline !== undefined)
      targets.push({ value: waterline, label: "the waterline", level: true });
    targets.push({ value: e.deck, label: "the deck height", level: true });
    targets.push({ value: e.base, label: "the base", level: true });
  }
  return targets;
}

/** Deck-edge half-breadths either side, and the hull's nominal beam. */
export function widthTargets(
  h: Hull,
  stationId: string,
  settings: HullSnapSettings,
): SnapTarget[] {
  const i = h.stations.findIndex((s) => s.id === stationId),
    targets: SnapTarget[] = [];
  if (i < 0 || !settings.sections) return targets;
  for (const j of [i - 1, i + 1]) {
    const other = h.stations[j];
    if (!other) continue;
    const m = sectionMetres(h, other),
      p = m[m.length - 1];
    targets.push({
      value: p.x,
      label: `section ${pad(j)}`,
      at: at(h, other.t, p.x, p.y),
    });
  }
  targets.push({ value: h.beam / 2, label: "the full beam" });
  return targets;
}

/** Deck or keel heights either side, plus the deck height or base of the whole hull. */
export function heightTargets(
  h: Hull,
  stationId: string,
  keel: boolean,
  settings: HullSnapSettings,
): SnapTarget[] {
  const i = h.stations.findIndex((s) => s.id === stationId),
    targets: SnapTarget[] = [];
  if (i < 0) return targets;
  if (settings.sections)
    for (const j of [i - 1, i + 1]) {
      const other = h.stations[j];
      if (!other) continue;
      const m = sectionMetres(h, other),
        p = m[keel ? (m.length - 1) / 2 : 0];
      targets.push({
        value: p.y,
        label: `section ${pad(j)}`,
        at: at(h, other.t, p.x, p.y),
      });
    }
  if (settings.levels) {
    const e = hullExtent(h);
    targets.push(
      keel
        ? { value: e.base, label: "the base", level: true }
        : { value: e.deck, label: "the deck height", level: true },
    );
  }
  return targets;
}

/** Positions along the hull in metres from the bow: halfway between the neighbours. */
export function stationTargets(
  h: Hull,
  stationId: string,
  settings: HullSnapSettings,
): SnapTarget[] {
  const i = h.stations.findIndex((s) => s.id === stationId);
  if (i <= 0 || i >= h.stations.length - 1 || !settings.sections) return [];
  const t = (h.stations[i - 1].t + h.stations[i + 1].t) / 2;
  return [{ value: t * h.length, label: "halfway between its neighbours" }];
}

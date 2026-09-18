import { expect, test } from "bun:test";
import {
  hullExtent,
  makeHull,
  sectionMetres,
} from "../../ships/customHullModel";
import {
  DEFAULT_HULL_SNAP,
  heightTargets,
  pointTargets,
  snapAxis,
  stationTargets,
  widthTargets,
} from "./customHullSnap";

const settings = DEFAULT_HULL_SNAP;
const options = { settings, enabled: true, threshold: 0.2 };

test("geometry within reach wins, the grid counts from its origin, and disabled snapping keeps the raw value", () => {
  const target = { value: 2.77, label: "the waterline", level: true };
  expect(snapAxis(2.63, [target], options)).toEqual({ value: 2.77, target });
  expect(snapAxis(2.5, [target], options).value).toBeCloseTo(2.5, 12);
  expect(
    snapAxis(2.53, [target], { ...options, origin: -4.68 }).value,
  ).toBeCloseTo(2.52, 12);
  expect(snapAxis(2.63, [target], { ...options, enabled: false })).toEqual({
    value: 2.63,
  });
  expect(
    snapAxis(2.53, [], { ...options, settings: { ...settings, grid: false } }),
  ).toEqual({ value: 2.53 });
  // The nearest of several captures.
  const near = { value: 1.1, label: "section 03" };
  expect(
    snapAxis(1.05, [{ value: 1.2, label: "section 05" }, near], options).target,
  ).toBe(near);
});

test("a section point aligns with the same point either side and its neighbours, never its own mirror", () => {
  const h = makeHull(1),
    id = h.stations[3].id,
    k = 2;
  const heights = pointTargets(h, id, k, "y", settings, -1.91);
  const own = sectionMetres(h, h.stations[3]);
  expect(heights.map((t) => t.label)).toEqual([
    "section 03",
    "section 05",
    "the next point",
    "the next point",
    "the waterline",
    "the deck height",
    "the base",
  ]);
  expect(heights[0].value).toBeCloseTo(
    sectionMetres(h, h.stations[2])[k].y,
    12,
  );
  expect(heights[2].value).toBeCloseTo(own[1].y, 12);
  expect(heights[3].value).toBeCloseTo(own[3].y, 12);
  expect(heights.at(-1)!.value).toBeCloseTo(hullExtent(h).base, 12);
  // Port points align along negative x; no target sits on the mirror side.
  const outs = pointTargets(h, id, k, "x", settings);
  expect(outs.every((t) => t.value <= 0)).toBe(true);
  expect(outs.some((t) => t.level)).toBe(false);
  // Beside the keel, out never aligns with the centerline.
  const beside = pointTargets(h, id, 3, "x", settings);
  expect(beside.some((t) => t.label === "the keel")).toBe(false);
  expect(
    pointTargets(h, id, k, "y", {
      ...settings,
      sections: false,
      levels: false,
    }),
  ).toEqual([]);
});

test("widths, deck and keel heights and positions offer their own targets", () => {
  const h = makeHull(1),
    id = h.stations[3].id;
  expect(widthTargets(h, id, settings).map((t) => t.label)).toEqual([
    "section 03",
    "section 05",
    "the full beam",
  ]);
  expect(widthTargets(h, id, settings).at(-1)!.value).toBe(h.beam / 2);
  expect(heightTargets(h, id, true, settings).at(-1)).toMatchObject({
    label: "the base",
    level: true,
  });
  expect(heightTargets(h, id, false, settings).at(-1)).toMatchObject({
    label: "the deck height",
    level: true,
  });
  const [halfway] = stationTargets(h, id, settings);
  expect(halfway.value).toBeCloseTo(
    ((h.stations[2].t + h.stations[4].t) / 2) * h.length,
    12,
  );
  expect(stationTargets(h, h.stations[0].id, settings)).toEqual([]);
});

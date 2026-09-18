import { expect, test } from "bun:test";
import {
  BLEND_REACH,
  clone,
  influence,
  invalidReason,
  makeHull,
  worldPoint,
} from "../../ships/customHullModel";
import {
  applyReading,
  levelRing,
  moveDeckKeel,
  movePoint,
  moveStation,
  pointName,
  rakeArm,
  resizeWidth,
  sectionReadings,
  STATION_GAP,
} from "./customHullEditing";

const off = { soft: false, reach: BLEND_REACH.initial };
const on = { soft: true, reach: BLEND_REACH.initial };

test("a moved point keeps its mirror and the keel stays on the centerline", () => {
  const h = makeHull(1),
    ids = [h.stations[3].id];
  const next = movePoint(h, ids, off, 2, -0.5, 0.4);
  const s = next.stations[3],
    before = h.stations[3];
  expect((s.points[2].x - before.points[2].x) * (h.beam / 2)).toBeCloseTo(
    -0.5,
    12,
  );
  expect((s.points[2].y - before.points[2].y) * h.depth).toBeCloseTo(0.4, 12);
  expect(s.points[6]).toMatchObject({ x: -s.points[2].x, y: s.points[2].y });
  const keel = movePoint(h, ids, off, 4, 1, -0.2).stations[3];
  expect(keel.points[4].x).toBe(0);
  expect((keel.points[4].y - before.points[4].y) * h.depth).toBeCloseTo(
    -0.2,
    12,
  );
  // Unselected sections stay put without blending.
  expect(next.stations.filter((_, i) => i !== 3)).toEqual(
    h.stations.filter((_, i) => i !== 3),
  );
  expect(invalidReason(next)).toBeUndefined();
});

test("blending moves neighbours by their influence over the chosen reach", () => {
  const h = makeHull(1),
    ids = [h.stations[4].id];
  // Wider blending reaches further across the ship-derived station spacing.
  expect(influence(h, ids, h.stations[3].t, true, 0.2)).toBeCloseTo(0.275625, 6);
  expect(influence(h, ids, h.stations[3].t, true)).toBeGreaterThan(0.2);
  const next = movePoint(h, ids, on, 0, 0, 1);
  for (const [i, s] of next.stations.entries()) {
    const weight = influence(h, ids, s.t, true, on.reach);
    expect((s.points[0].y - h.stations[i].points[0].y) * h.depth).toBeCloseTo(
      weight,
      12,
    );
  }
});

test("sections slide between their neighbours and the ends stay put", () => {
  const h = makeHull(1);
  const far = moveStation(h, h.stations[3].id, 500);
  expect(far.stations[3].t).toBeCloseTo(h.stations[4].t - STATION_GAP, 12);
  expect(invalidReason(far)).toBeUndefined();
  const near = moveStation(h, h.stations[3].id, 2.4);
  expect((near.stations[3].t - h.stations[3].t) * h.length).toBeCloseTo(2.4, 9);
  expect(moveStation(h, h.stations[0].id, 5)).toEqual(h);
});

test("width, deck and keel drags reach the dragged section even when another is selected", () => {
  const h = makeHull(1),
    other = [h.stations[1].id],
    id = h.stations[5].id,
    last = h.stations[5].points.length - 1;
  const wider = resizeWidth(h, other, off, id, 0.6);
  expect(
    (wider.stations[5].points[last].x - h.stations[5].points[last].x) *
      (h.beam / 2),
  ).toBeCloseTo(0.6, 12);
  expect(wider.stations[1]).toEqual(h.stations[1]);
  const raised = moveDeckKeel(h, other, off, id, false, 0.5);
  expect(
    (raised.stations[5].points[0].y - h.stations[5].points[0].y) * h.depth,
  ).toBeCloseTo(0.5, 12);
  const keel = moveDeckKeel(h, other, off, id, true, -0.3);
  expect(
    (keel.stations[5].points[4].y - h.stations[5].points[4].y) * h.depth,
  ).toBeCloseTo(-0.3, 12);
  expect(keel.stations[5].points[0].y).toBe(h.stations[5].points[0].y);
});

test("typed readings match the section and apply as the old inspector did", () => {
  const h = makeHull(1),
    s = h.stations[3],
    ids = [s.id];
  const now = sectionReadings(h, s);
  expect(now.width).toBeCloseTo(14.1255018, 9);
  expect(now.deck).toBeCloseTo(16.559, 3);
  expect(now.flare).toBeCloseTo(22.783905509, 8);
  expect(now.bilge).toBeCloseTo(49.549016095, 8);
  const wider = applyReading(h, ids, off, s, "width", 12);
  expect(sectionReadings(wider, wider.stations[3]).width).toBeCloseTo(12, 9);
  const higher = applyReading(h, ids, off, s, "deck", 9.2);
  expect(sectionReadings(higher, higher.stations[3]).deck).toBeCloseTo(9.2, 9);
  const flared = applyReading(clone(h), ids, off, s, "flare", 10);
  expect(sectionReadings(flared, flared.stations[3]).flare).toBeCloseTo(10, 9);
});

test("names, the rake handle's travel and the waterline ring follow the model", () => {
  const h = makeHull(1),
    s = h.stations[3];
  expect([0, 1, 2, 4, 6, 8].map((k) => pointName(s, k))).toEqual([
    "Deck edge",
    "Point 2",
    "Point 3",
    "Keel",
    "Point 3",
    "Deck edge",
  ]);
  const bow = h.stations[0].points,
    mid = { x: 0, y: (bow[0].y + bow[4].y) / 2 };
  const raked = clone(h);
  raked.rake += 0.1;
  expect(worldPoint(raked, 0, mid)[2] - worldPoint(h, 0, mid)[2]).toBeCloseTo(
    0.1 * rakeArm(h),
    9,
  );
  const [starboard, port] = levelRing(h, -1.91);
  expect(starboard.length).toBe(port.length);
  starboard.forEach((p, i) => expect(port[i][0]).toBeCloseTo(-p[0], 12));
  expect(levelRing(h, 100)).toEqual([]);
});

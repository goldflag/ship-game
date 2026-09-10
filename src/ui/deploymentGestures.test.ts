import { expect, test } from 'bun:test';
import { dragFormation, formationCenter, MAX_DEPLOYMENT_ZOOM, MIN_DEPLOYMENT_ZOOM, rotateFormation, zoomDeployment } from './deploymentGestures';

const placements = [
  { id: 'carrier', spawn: { x: 0, z: 16000, heading: 0 } },
  { id: 'escort', spawn: { x: 800, z: 16000, heading: 0 } },
  { id: 'front', spawn: { x: 0, z: 8000, heading: .5 } },
];

test('dragging a group preserves the grab offset, relative spacing, and all other ships', () => {
  const next = dragFormation(placements, ['carrier', 'escort'], { x: 800, z: 16000 }, { x: 2000, z: 15000 });
  expect(next[1].spawn).toEqual({ x: 2000, z: 15000, heading: 0 });
  expect(next[0].spawn).toEqual({ x: 1200, z: 15000, heading: 0 });
  expect(next[2]).toBe(placements[2]);
  expect(placements[0].spawn.x).toBe(0);
  const single = dragFormation(placements, ['escort'], { x: 900, z: 16000 }, { x: 1100, z: 17000 });
  expect(single[1].spawn.x).toBe(1000);
  expect(single[0]).toBe(placements[0]);
});

test('the rotation handle turns the whole formation around its center without changing spacing', () => {
  const selected = ['carrier', 'escort'];
  const next = rotateFormation(placements, selected, { x: 400, z: 15000 }, { x: 1400, z: 16000 });
  expect(formationCenter(next, selected)).toEqual({ x: 400, z: 16000 });
  expect(next[0].spawn.z).toBeCloseTo(15600);
  expect(next[1].spawn.z).toBeCloseTo(16400);
  expect(next[0].spawn.heading).toBeCloseTo(Math.PI / 2);
  expect(next[2]).toBe(placements[2]);
  expect(rotateFormation(placements, selected, { x: 400, z: 15000 }, { x: 400, z: 16000 })).toBe(placements);
});

test('wheel zoom holds the cursor anchor fixed, including its scale limits', () => {
  const view = { zoom: 2, center: { x: 1000, z: 14000 } }, anchor = { x: 3500, z: 12000 };
  const next = zoomDeployment(view, anchor, -120);
  expect(next.zoom).toBeGreaterThan(view.zoom);
  expect((anchor.x - next.center.x) * next.zoom).toBeCloseTo((anchor.x - view.center.x) * view.zoom);
  expect((anchor.z - next.center.z) * next.zoom).toBeCloseTo((anchor.z - view.center.z) * view.zoom);
  expect(zoomDeployment({ ...view, zoom: MAX_DEPLOYMENT_ZOOM }, anchor, -240)).toEqual({ ...view, zoom: MAX_DEPLOYMENT_ZOOM });
  // Pulling back past the fit is what shows the whole battle area on a wide chart.
  expect(MIN_DEPLOYMENT_ZOOM).toBeLessThan(1);
  expect(zoomDeployment({ ...view, zoom: 1 }, anchor, 240).zoom).toBeLessThan(1);
  expect(zoomDeployment({ ...view, zoom: MIN_DEPLOYMENT_ZOOM }, anchor, 240)).toEqual({ ...view, zoom: MIN_DEPLOYMENT_ZOOM });
});

test('a drag started on another group moves only that group, whichever group was selected', () => {
  // The chart paints the selection's rotate ring beneath every frame and marker, so a press on
  // a second group starts a move of that group instead of rotating the first.
  const next = dragFormation(placements, ['front'], { x: 0, z: 8000 }, { x: 1500, z: 9000 });
  expect(next[2].spawn).toEqual({ x: 1500, z: 9000, heading: .5 });
  expect(next[0]).toBe(placements[0]);
  expect(next[1]).toBe(placements[1]);
});

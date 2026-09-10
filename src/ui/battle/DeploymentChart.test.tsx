import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SHIP_GLYPHS } from '../shipGlyphs';
import { DeploymentChart } from './DeploymentChart';
import type { ChartGroup, ChartUnit, Deployment } from './deploymentModel';

const groups: ChartGroup[] = [
  { id: 'front', name: 'Group 1', side: 'friendly', formation: 'screen' },
  { id: 'rear', name: 'Group 2', side: 'friendly', formation: 'column' },
];
const unit = (id: string, presetId: string, groupId: string, x: number, z: number): ChartUnit =>
  ({ id, presetId, name: id, side: 'friendly', groupId, spawn: { x, z, heading: 0 } });
const deployment: Deployment = {
  units: [unit('bb', 'bismarck', 'front', 0, 12000), unit('dd', 'fletcher', 'front', 900, 12000), unit('cv', 'enterprise-cv6', 'rear', 0, 16000), unit('ca', 'baltimore', 'rear', 900, 16000)],
  groups, islands: [], bounds: { kind: 'circle', radius: 25000 }, friendlyMinZ: 7000, focus: { x: 0, z: 0 }, labels: {}, error: '',
};
const chart = (selectionId: string) => renderToStaticMarkup(<DeploymentChart deployment={deployment} fit={28000} onChange={() => {}} onCommit={() => {}}
  selection={{ kind: 'group', id: selectionId }} onSelect={() => {}} scope="group" onScopeChange={() => {}}/>);

test('the rotate ring is painted beneath every frame, tag and ship, so a press on another group moves that group', () => {
  const html = chart('front');
  // Group 1 is selected, so its ring is on the chart; SVG paints later siblings on top, and the
  // press handlers live on the frames and markers, so whatever is drawn last wins the pointer.
  const ring = html.indexOf('chart-ring-hit');
  expect(ring).toBeGreaterThan(-1);
  expect(ring).toBeLessThan(html.indexOf('chart-frame'));
  expect(ring).toBeLessThan(html.indexOf('chart-tag'));
  expect(ring).toBeLessThan(html.indexOf('chart-ship '));
  expect(ring).toBeLessThan(html.lastIndexOf('chart-frame'));
  expect(ring).toBeLessThan(html.indexOf('chart-knob'));
  // Every frame and marker still carries its own hit target and label.
  expect(html).toContain('Select Group 2');
  expect(html).toContain('chart-ship-hit');
});

test('the heading knob is a grabbable disc and the readout rotates too', () => {
  const html = chart('front');
  expect(html).toContain('chart-knob-face');
  expect(html).toContain('chart-knob-hit');
  expect(html).toContain('chart-handle');
  expect(html).toContain('Rotate the selection. Drag the heading knob');
  expect(html).toContain('chart-readout-hit');
  expect(html).toContain('Drag to rotate the selection');
  // The knob disc is about 22 px across: r = 11 chart units per CSS pixel.
  const k = 28000 * 2 / 600; // fit 28000, zoom 1, the chart's default 600 px square
  expect(html).toContain(`class="chart-knob-face" r="${11 * k}"`);
});

test('zoom 1 fits the whole battle area on the chart, and the ships wear their class glyphs', () => {
  const html = chart('front');
  // The default measurement is square, so the fit reaches ±28 km on both axes.
  expect(html).toContain('viewBox="-28000 -28000 56000 56000"');
  for (const shipClass of ['battleship', 'destroyer', 'carrier', 'cruiser'] as const) expect(html).toContain(SHIP_GLYPHS[shipClass].hull);
  expect(html).toContain(SHIP_GLYPHS.carrier.mark);
  expect(html).toContain('class="chart-mark"');
  expect(html).toContain('bb · battleship');
  expect(html).toContain('cv · carrier');
});

test('a group tag names the formation it will sail', () => {
  const html = chart('rear');
  expect(html).toContain('GROUP 1 · 2 SHIPS · SCREEN');
  expect(html).toContain('GROUP 2 · 2 SHIPS · COLUMN');
});

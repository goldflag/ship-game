import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SHIP_GLYPHS } from '../shipGlyphs';
import { DeploymentChart, SHIP_NUMBER_ZOOM } from './DeploymentChart';
import type { ChartGroup, ChartUnit, Deployment } from './deploymentModel';
import { OPEN_SEA } from '../../maps/heightfield';
import { chartContours } from '../../maps/chartContours';
import { installMapTerrain } from '../../maps/testing';

const groups: ChartGroup[] = [
  { id: 'front', name: 'Group 1', side: 'friendly', formation: 'screen' },
  { id: 'rear', name: 'Group 2', side: 'friendly', formation: 'column' },
];
const unit = (id: string, presetId: string, groupId: string, x: number, z: number): ChartUnit =>
  ({ id, presetId, name: id, side: 'friendly', groupId, spawn: { x, z, heading: 0 } });
const deployment: Deployment = {
  units: [unit('bb', 'bismarck', 'front', 0, 12000), unit('dd', 'fletcher', 'front', 900, 12000), unit('cv', 'enterprise-cv6', 'rear', 0, 16000), unit('ca', 'baltimore', 'rear', 900, 16000)],
  groups, terrain: OPEN_SEA, bearing: 0, bounds: { kind: 'circle', radius: 25000 }, friendlyMinZ: 7000, focus: { x: 0, z: 0 }, labels: {}, error: '',
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

test('ship numbers stay off until the chart is zoomed in, so close order is not a smear', () => {
  // Markers hold their screen size, so at the 25 km fit a group in close order (360 m
  // between stations, about 4 px) would stack its numbers on top of one another.
  expect(SHIP_NUMBER_ZOOM).toBeGreaterThan(1);
  const html = chart('front');
  expect(html).not.toMatch(/<text x="[\d.]+" y="[\d.]+" font-size="[\d.]+">\d+<\/text>/);
  // Nothing is lost: every marker still names its ship for the pointer and for a reader.
  expect(html).toContain('bb \u00b7 battleship');
  expect(html).toContain('Select bb');
});

test('a group tag names the formation it will sail', () => {
  const html = chart('rear');
  expect(html).toContain('GROUP 1 · 2 SHIPS · SCREEN');
  expect(html).toContain('GROUP 2 · 2 SHIPS · COLUMN');
  const doubled = renderToStaticMarkup(<DeploymentChart deployment={{ ...deployment, groups: [{ ...groups[0], formation: 'double-column' }, { ...groups[1], formation: 'triple-column' }] }}
    fit={28000} onChange={() => {}} onCommit={() => {}} selection={undefined} onSelect={() => {}} scope="group" onScopeChange={() => {}}/>);
  expect(doubled).toContain('GROUP 1 · 2 SHIPS · DOUBLE COLUMN');
  expect(doubled).toContain('GROUP 2 · 2 SHIPS · TRIPLE COLUMN');
});

test('the real coast and its relief are charted where the battle lays them, and the rose points to true north', async () => {
  const field = await installMapTerrain('vestfjord');
  const turned: Deployment = { ...deployment, terrain: { field, offset: [0, 0] }, bearing: 75 };
  const html = renderToStaticMarkup(<DeploymentChart deployment={turned} fit={28000} onChange={() => {}} onCommit={() => {}}
    selection={{ kind: 'group', id: 'front' }} onSelect={() => {}} scope="group" onScopeChange={() => {}}/>);
  const [coast, ...bands] = chartContours(field);
  expect(html).toContain('<g class="chart-coast" transform="translate(0 0)">');
  expect(html).toContain(`d="${coast.path}" fill-rule="evenodd" class="chart-land"`);
  for (const band of bands) expect(html).toContain(`class="chart-relief chart-relief-${band.level}"`);
  expect(html).toContain('<title>Coastline</title>');
  expect(html).toContain('Deployment chart, north 75° left of up.');
  // The boundary's N stands 75° anticlockwise of the chart's top, and the ring's letters turn with it.
  const r = 25000 + 14 * 28000 * 2 / 600, turn = -75 * Math.PI / 180;
  const n = html.match(/<text x="([-\d.e]+)" y="([-\d.e]+)" class="chart-rose" font-size="[\d.]+">N<\/text>/)!;
  expect(Number(n[1])).toBeCloseTo(Math.sin(turn) * r, 3);
  expect(Number(n[2])).toBeCloseTo(-Math.cos(turn) * r + 4.5 * 28000 * 2 / 600, 3);
  // Headings read true: the selection sails chart-up, which here is 075°.
  expect(html).toContain('Heading 075°. Drag to rotate the selection.');
  expect(html).toContain('bb · battleship · 251 m · 075°');
  // Uncharted, the chart shows the sea alone.
  const pending = renderToStaticMarkup(<DeploymentChart deployment={{ ...turned, terrain: undefined }} fit={28000} onChange={() => {}} onCommit={() => {}}
    selection={undefined} onSelect={() => {}} scope="group" onScopeChange={() => {}}/>);
  expect(pending).not.toContain('chart-coast');
});

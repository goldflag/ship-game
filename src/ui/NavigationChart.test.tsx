import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavigationChart } from './NavigationChart';
import { createShipState } from '../game/session/motion';
import { defaultKeybindings } from '../game/keybindings';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { Telemetry } from '../game/types';
import { chartContours } from '../maps/chartContours';
import { installMapTerrain } from '../maps/testing';

test('the helm minimap renders permitted report estimates and uncertainty without a hidden actor', () => {
  const data: Telemetry = { ship: { ...createShipState(), x: 0, z: 0 }, order: 1, camera: 'Chase', fps: 60, trail: [] };
  const report: ContactTrack = { id: 'opaque-report', kind: 'surface', affiliation: 'hostile', status: 'stale', firstObservedTick: 1, lastObservedTick: 60, measuredPosition: [800, 0, -400], estimatedPosition: [9000, 0, 9000], velocity: [0, 0, 0], uncertaintyM: 400, identificationConfidence: .2, classification: 'Surface contact', identifiedPresetId: undefined, sources: [] };
  const html = renderToStaticMarkup(<NavigationChart data={data} reports={[report]} onResize={() => {}} bindings={defaultKeybindings()}/>);
  expect(html).toContain('Surface contact · hostile · last-known · ±400 m');
  expect(html).toContain('translate(120,105)');
  expect(html).toContain('r="5" fill="none"');
  expect(html).not.toContain('translate(222.5,222.5)');
  expect(report.estimatedPosition).toEqual([9000, 0, 9000]);
  const aircraft = renderToStaticMarkup(<NavigationChart data={data} reports={[{ ...report, kind: 'aircraft' }]} onResize={() => {}} bindings={defaultKeybindings()}/>);
  expect(aircraft).toContain('M-3 0h6M0-3v6');
  expect(aircraft).not.toContain('stroke-dasharray="2 2"');
});

test('the minimap draws the placed coast around the ship and turns its rose to true north', async () => {
  const field = await installMapTerrain('iron-bottom-sound');
  const data: Telemetry = { ship: { ...createShipState(), x: 1200, z: -3000 }, order: 1, camera: 'Chase', fps: 60, trail: [], mapId: 'iron-bottom-sound', terrain: { field, offset: [0, -2500] } };
  const html = renderToStaticMarkup(<NavigationChart data={data} onResize={() => {}} bindings={defaultKeybindings()}/>);
  // 8 km radius on a 100-unit chart radius: chart metres scale by 1/80 about the ship.
  expect(html).toContain(`transform="translate(${110 + (0 - 1200) / 80} ${110 + (-2500 + 3000) / 80}) scale(0.0125)"`);
  expect(html).toContain(`d="${chartContours(field)[0].path}"`);
  expect(html).toContain('Navigation chart, north 45° right of up, 8 kilometer radius.');
  // Up is a true 315°, so north stands 45° clockwise of the top and west 45° anticlockwise.
  const letter = (name: string) => html.match(new RegExp(`<text x="([-\\d.e]+)" y="([-\\d.e]+)" text-anchor="middle">${name}</text>`))!.slice(1).map(Number);
  const [nx, ny] = letter('N'), [wx, wy] = letter('W');
  expect(nx).toBeCloseTo(110 + Math.sin(Math.PI / 4) * 97, 6); expect(ny).toBeCloseTo(113 - Math.cos(Math.PI / 4) * 97, 6);
  expect(wx).toBeCloseTo(110 - Math.sin(Math.PI / 4) * 97, 6); expect(wy).toBeCloseTo(113 - Math.cos(Math.PI / 4) * 97, 6);
  // Open sea keeps the plain north-up chart.
  const open = renderToStaticMarkup(<NavigationChart data={{ ...data, mapId: 'north-atlantic', terrain: undefined }} onResize={() => {}} bindings={defaultKeybindings()}/>);
  expect(open).toContain('Navigation chart, north up,');
  expect(open).toContain('<text x="110" y="16" text-anchor="middle">N</text>');
  expect(open).not.toContain('chart-coast');
});

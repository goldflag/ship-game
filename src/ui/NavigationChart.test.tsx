import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavigationChart } from './NavigationChart';
import { createShipState } from '../simulation/ship';
import { defaultKeybindings } from '../game/keybindings';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { Telemetry } from '../game/types';

test('the helm minimap renders permitted report estimates and uncertainty without a hidden actor', () => {
  const data: Telemetry = { ship: { ...createShipState(), x: 0, z: 0 }, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [] };
  const report: ContactTrack = { id: 'opaque-report', kind: 'surface', affiliation: 'hostile', status: 'stale', firstObservedTick: 1, lastObservedTick: 60, measuredPosition: [800, 0, -400], estimatedPosition: [9000, 0, 9000], velocity: [0, 0, 0], uncertaintyM: 400, identificationConfidence: .2, classification: 'Surface contact', identifiedPresetId: null, sources: [] };
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

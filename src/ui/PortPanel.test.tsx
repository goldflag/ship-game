import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortPanel, historicalFleet } from './PortPanel';
import { shipPreset } from '../ships/presets';
import { armorZones } from '../ships/particulars';

const noop = () => {};

test('the overview rates the ship against the historical fleet and prints its particulars', () => {
  const def = shipPreset('valiant');
  const html = renderToStaticMarkup(<PortPanel definition={def} mode="exterior" onMode={noop} ready selection={undefined} onSelect={noop} />);
  const fleet = historicalFleet();
  expect(fleet.map((ship) => ship.id)).toContain('bismarck');
  expect(fleet.map((ship) => ship.id)).not.toContain('enterprise-cv6');
  for (const text of ['Overview', 'Armor', 'Equipment', 'Flooding', 'Ratings', 'Survivability', 'Particulars', 'Main belt', 'Turning circle', 'Full sheet', 'Main battery'])
    expect(html).toContain(text);
  // One tick per historical warship on each of the five ratings, and a rank against them.
  expect(html.match(/<s /g)!.length).toBe(fleet.length * 5);
  expect(html).toContain(`of ${fleet.length + 1}`);
  // Without a selection the column explains itself instead of offering to clear one.
  expect(html).not.toContain('Showing only');
});

test('the armor view lists zones instead of plates and names what is isolated', () => {
  const def = shipPreset('bismarck'),
    belt = armorZones(def).find((zone) => zone.id === 'belt')!;
  const html = renderToStaticMarkup(
    <PortPanel definition={def} mode="armor" onMode={noop} ready selection={{ key: 'zone:belt', ids: belt.entryIds, label: belt.label }} onSelect={noop} />,
  );
  expect(html).toContain('By zone, thickest first');
  expect(html).toContain('Showing only <b>Main belt</b>');
  expect(html).toContain('aria-pressed="true"');
  // Zones, not thousands of rows.
  expect(html.match(/class="port-group"/g)!.length).toBe(armorZones(def).length);
});

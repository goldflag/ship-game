import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHarnessProgressStore } from '../progression/store';
import { shipPreset } from '../ships/presets';
import { Garage } from './Garage';
import { ShipContext } from './ShipContext';
import { ProgressProvider } from './useProgress';

const noop = () => {};
function render(shipId: string, fresh: boolean, pinned = false) {
  return renderToStaticMarkup(
    <ProgressProvider store={createHarnessProgressStore(fresh)}>
      <ShipContext value={shipPreset(shipId)}>
        <Garage
          game={null}
          ready
          switching={false}
          switchError=""
          onSelectShip={noop}
          fps={60}
          onBattle={noop}
          onBuild={noop}
          onEditDesign={noop}
          onDeleteDesign={noop}
          libraryLoading={false}
          onChooseBattle={noop}
          lastMode="custom"
          onSettings={noop}
          pinned={pinned}
        />
      </ShipContext>
    </ProgressProvider>,
  );
}
const groups = (html: string) =>
  [...html.matchAll(/<div class="port-fleet-group" role="group" aria-label="([^"]+)".*?<\/div><\/div>/g)].map((match) => [
    match[1],
    [...match[0].matchAll(/aria-label="([^"]+)" aria-pressed/g)].map((button) => button[1]),
  ]);

test('an owned tree ship lies alongside under her nation, with BATTLE and the tech tree beside it', () => {
  const html = render('cleveland', true);
  expect(groups(html)).toEqual([
    ['United States', ['Hsienyang (Gleaves class)', 'USS Cleveland']],
    ['Japan', ['Fubuki', 'IJN Mogami']],
    ['Germany', ['Admiral Hipper', 'Type VIIC']],
    ['United Kingdom', ['Flower Corvette']],
    ['Your designs', []],
  ]);
  expect(html).toMatch(/aria-label="USS Cleveland" aria-pressed="true"/);
  expect(html).toContain('<strong>BATTLE</strong>');
  expect(html).toContain('<span>Tech tree</span>');
  expect(html).toMatch(/<section class="port-identity" aria-label="USS CLEVELAND">/);
  expect(html).toContain('Light cruiser');
  expect(html).toContain('United States · 1942');
  // The neighbours are named as the quay names them.
  expect(html).toContain('<small>HSIENYANG (GLEAVES CLASS)</small>');
  // Designs keep New design and All designs at the end of the line.
  expect(html).toContain('aria-label="New design"');
  expect(html).toContain('aria-label="Open all designs"');
  // No first-run empty quay: the player owns starters.
  expect(html).not.toContain('Lay down your first ship');
});

test('a locked ship alongside for review says what she costs, and BATTLE becomes her unlock', () => {
  const html = render('iowa', true, true);
  expect(html).toContain('Locked');
  expect(html).toContain('<b>6,500 XP</b>');
  expect(html).toContain('Needs 6,500 more XP');
  expect(html).toContain('UNLOCK · 6,500 XP');
  expect(html).not.toContain('<strong>BATTLE</strong>');
  expect(html).toMatch(/<button class="garage-set-sail garage-unlock" data-confirming="false" data-held="true"[^>]*disabled=""/);
  // She keeps her place in her nation's group, marked locked.
  expect(groups(html)[0]).toEqual(['United States', ['Hsienyang (Gleaves class)', 'USS Cleveland', 'USS Iowa, locked']]);
});

test('the harness owns every tree ship; enemy-only presets never join the fleet line', () => {
  const html = render('bismarck', false);
  expect(groups(html).flatMap(([, ships]) => ships as string[])).toHaveLength(16);
  expect(html).not.toMatch(/aria-label="(Valiant|Resolute|Liberty)/);
  expect(html).toContain('<strong>BATTLE</strong>');
});

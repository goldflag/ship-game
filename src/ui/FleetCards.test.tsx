import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnFleetCard, type OwnFleetShip } from './OwnFleet';
import { EnemyFleet } from './EnemyFleet';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { AirCluster, BattleComparison } from './fleetStats';
import type { Formation } from './fleetFormations';

const track = (over: Partial<ContactTrack>): ContactTrack => ({ id: 'c', kind: 'surface', affiliation: 'hostile', status: 'tracked', firstObservedTick: 0, lastObservedTick: 100, measuredPosition: over.estimatedPosition ?? [0, 0, 0], estimatedPosition: [0, 0, 0], velocity: [0, 0, 0], uncertaintyM: 20, identificationConfidence: 1, classification: null, identifiedPresetId: null, sources: [], ...over });

const ship = (over: Partial<OwnFleetShip>): OwnFleetShip => ({ id: 'bb', name: 'Bismarck', shipClass: 'battleship', hull: .97, kn: 20, order: 'Route · 20 kn · Waypoint 2/4', damageDealt: 12_400, frags: 1, lost: false, warn: false, massKg: 43_978_000, ...over });

const formations: readonly Formation[] = [
  { index: 1, name: 'Bismarck formation', leaderId: 'bb', shipIds: ['bb', 'dd'] },
  { index: 2, name: 'Enterprise', leaderId: 'cv', shipIds: ['cv'] },
];
const ships = [ship({}), ship({ id: 'dd', name: 'Yukikaze', shipClass: 'destroyer', hull: .62, kn: 14, order: 'Straggling · 14 kn available', damageDealt: 600, frags: 0, warn: true, massKg: 2_924_000 }),
  ship({ id: 'cv', name: 'Enterprise', shipClass: 'carrier', hull: 1, kn: 23, order: 'Patrol · 23 kn', damageDealt: 0, frags: 0, massKg: 25_500_000, aircraft: { remaining: 44, total: 48 } })];

const ownCard = (over: Partial<Parameters<typeof OwnFleetCard>[0]> = {}) => renderToStaticMarkup(<OwnFleetCard
  formations={formations} ships={ships} selectedIds={['bb']} aircraft={{ remaining: 44, total: 48, airborne: 36, onDeck: 4, inHangar: 4 }}
  onHover={() => {}} onSelectShip={() => {}} onSelectFormation={() => {}} {...over}/>);

test('the own fleet card lists every formation with its ships, their standing orders and the wing at the foot', () => {
  const html = ownCard();
  expect(html).toContain('aria-label="Own fleet"');
  // Three ships afloat, their tonnage and the damage the whole fleet has dealt.
  expect(html).toContain('3 ships · 72,402 t · 13,000 dmg');
  expect(html).toContain('<kbd>1</kbd>Bismarck formation');
  expect(html).toContain('2 ships · 13.0k dmg');
  // A lone carrier reports its wing instead of a damage score.
  expect(html).toContain('<kbd>2</kbd>Enterprise');
  expect(html).toContain('1 ship · 44/48 aircraft');
  expect(html).toContain('Route · 20 kn · Waypoint 2/4');
  expect(html).toContain('97%');
  expect(html).toContain('20 kn · 12.4k dmg · 1 sunk');
  expect(html).toContain('23 kn · no hits');
  expect(html).toContain('Aircraft 44/48 · 36 airborne · 4 deck · 4 hangar');
  // The selected ship is the pressed row; nothing else is.
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
});

test('the own fleet card marks warnings in brass, reports losses and keeps stray ships visible', () => {
  const html = ownCard({ ships: [...ships, ship({ id: 'ca', name: 'Prinz Eugen', shipClass: 'cruiser', lost: true, order: 'Sunk', damageDealt: 0, frags: 0 })], selectedIds: [], hoverId: 'dd' });
  expect(html).toContain('class="brass"');
  expect(html).toContain('Unassigned');
  expect(html).toContain('Lost');
  expect(html).toContain('fleet-card-row  lost ');
  expect(html).toContain('hovered');
  expect(html).not.toContain('aria-pressed="true"');
});

const comparison: BattleComparison = { damageDealt: [21_300, 9_850], tonnageAfloat: [75_736_000, 61_400_000], unidentified: 1, aircraft: { own: [44, 48], enemySeen: 21, enemyLost: 4 }, shipsLost: [0, 1] };
const contacts = [
  track({ id: 'c1', identifiedPresetId: 'yamato', estimatedPosition: [8_000, 0, -2_000], classification: 'Large warship', visibleCondition: { observedTick: 100, fire: true, heavySmoke: false, listing: false, sinking: false } }),
  track({ id: 'c2', classification: 'Small warship', status: 'stale', lastObservedTick: 0, estimatedPosition: [12_000, 0, 1_000] }),
  track({ id: 'a1', kind: 'aircraft', classification: 'Fighter', estimatedPosition: [4_000, 800, -1_000] }),
  track({ id: 'a2', kind: 'aircraft', classification: 'Fighter', estimatedPosition: [4_100, 800, -1_100] }),
];
const clusters: AirCluster[] = [{ id: 'air-a1+a2', type: 'fighter', label: '2 fighters', model: 'A6M2 Zero', count: 2, position: [4_000, 800, -1_000], heading: 0, trackIds: ['a1', 'a2'], smoking: 1, lastObservedTick: 100, stale: false }];

test('the enemy card reports hulls, aircraft seen and a comparison built only from what observers saw', () => {
  const html = renderToStaticMarkup(<EnemyFleet tracks={contacts} clusters={clusters} tick={100} origin={{ x: 0, z: 0 }} selectedId="c1"
    onSelect={() => {}} nameOf={t => t.identifiedPresetId ? 'Yamato' : t.classification ?? 'Surface contact'} comparison={comparison}/>);
  expect(html).toContain('aria-label="Enemy fleet"');
  expect(html).toContain('2 spotted · total unknown');
  expect(html).toContain('Ships');
  expect(html).toContain('1 current · 1 stale');
  expect(html).toContain('Yamato');
  expect(html).toContain('identified · current · now · fire visible');
  expect(html).toContain('8.2 km');
  expect(html).toContain('Small warship');
  // The stale destroyer keeps the class glyph, dimmed rather than dropped.
  expect(html).toContain('faded');
  expect(html).toContain('Aircraft seen');
  expect(html).toContain('2 seen · 4 shot down');
  expect(html).toContain('2 fighters · A6M2 Zero');
  expect(html).toContain('1 smoking');
  expect(html).toContain('aria-label="Battle comparison"');
  expect(html).toContain('≥ 61,400 t');
  expect(html).toContain('+1 unidentified');
  expect(html).toContain('4 seen lost');
});

test('the enemy card says so plainly when nothing has been reported', () => {
  const html = renderToStaticMarkup(<EnemyFleet tracks={[]} clusters={[]} tick={100} origin={{ x: 0, z: 0 }}
    onSelect={() => {}} nameOf={() => 'contact'} comparison={{ ...comparison, tonnageAfloat: [75_736_000, 0], unidentified: 0, aircraft: { own: [44, 48], enemySeen: 0, enemyLost: 0 } }}/>);
  expect(html).toContain('No contacts reported. Send ships or aircraft forward to search.');
  expect(html).not.toContain('Aircraft seen');
  expect(html).toContain('—');
});

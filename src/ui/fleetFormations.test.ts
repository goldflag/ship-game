import { expect, test } from 'bun:test';
import { fleetFormations } from './fleetFormations';
import type { FleetOrderState } from '../multiplayer/generated/FleetOrderState';

const escort = (leaderId: string): FleetOrderState => ({ movement: { type: 'escort', leaderId, offset: [0, 500], radiusM: 160, formation: 'column', slot: 0 }, weapons: { guns: true, aa: true, torpedoes: false }, formationPolicy: 'slow-for-stragglers', targetId: null, manual: false, navigation: null });
const hold = (): FleetOrderState => ({ movement: { type: 'hold' }, weapons: { guns: true, aa: true, torpedoes: false }, formationPolicy: 'slow-for-stragglers', targetId: null, manual: false, navigation: null });
const ships = [{ id: 'bb', name: 'Bismarck' }, { id: 'dd1', name: 'Fletcher' }, { id: 'dd2', name: 'Yukikaze' }, { id: 'cv', name: 'USS Enterprise (CV-6)' }];

test('escort orders form the groups, numbered and named from the setup groups', () => {
  const formations = fleetFormations(ships, { dd1: escort('bb'), dd2: escort('dd1'), bb: hold() }, new Map([[1, { name: 'Group 1', shipIds: ['bb', 'dd1', 'dd2'] }], [2, { name: 'Screen', shipIds: ['cv'] }]]));
  expect(formations).toEqual([
    { index: 1, name: 'Bismarck formation', leaderId: 'bb', shipIds: ['bb', 'dd1', 'dd2'] },
    { index: 2, name: 'Screen', leaderId: 'cv', shipIds: ['cv'] },
  ]);
});

test('a ship that leaves its setup group to escort another leader moves formation, and new leaders take free numbers', () => {
  const formations = fleetFormations(ships, { dd1: escort('cv'), dd2: escort('bb') }, new Map([[1, { name: 'Group 1', shipIds: ['bb', 'dd1', 'dd2'] }], [2, { name: 'Group 2', shipIds: ['cv'] }]]));
  expect(formations.map(f => [f.index, f.name, f.shipIds])).toEqual([[1, 'Bismarck formation', ['bb', 'dd2']], [2, 'USS Enterprise (CV-6) formation', ['cv', 'dd1']]]);
  const split = fleetFormations(ships, {}, new Map([[1, { name: 'Group 1', shipIds: ['bb', 'dd1'] }]]));
  expect(split.map(f => [f.index, f.name])).toEqual([[1, 'Bismarck'], [2, 'Fletcher'], [3, 'Yukikaze'], [4, 'USS Enterprise (CV-6)']]);
});

test('escort chains that loop or point outside the fleet still terminate at a leader', () => {
  const formations = fleetFormations(ships.slice(0, 2), { bb: escort('dd1'), dd1: escort('bb') });
  expect(formations).toHaveLength(1);
  expect(formations[0].shipIds.sort()).toEqual(['bb', 'dd1']);
  expect(fleetFormations([ships[0]], { bb: escort('missing') })[0].shipIds).toEqual(['bb']);
});

import { expect, test } from 'bun:test';
import enterprise from '../../assets/ships/enterprise-cv6/blueprint.json';
import shokaku from '../../assets/ships/shokaku/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from './blueprint';

test('carrier deck geometry round-trips in the common definition without changing legacy operating capacity', () => {
  for (const source of [enterprise, shokaku]) {
    const definition = compileShip(source, catalog);
    const deck = definition.airWing!.deckLayout!;
    expect(deck.spots).toHaveLength(24);
    expect(definition.airWing!.deckCapacity).toBe(12);
    for (const role of ['fighter', 'dive-bomber', 'torpedo-bomber']) expect(deck.spots.filter(p => p.preferredRole === role)).toHaveLength(8);
    expect(source.airWing.deckLayout).toEqual(deck);
  }
});
test('deck definitions reject invented capacity, missing platforms and off-deck operations', () => {
  const bad = (edit: (value: any) => void, error: RegExp) => {
    const source = structuredClone(enterprise); edit(source.airWing.deckLayout);
    expect(() => compileShip(source, catalog)).toThrow(error);
  };
  bad(d => d.version = 2, /version/);
  bad(d => d.surfaceId = 'missing', /unknown deck/);
  bad(d => d.spots[1].id = d.spots[0].id, /duplicate/);
  bad(d => d.spots[0].position = [20, 16.5, 30], /authored flight deck/);
  bad(d => d.spots[0].position[1] = 20, /authored flight deck/);
  bad(d => d.launchEnd[2] = d.launchStart[2] + 10, /toward the bow/);
  bad(d => d.elevators[0].id = 'missing', /fitted elevator/);
  bad(d => d.elevators[0].widthM = 20, /exceed the fitted/);
});

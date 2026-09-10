import { assetUrl } from '../assetUrl';
import type { ShipDefinition } from '../ships/blueprint';

const identities: Record<string, { type: string; nation: string }> = {
  'type-viic': { type: 'Submarine', nation: 'Germany' },
  fletcher: { type: 'Destroyer', nation: 'United States' },
  yukikaze: { type: 'Destroyer', nation: 'Japan' },
  fubuki: { type: 'Destroyer', nation: 'Japan' },
  bismarck: { type: 'Battleship', nation: 'Germany' },
  yamato: { type: 'Battleship', nation: 'Japan' },
  iowa: { type: 'Battleship', nation: 'United States' },
  'king-george-v': { type: 'Battleship', nation: 'United Kingdom' },
  cleveland: { type: 'Light cruiser', nation: 'United States' },
  baltimore: { type: 'Heavy cruiser', nation: 'United States' },
  mogami: { type: 'Heavy cruiser', nation: 'Japan' },
  'enterprise-cv6': { type: 'Aircraft carrier', nation: 'United States' },
  shokaku: { type: 'Aircraft carrier', nation: 'Japan' },
  'liberty-cargo': { type: 'Cargo ship', nation: 'United States' },
  'liberty-collier': { type: 'Coal carrier', nation: 'United States' },
  'victory-cargo': { type: 'Cargo ship', nation: 'United States' },
  'flower-corvette': { type: 'Corvette', nation: 'Canada' },
};
export function shipIdentity(id: string) {
  return identities[id] ?? { type: 'Ship', nation: '' };
}
/** Port filter classes. Detailed types (heavy cruiser, cargo ship, corvette) fold into these. */
export const SHIP_CLASSES = ['Carrier', 'Battleship', 'Cruiser', 'Destroyer', 'Submarine', 'Other'] as const;
export type ShipClass = typeof SHIP_CLASSES[number];
export function shipClass(id: string): ShipClass {
  const type = shipIdentity(id).type;
  if (type === 'Aircraft carrier') return 'Carrier';
  if (type === 'Battleship') return 'Battleship';
  if (/cruiser/i.test(type)) return 'Cruiser';
  if (type === 'Destroyer') return 'Destroyer';
  if (type === 'Submarine') return 'Submarine';
  return 'Other';
}
export function shipModel(selectedShip: ShipDefinition) {
  const identity = shipIdentity(selectedShip.id);
  const year = selectedShip.configuration.match(/19\d{2}/)?.[0] ?? '';

  // The port and custom battle both use the selected compiled asset.
  return {
    id: selectedShip.id,
    url: assetUrl(selectedShip.modelUrl),
    name: selectedShip.name,
    type: identity.type,
    nation: identity.nation,
    year,
    description: [identity.type, identity.nation, year].filter(Boolean).join(' · '),
  } as const;
}

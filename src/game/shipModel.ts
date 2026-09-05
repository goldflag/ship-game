import type { ShipDefinition } from '../ships/blueprint';

const identities: Record<string, { type: string; nation: string }> = {
  bismarck: { type: 'Battleship', nation: 'Germany' },
  yamato: { type: 'Battleship', nation: 'Japan' },
  baltimore: { type: 'Heavy cruiser', nation: 'United States' },
  'enterprise-cv6': { type: 'Aircraft carrier', nation: 'United States' },
};
export function shipModel(selectedShip: ShipDefinition) {
  const identity = identities[selectedShip.id] ?? { type: 'Ship', nation: '' };
  const year = selectedShip.configuration.match(/19\d{2}/)?.[0] ?? '';

  // The port, sea trial and schematic all use the selected compiled asset.
  return {
    id: selectedShip.id,
    url: selectedShip.modelUrl,
    name: selectedShip.name,
    type: identity.type,
    nation: identity.nation,
    year,
    description: [identity.type, identity.nation, year].filter(Boolean).join(' · '),
  } as const;
}

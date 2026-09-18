import { expect, test } from 'bun:test';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog } from '../../src/ships/blueprint';
import { paletteFor } from '../../src/ui/shipbuilding/builderLayers';

test('the published builder shelf offers generic running gear across boat and capital-ship sizes', () => {
  const catalog = catalogJson as ConstructionCatalog;
  const shelf = paletteFor('fittings', catalog).all!.filter(slot => slot.kind === 'part'
    && (slot.part.kind === 'propeller' || slot.part.kind === 'rudder'));
  expect(shelf.map(slot => slot.id).sort()).toEqual([
    'generic-propeller-1200', 'generic-propeller-2400', 'generic-propeller-4200', 'generic-propeller-6000',
    'generic-rudder-1000', 'generic-rudder-2000', 'generic-rudder-4000', 'generic-rudder-6000',
  ]);
  for (const kind of ['propeller', 'rudder'] as const) {
    const parts = catalog.equipment.filter(part => part.kind === kind).sort((a, b) => a.massKg! - b.massKg!);
    expect(parts.at(-1)!.size[1]).toBeGreaterThan(parts[0].size[1] * 4);
    for (const part of parts) {
      expect(part.placement).toBe('underwater');
      expect(part.sockets?.find(socket => socket.id === 'attachment')?.kind).toBe(kind === 'propeller' ? 'shaft' : 'support');
      expect(kind === 'propeller' ? part.thrustEfficiency : part.rudderAreaM2).toBeGreaterThan(0);
    }
  }
});

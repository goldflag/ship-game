import { expect, test } from 'bun:test';
import catalog from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionSource } from '../../ships/blueprint';
import { describeTurretArmor, installedTurretArmor, installedTurretThicknesses, turretArmor } from './turretArmor';

const parts = (catalog as unknown as ConstructionCatalog).weapons.parts;
const regions = (id: string) => Object.fromEntries(turretArmor(parts.find(part => part.id === id)!).regions.map(region => [region.id, region.thicknessMm]));

test('gunhouse plates are read by where they face, not by their face names', () => {
  expect(regions('type94-460-triple')).toEqual({ face: 650, sides: 250, rear: 190, roof: 270, floor: 25 });
  expect(regions('type41-356-kongo-twin')).toEqual({ face: 254, sides: 254, rear: 254, roof: 127, floor: 25 });
  expect(regions('us-8in55-mk12-triple')).toEqual({ face: 203.2, sides: 95.25, rear: 38.1, roof: 76.2, floor: 25.4 });
});

test('installed guns group by part, and open mounts report their whole-mount armor', () => {
  const equipment = (catalog as unknown as ConstructionCatalog).equipment;
  const turret = equipment.find(part => part.gunPartId === 'type94-460-triple')!, open = equipment.find(part => part.gunPartId === 'us-20mm-oerlikon-mk4-hsienyang')!;
  const source = { construction: { equipment: [
    { id: 'a', partId: turret.id, position: [0, 0, 0], bearingDeg: 0 }, { id: 'b', partId: turret.id, position: [0, 0, 20], bearingDeg: 180 },
    { id: 'c', partId: open.id, position: [0, 0, 10], bearingDeg: 0 },
  ] } } as unknown as ConstructionSource;
  const installed = installedTurretArmor(source, catalog as unknown as ConstructionCatalog);
  expect(installed.map(entry => [entry.part.id, entry.count])).toEqual([['type94-460-triple', 2], ['us-20mm-oerlikon-mk4-hsienyang', 1]]);
  expect(installed[1].armor.plates).toHaveLength(0);
  expect(describeTurretArmor(installed[0].armor)).toBe('Face 650 · Sides 250 · Rear 190 · Roof 270 · Floor 25 mm');
  expect(describeTurretArmor(installed[1].armor)).toBe('Whole mount 6 mm');
  const thicknesses = installedTurretThicknesses(source, catalog as unknown as ConstructionCatalog);
  expect([Math.min(...thicknesses), Math.max(...thicknesses)]).toEqual([6, 650]);
});

import { expect, test } from 'bun:test';
import kongo from '../../assets/ships/kongo/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from './blueprint';
import { segmentPlate } from '../simulation/protection';

const partId = 'type41-356-kongo-twin';

test('Kongo barrel surfaces clear their internal armor through elevation and recoil', () => {
  const def = compileShip(kongo, catalog);
  const mount = def.mounts.find(m => m.partId === partId)!;
  const gun = mount.weapon;
  const plates = def.armor.filter(a => a.plate?.mountId === mount.id);
  let contacts = 0;
  for (let degrees = gun.elevationMinDeg; degrees <= gun.elevationMaxDeg; degrees++) {
    const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    for (const recoil of [0, .5, 1]) for (const side of [-1, 1]) for (let sector = 0; sector < 16; sector++) {
      const radial = sector * Math.PI / 8, up = .5 * Math.sin(radial);
      const point = (along: number): Vec3 => {
        along -= recoil * gun.recoilM;
        return [-(side * gun.barrelSpacing / 2 + .5 * Math.cos(radial)),
          gun.pivotHeight + along * s + up * c,
          -(gun.trunnionForward + along * c - up * s)];
      };
      // Longitudinal skin of the full-size internal barrel through its collar.
      const from = point(-.75), to = point(5.45 - gun.trunnionForward);
      if (plates.some(a => segmentPlate(from, to, a.plate!.vertices))) contacts++;
    }
  }
  expect(contacts).toBe(0);
  // The recoil pans are closed protection below the gun, not deleted armor.
  for (const side of [-1, 1]) {
    const from: Vec3 = [side * gun.barrelSpacing / 2, 3.3, -2];
    const to: Vec3 = [from[0], 2, -2];
    const hit = plates.flatMap(a => { const h = segmentPlate(from, to, a.plate!.vertices); return h ? [h] : []; });
    expect(hit.length).toBeGreaterThan(0);
    expect(Math.max(...hit.map(h => h.point[1]))).toBeCloseTo(2.35);
  }
});

test('Kongo main gunhouse cheeks follow the approved lower face sections', () => {
  const def = compileShip(kongo, catalog);
  const plates = def.armor.filter(a => a.plate?.mountId === 'main-2');
  // Rounded metre measurements from the approved source, converted to the
  // mount datum. Higher center readings include fittings and are not roof data.
  for (const [height, lateral, forward] of [
    [3.56, 2.3, 3.657], [3.56, 3, 3.323],
    [4.06, 2.3, 3.401], [4.06, 3, 3.069],
    [4.56, 2.3, 3.147], [4.56, 3, 2.815],
  ]) for (const side of [-1, 1]) {
    const hits = plates.flatMap(a => {
      const hit = segmentPlate([side*lateral, height, -6], [side*lateral, height, -2], a.plate!.vertices);
      return hit ? [hit] : [];
    }).sort((a,b) => a.t-b.t);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point[2]).toBeCloseTo(-forward, 2);
  }
});

function edited(edit: (mesh: any) => void) {
  const copy = structuredClone(catalog);
  edit(copy.parts.find(p => p.id === partId)!.gunhouseMesh);
  return () => compileShip(kongo, copy);
}

test('declared gun ports remain open to physical plate contacts', () => {
  const def = compileShip(kongo, catalog);
  const mount = def.mounts.find(m => m.partId === partId)!;
  const plates = def.armor.filter(a => a.plate?.mountId === mount.id);
  const contact = (from: Vec3, to: Vec3) => plates.some(a => segmentPlate(from, to, a.plate!.vertices));
  // The compiled plate coordinates are yaw-local: -Z forward and +Y up.
  for (const lateral of [-1.375, 1.375]) {
    expect(contact([lateral, 4.17, -6], [lateral, 4.17, -2.5])).toBe(false);
    expect(contact([lateral, 8, -2.6], [lateral, 4.3, -2.6])).toBe(false);
  }
  expect(contact([0, 4.17, -6], [0, 4.17, -2.5])).toBe(true);
  expect(contact([0, 8, 0], [0, 4.3, 0])).toBe(true);
  expect(plates).toHaveLength(mount.weapon.gunhouseMesh!.faces.length);
});

test('undeclared holes, reversed aperture loops and fabricated boundaries fail closed', () => {
  expect(edited(mesh => delete mesh.apertures)).toThrow(/closed consistently wound/);
  expect(edited(mesh => mesh.apertures[0].indices.reverse())).toThrow(/open boundary/);
  expect(edited(mesh => mesh.apertures[0].indices = [0, 1, 2])).toThrow(/open boundary/);
  expect(edited(mesh => mesh.apertures[0].indices[1] = mesh.apertures[0].indices[0])).toThrow(/distinct vertex/);
  expect(edited(mesh => mesh.apertures.push(structuredClone(mesh.apertures[0])))).toThrow(/duplicate/);
});

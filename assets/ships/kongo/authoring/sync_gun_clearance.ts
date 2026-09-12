import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { barrelHeightOffset, barrelOffset, compileShip, type ShipDefinition, type Vec3, type TravelClearance } from '../../../../src/ships/blueprint';
import { structuralSurfaces } from '../../../../src/simulation/structure';

// Original tube/receiver envelopes reserve full recoil against the authored hull and
// structures. Fittings absent from those surfaces and moving neighbors require
// separate coverage; these are not historical mechanical stops.
const aftSingle = (id: string) => /^aa25-(3[5-9]|4[0-8])$/.test(id);
const controlled = (id: string) => id.startsWith('main-') || id.startsWith('casemate-') || aftSingle(id);

export function addStructureClearance(definition: ShipDefinition): void {
  const surfaces = structuralSurfaces(definition);
  for (const mount of definition.mounts.filter(m => controlled(m.id))) {
    const main = mount.id.startsWith('main-'), single = aftSingle(mount.id), weapon = mount.weapon;
    const expected = single ? 'type96-25-kongo-single' : main ? 'type41-356-kongo-twin' : 'type41-152-kongo-casemate';
    if (weapon.id !== expected) throw new Error(`${mount.id}: review the barrel envelope for the changed variant`);
    const trunnion = weapon.trunnionForward, length = weapon.muzzleForward - trunnion;
    // Enclose the turned tube, locking bands/lugs and strap bridge in the
    // original ijn-356 recipe; the casemate profile follows ijn-152's tube.
    const barrels: TravelClearance['barrels'] = single ? [
      // Original type96-single receiver box: x=-.68..+.04, y=±.075, z=±.09.
      // The capsule encloses its cross-section and reserves the full recoil.
      { fromM: -.68, toM: .04, heightM: 0, radiusM: Math.hypot(.075, .09), recoils: true },
      { fromM: 0, toM: length, heightM: 0, radiusM: .055, recoils: true },
      { fromM: -.1, toM: .7, heightM: -.1, radiusM: .032, recoils: false },
    ] : main ? [
      { fromM: -.75, toM: 7.7-trunnion, heightM: 0, radiusM: .5, recoils: true },
      { fromM: 6.065-trunnion, toM: 7.535-trunnion, heightM: 0, radiusM: .625, recoils: true },
      { fromM: 7.7-trunnion, toM: 11-trunnion, heightM: 0, radiusM: .43, recoils: true },
      { fromM: 11-trunnion, toM: length, heightM: 0, radiusM: .34, recoils: true },
    ] : [
      { fromM: 0, toM: 1.65, heightM: 0, radiusM: .25, recoils: true },
      { fromM: 1.65, toM: 3.25, heightM: 0, radiusM: .22, recoils: true },
      { fromM: 3.25, toM: length, heightM: 0, radiusM: .17, recoils: true },
    ];
    const lowAngle = weapon.elevationMinDeg*Math.PI/180, highAngle = weapon.elevationMaxDeg*Math.PI/180;
    if (lowAngle < -Math.PI/2 || highAngle > Math.PI/2) throw new Error('Review clearance bounds for elevation beyond 90 degrees');
    const sine = [Math.sin(lowAngle), Math.sin(highAngle)];
    const cosine = [Math.min(Math.cos(lowAngle), Math.cos(highAngle)),
      lowAngle <= 0 && highAngle >= 0 ? 1 : Math.max(Math.cos(lowAngle), Math.cos(highAngle))];
    let radius = 0, lowY = Infinity, highY = -Infinity;
    for (let i = 0; i < (weapon.barrelCount ?? 2); i++) for (const capsule of barrels) {
      const along = [capsule.fromM-(capsule.recoils ? weapon.recoilM : 0), capsule.toM];
      const up = barrelHeightOffset(weapon, i)+capsule.heightM;
      const reach = Math.hypot(Math.max(...along.map(Math.abs)), up);
      // Pitch preserves reach; train preserves distance from the mount axis.
      // Triangle inequality includes the fixed forward trunnion offset.
      radius = Math.max(radius, Math.hypot(Math.abs(trunnion)+reach, barrelOffset(weapon, i))+capsule.radiusM);
      const pitched = along.flatMap(x => sine.map(s => x*s)), lifted = cosine.map(c => up*c);
      lowY = Math.min(lowY, Math.min(...pitched)+Math.min(...lifted)-capsule.radiusM);
      highY = Math.max(highY, Math.max(...pitched)+Math.max(...lifted)+capsule.radiusM);
    }
    const center = mount.position.map((v, i) => v+(i === 1 ? weapon.pivotHeight : 0));
    const vertices: Vec3[] = [], triangles: [number, number, number][] = [], ids = new Map<string, number>();
    const angle = mount.bearingDeg*Math.PI/180, c = Math.cos(angle), s = Math.sin(angle);
    const trainLimit = weapon.traverseDeg*Math.PI/180;
    const lateralMargin = Math.max(...Array.from({ length: weapon.barrelCount ?? 2 }, (_, i) => Math.abs(barrelOffset(weapon, i))))
      + Math.max(...barrels.map(b => b.radiusM));
    // These main-barrel centerlines remain forward of the train axis, even
    // at full recoil. Beyond either rear sector edge, only lateral bore
    // spacing and capsule radius can extend their sweep into the aft wedge.
    const forwardOnly = Array.from({ length: weapon.barrelCount ?? 2 }, (_, i) => barrelHeightOffset(weapon, i)).every(y => y === 0)
      && barrels.every(b => b.heightM === 0 && trunnion+b.fromM-weapon.recoilM >= 0);
    for (const surface of surfaces) for (const triangle of surface.triangles) {
      const points = triangle.map(i => surface.vertices[i]);
      const low = [0, 1, 2].map(i => Math.min(...points.map(p => p[i])));
      const high = [0, 1, 2].map(i => Math.max(...points.map(p => p[i])));
      const tolerance = .00001;
      if (high[1] < center[1]+lowY-tolerance || low[1] > center[1]+highY+tolerance) continue;
      const distance = low.reduce((sum, v, i) => sum+Math.max(0, v-center[i], center[i]-high[i])**2, 0);
      if (distance > (radius+tolerance)**2) continue;
      const localPoints = points.map(p => {
        const dx = p[0]-mount.position[0], dy = p[1]-mount.position[1], dz = p[2]-mount.position[2];
        return [c*dx+s*dz, dy, -s*dx+c*dz] as Vec3;
      });
      if (forwardOnly && trainLimit >= Math.PI/2 && trainLimit < Math.PI && localPoints.every(p =>
        Math.sin(trainLimit)*p[2]+Math.cos(trainLimit)*p[0] > lateralMargin+tolerance &&
        Math.sin(trainLimit)*p[2]-Math.cos(trainLimit)*p[0] > lateralMargin+tolerance)) continue;
      triangles.push(localPoints.map(local => {
        const key = local.join(',');
        let id = ids.get(key);
        if (id === undefined) { id = vertices.length; vertices.push(local); ids.set(key, id); }
        return id;
      }) as [number, number, number]);
    }
    if (vertices.length > 2048 || triangles.length > 4096) {
      throw new Error(`${mount.id}: structure clearance exceeds the version 1 surface budget (${vertices.length} vertices / ${triangles.length} triangles)`);
    }
    if (triangles.length) mount.travelClearance = { version: 1, surface: { vertices, triangles }, barrels };
    else delete mount.travelClearance;
  }
}

if (import.meta.main) {
  const path = fileURLToPath(new URL('../blueprint.json', import.meta.url));
  const blueprint = JSON.parse(readFileSync(path, 'utf8'));
  const catalog = JSON.parse(readFileSync(new URL('../../../parts/guns.json', import.meta.url), 'utf8'));
  const definition = compileShip(blueprint, catalog);
  addStructureClearance(definition);
  for (const mount of definition.mounts) if (controlled(mount.id)) {
    blueprint.mounts.find((m: { id: string }) => m.id === mount.id).travelClearance = mount.travelClearance;
  }
  compileShip(blueprint, catalog);
  writeFileSync(path, JSON.stringify(blueprint, null, 2)+'\n');
  console.log('Synchronized main/casemate tubes and aft single-AA receiver clearance against authored structures.');
}

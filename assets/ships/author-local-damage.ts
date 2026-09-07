/** Original version-1 local damage recipe. Run after geometry/flood-space recipes.
 * Locations, fuel and durability are explicitly provisional gameplay authoring. */
import { readFile, writeFile } from 'node:fs/promises';
import { compileShip, type DamageRegion, type ShipBlueprint, type Vec3 } from '../../src/ships/blueprint';
const ids = ['bismarck', 'yamato', 'king-george-v', 'baltimore', 'enterprise-cv6', 'type-viic', 'liberty-cargo', 'liberty-collier', 'victory-cargo', 'flower-corvette', 'fletcher'];
const catalog = JSON.parse(await readFile(new URL('../parts/guns.json', import.meta.url), 'utf8'));
for (const id of ids) {
  const path = new URL(`./${id}/blueprint.json`, import.meta.url);
  const b = JSON.parse(await readFile(path, 'utf8')) as ShipBlueprint;
  const h = b.hull, deck = Math.max(...h.deckHeights.map(p => p[1]));
  // Re-running replaces only this recipe's own support-equipment IDs.
  b.modules = b.modules.filter(m => !m.id.startsWith('support-'));
  b.compartments = b.compartments.filter(c => c.id !== 'support-director-room');
  const engineRooms = [...new Set(b.modules.filter(m => m.kind === 'engine').map(m => m.compartmentId))];
  for (const [i, roomId] of [engineRooms[0], engineRooms.length > 1 ? engineRooms.at(-1) : undefined].entries()) {
    const room = b.compartments.find(c => c.id === roomId);
    if (!room) continue;
    const cell = [...room.cells ?? [room]].sort((a, c) => c.size[0]*c.size[1]*c.size[2] - a.size[0]*a.size[1]*a.size[2])[0];
    const size = cell.size.map(n => Math.min(1.2, n * .2)) as Vec3;
    const center = cell.center.map((v, axis) => v + (axis === 1 ? -.25 : .3) * cell.size[axis]) as Vec3;
    b.modules.push({ id: `support-generator-${i + 1}`, name: `Generator ${i + 1}`, kind: 'generator', hp: 60,
      compartmentId: room.id, center, size, immersionToleranceM: size[1] * .3 });
  }
  const bridge = b.viewpoints?.bridge ?? [0, deck + 2, -h.length * .12];
  // The plotting/control station occupies an existing hull space. Do not invent
  // an above-hull flood compartment for an optical director.
  const { room: controlRoom, cell: controlCell } = b.compartments.flatMap(room => (room.cells ?? [room]).map(cell => ({ room, cell })))
    .filter(({ cell }) => cell.size.every(n => n >= .1))
    .sort((a, c) => Math.hypot(a.cell.center[0]-bridge[0], (a.cell.center[1]-bridge[1])*2, a.cell.center[2]-bridge[2]) - Math.hypot(c.cell.center[0]-bridge[0], (c.cell.center[1]-bridge[1])*2, c.cell.center[2]-bridge[2]))[0];
  const director = controlCell.center.map((n, axis) => n + (axis === 1 ? .25 : 0) * controlCell.size[axis]) as Vec3;
  const directorSize = controlCell.size.map(n => Math.min(1.8, n * .25)) as Vec3;
  b.modules.push({ id: 'support-director', name: 'Fire-control station', kind: 'fire-control', hp: 65,
    compartmentId: controlRoom.id, center: director, size: directorSize, immersionToleranceM: directorSize[1] * .2 });
  for (const room of b.compartments) {
    const modules = b.modules.filter(m => m.compartmentId === room.id);
    const magazine = modules.some(m => m.kind === 'magazine'), machinery = modules.some(m => m.kind === 'engine');
    const inhabited = modules.length > 0, cargo = /cargo|hold|coal|hangar/i.test(room.name);
    room.fire = { fuelSeconds: magazine ? 150 : machinery ? 240 : cargo ? 300 : inhabited ? 80 : 0,
      ignitionHeat: magazine ? .65 : machinery ? .55 : .45, heatPerDamage: inhabited || cargo ? .014 : 0,
      ventPosition: [room.center[0], Math.max(deck + .3, room.center[1] + room.size[1] / 2), room.center[2]] };
  }
  for (const m of b.mounts) m.fire = { fuelSeconds: m.battery === 'main' ? 90 : 45, ignitionHeat: .5, heatPerDamage: .014 };
  const top = Math.max(deck + 12, director[1] + 5, ...(b.structures ?? []).map(s => s.baseY + s.height + 1));
  const regions: DamageRegion[] = [];
  const bands = [{ id: 'underwater', name: 'Underwater hull', low: -h.draft - 1, high: 0, fraction: .12 },
    { id: 'upper-hull', name: 'Upper hull', low: 0, high: deck + .5, fraction: .1 },
    { id: 'upperworks', name: 'Upperworks', low: deck + .5, high: top, fraction: .025 }];
  for (const band of bands) for (const [side, sign] of [['port', -1], ['starboard', 1]] as const) for (let section = 0; section < 8; section++) {
    regions.push({ id: `${band.id}-${side}-${section + 1}`, name: `${band.name} · ${side} · ${['bow', 'forward', 'forward amidships', 'amidships forward', 'amidships aft', 'aft amidships', 'aft', 'stern'][section]}`,
      kind: band.id === 'upperworks' ? 'superstructure' : 'hull', durabilityFraction: band.fraction,
      center: [sign * (h.beam + 4) / 4, (band.low + band.high) / 2, -h.length / 2 + (section + .5) * h.length / 8],
      size: [(h.beam + 4) / 2, band.high - band.low, h.length / 8 + .002] });
  }
  for (const m of b.mounts) regions.push({ id: `mount-${m.id}`, name: m.name, kind: 'mount', mountId: m.id,
    center: [...m.position], size: [1, 1, 1], durabilityFraction: m.battery === 'main' ? .025 : .008 });
  b.localDamage = { version: 1, regions, basis: 'Original game calibration: eight longitudinal sections, independent sides and three height bands, with separate gunhouse budgets. Generator/director proxy positions and fire loads are estimated; no historical structural tolerance, electrical routing, ventilation or crew-performance claim.' };
  compileShip(b, catalog);
  await writeFile(path, JSON.stringify(b, null, 2) + '\n');
  const report = new URL(`./${id}/reports/discrepancies.md`, import.meta.url);
  const marker = '## Local damage and fire calibration — 2026-09-06';
  const existing = await readFile(report, 'utf8');
  if (!existing.includes(marker)) await writeFile(report, existing + `\n${marker}\n\nLocal regions, generator and director proxies, combustible loads and smoke outlets are independently authored gameplay estimates from the existing layout. They are not historically measured structural subdivisions, generator schedules or ventilation plans. Electrical supply is aggregated with manual gun fallback; directors share a targeting penalty. Breach overlap uses bounded aperture sampling. See \`assets/ships/author-local-damage.ts\`.\n`);
  console.log(`${id}: ${regions.length} local regions, ${b.modules.filter(m => m.id.startsWith('support-')).length} support modules`);
}

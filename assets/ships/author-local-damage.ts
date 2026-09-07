/** Original version-1 local damage recipe. Run after geometry/flood-space recipes.
 * Locations, fuel and durability are explicitly provisional gameplay authoring. */
import { readFile, writeFile } from 'node:fs/promises';
import { compileShip, type DamageRegion, type ShipBlueprint, type Vec3 } from '../../src/ships/blueprint';
/** Pure recipe seam: callers own persistence and choose ships explicitly. */
export function authorLocalDamage(input: ShipBlueprint): ShipBlueprint {
  const b = structuredClone(input);
  const h = b.hull, deck = Math.max(...h.deckHeights.map(p => p[1]));
  // Re-running replaces only this recipe's own support-equipment IDs.
  b.modules = b.modules.filter(m => !['support-director', 'support-generator-1', 'support-generator-2'].includes(m.id));
  b.compartments = b.compartments.filter(c => c.id !== 'support-director-room');
  const engineRooms = [...new Set(b.modules.filter(m => m.kind === 'engine').map(m => m.compartmentId))];
  for (const [i, roomId] of (b.modules.some(m => m.kind === 'generator') ? [] : [engineRooms[0], engineRooms.length > 1 ? engineRooms.at(-1) : undefined]).entries()) {
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
  if (!b.modules.some(m => m.kind === 'fire-control')) b.modules.push({ id: 'support-director', name: 'Fire-control station', kind: 'fire-control', hp: 65,
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
  for (const m of b.modules.filter(m => m.kind === 'launcher')) regions.push({ id: `launcher-${m.id}`, name: m.name, kind: 'launcher', moduleId: m.id, center: [...m.center], size: [...m.size], durabilityFraction: .008 });
  b.localDamage = { version: 1, regions, basis: 'Original game calibration: eight longitudinal sections, independent sides and three height bands, with separate gunhouse budgets. Generator/director proxy positions and fire loads are estimated; no historical structural tolerance, electrical routing, ventilation or crew-performance claim.' };
  return b;
}

/** Add equipment budgets without changing previously calibrated hull/gun regions. */
export function mergeEquipmentDamage(b: ShipBlueprint, previousMountIds: ReadonlySet<string>): void {
  const generated = authorLocalDamage(b);
  if (!b.localDamage) b.localDamage = generated.localDamage;
  else {
    const regions = b.localDamage.regions.filter(r =>
      (!r.moduleId || b.modules.some(m => m.id === r.moduleId)) &&
      (!r.mountId || b.mounts.some(m => m.id === r.mountId)));
    const existing = new Set(regions.map(r => r.id));
    b.localDamage.regions = [...regions, ...generated.localDamage!.regions.filter(r =>
      !existing.has(r.id) && (r.kind === 'launcher' || r.mountId && !previousMountIds.has(r.mountId)))];
  }
  for (const mount of b.mounts) mount.fire ??= generated.mounts.find(m => m.id === mount.id)!.fire;
}

if (import.meta.main) {
  const { shipPresets } = await import('../../src/ships/presets');
  const args = process.argv.slice(2);
  const roster = Object.keys(shipPresets);
  if (!args.length || args.some(id => id !== 'all' && !roster.includes(id)) || args.includes('all') && args.length > 1)
    throw new Error('Usage: bun assets/ships/author-local-damage.ts <ship-id> [...] | all');
  const ids = args[0] === 'all' ? roster : [...new Set(args)];
  await writeLocalDamage(ids);
}


/** Validate the requested batch before writing; injectable paths keep scoped authoring testable. */
export async function writeLocalDamage(ids: string[], shipRoot = new URL('./', import.meta.url), catalogUrl = new URL('../parts/guns.json', import.meta.url)): Promise<void> {
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
  // Validate the whole requested batch before writing any ship.
  const authored = await Promise.all(ids.map(async id => {
    const path = new URL(`./${id}/blueprint.json`, shipRoot);
    const b = authorLocalDamage(JSON.parse(await readFile(path, 'utf8')));
    compileShip(b, catalog);
    return { id, path, b };
  }));
  for (const { id, path, b } of authored) {
    await writeFile(path, JSON.stringify(b, null, 2) + '\n');
    console.log(`${id}: ${b.localDamage!.regions.length} local regions, ${b.modules.length} modules`);
  }
}

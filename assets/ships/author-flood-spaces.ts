/** Original provisional flood-space authoring recipe, revision 1.
 * Retains existing room IDs. Conservative side strips follow the authored hull,
 * exclude existing room boxes, and use CLOSED estimated watertight partitions.
 * These are gameplay subdivisions, not recovered historical compartment plans.
 * Run: bun assets/ships/author-flood-spaces.ts <ship-id>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileShip, type Compartment, type ShipBlueprint, type Vec3 } from '../../src/ships/blueprint';
import { hullContains } from '../../src/simulation/hull';
import { plateHit } from '../../src/simulation/protection';

const shipId = process.argv[2];
if (!/^[a-z][a-z0-9-]+$/.test(shipId ?? '')) throw new Error('Supply a ship ID');
const path = new URL(`./${shipId}/blueprint.json`, import.meta.url);
const b = JSON.parse(await readFile(path, 'utf8')) as ShipBlueprint;
const catalog = JSON.parse(await readFile(new URL('../parts/guns.json', import.meta.url), 'utf8'));
// Regeneration removes only this recipe's namespaced outputs.
b.compartments = b.compartments.filter(c => !c.id.startsWith('flood-strip-') && !c.id.startsWith('flood-end-'));
b.connections = b.connections.filter(c => !c.id?.startsWith('partition-'));
b.floodRegions = [];
const existing = [...b.compartments], hull = b.hull;
const low = (c: Compartment, axis: number) => c.center[axis] - c.size[axis] / 2;
const high = (c: Compartment, axis: number) => c.center[axis] + c.size[axis] / 2;
const overlaps = (c: Compartment, axis: number, a: number, z: number) => high(c, axis) > a && low(c, axis) < z;
const bottom = Math.max(-6, -hull.draft + .2), top = Math.min(3, Math.max(...hull.deckHeights.map(p => p[1])) - .2);
const start = -hull.length / 2 + 4, finish = hull.length / 2 - 4;
let zi = 0;
for (let z0 = start; z0 < finish; z0 += 20, zi++) {
  const z1 = Math.min(z0 + 20, finish), midZ = (z0 + z1) / 2;
  let yi = 0;
  for (let y0 = bottom; y0 < top; y0 += 1.5, yi++) {
    const y1 = Math.min(y0 + 1.5, top), midY = (y0 + y1) / 2;
    const zs = [z0, midZ, z1, ...(hull.sections ?? []).map(s => hull.length / 2 - s.station).filter(z => z > z0 && z < z1)];
    let outer = hull.beam / 2;
    for (const z of zs) for (const y of [y0, midY, y1]) {
      let a = 0, c = hull.beam / 2;
      for (let i = 0; i < 24; i++) { const x = (a + c) / 2; if (hullContains(hull, [x, y, z])) a = x; else c = x; }
      outer = Math.min(outer, a - .04);
    }
    if (outer < .4) continue;
    for (const sign of [-1, 1]) {
      const side = sign < 0 ? 'port' : 'starboard';
      const neighbors = existing.filter(c => overlaps(c, 1, y0, y1) && overlaps(c, 2, z0, z1) && (sign < 0 ? low(c, 0) < 0 : high(c, 0) > 0));
      const edge = (c: Compartment) => sign < 0 ? -low(c, 0) : high(c, 0);
      const nearest = neighbors.sort((a, c) => edge(c) - edge(a))[0];
      // Fill the wing gap beside retained rooms. A fixed 2 m strip left the
      // narrow legacy machinery envelopes hydraulically disconnected.
      const inner = Math.max(.05, nearest ? edge(nearest) + .06 : outer - 2);
      let room = nearest;
      if (outer - inner > .2) {
        room = { id: `flood-strip-${side}-${zi}-${yi}`, name: `${side === 'port' ? 'Port' : 'Starboard'} outer space ${zi + 1}.${yi + 1} · estimated`, center: [sign * (inner + outer) / 2, midY, midZ], size: [outer - inner, (y1 - y0) * .98, (z1 - z0) * .98], capacityM3: (outer - inner) * (y1 - y0) * .98 * (z1 - z0) * .98 * .72, pumpM3PerSecond: .001 };
        b.compartments.push(room);
      }
      if (room) b.floodRegions.push({ id: `side-region-${side}-${zi}-${yi}`, face: side, compartmentId: room.id, center: [sign * (hull.beam / 4 + .5), midY, midZ], size: [hull.beam / 2 + 1, y1 - y0, z1 - z0] });
    }
  }
}
// Small centreline end spaces follow the actually submerged end envelope. Scan
// conservative boxes instead of extending a rectangular room through the stem.
for (const [side, sign] of [['bow', -1], ['stern', 1]] as const) {
  let yi = 0;
  for (let y0 = bottom; y0 < top; y0 += 1.5, yi++) {
    const y1 = Math.min(top, y0 + 1.5), midY = (y0 + y1) / 2;
    const cells: number[] = [];
    for (let distance = 1; distance < 35; distance++) {
      const z = sign * (hull.length / 2 - distance);
      const box: Compartment = { id: 'candidate', name: 'candidate', center: [0, midY, z], size: [.8, (y1 - y0) * .98, .98], capacityM3: 1, pumpM3PerSecond: 0 };
      const inside = [-1, 1].every(sx => [-1, 1].every(sy => [-1, 1].every(sz => hullContains(hull, [sx * .4, midY + sy * box.size[1] / 2, z + sz * .49]))));
      const occupied = b.compartments.some(c => c.center.every((n, axis) => Math.abs(n - box.center[axis]) < (c.size[axis] + box.size[axis]) / 2));
      if (inside && !occupied) { if (cells.length && distance !== cells.at(-1)! + 1) break; cells.push(distance); }
      else if (cells.length) break;
    }
    if (!cells.length) continue;
    const first = cells[0], last = Math.min(cells.at(-1)!, first + 9), length = last - first + .98;
    const room: Compartment = { id: `flood-end-${side}-${yi}`, name: `${side === 'bow' ? 'Bow' : 'Stern'} end space ${yi + 1} · estimated`, center: [0, midY, sign * (hull.length / 2 - (first + last) / 2)], size: [.8, (y1 - y0) * .98, length], capacityM3: .8 * (y1 - y0) * .98 * length * .72, pumpM3PerSecond: .001 };
    b.compartments.push(room);
    b.floodRegions.push({ id: `end-region-${side}-${yi}`, face: side, compartmentId: room.id, center: [0, midY, sign * (hull.length / 2 - 17.5)], size: [hull.beam + 1, y1 - y0, 35] });
  }
}
const def = compileShip(b, catalog);
const pairs = new Set(b.connections.map(c => [c.fromId, c.toId].sort().join(':')));
// Nearby, facing room envelopes get a closed partition. No diagonal teleports.
for (let i = 0; i < b.compartments.length; i++) for (let j = i + 1; j < b.compartments.length; j++) {
  const a = b.compartments[i], c = b.compartments[j];
  const key = [a.id, c.id].sort().join(':');
  if (pairs.has(key)) continue;
  const gaps = a.center.map((_, axis) => Math.max(low(a, axis), low(c, axis)) - Math.min(high(a, axis), high(c, axis)));
  const axes = gaps.map((gap, axis) => ({ gap, axis })).filter(g => g.gap >= -.001);
  if (axes.length !== 1 || axes[0].gap > 2 || gaps.some((gap, axis) => axis !== axes[0].axis && gap > -.25)) continue;
  const axis = axes[0].axis;
  const center = a.center.map((_, k) => (Math.max(low(a, k), low(c, k)) + Math.min(high(a, k), high(c, k))) / 2) as Vec3;
  const size = gaps.map((gap, k) => k === axis ? Math.max(.04, gap + .08) : -gap) as Vec3;
  // A third space in the gap must be traversed through its own boundaries.
  if (b.compartments.some((room, k) => k !== i && k !== j && room.center.every((n, dimension) => Math.abs(n - center[dimension]) < (room.size[dimension] + (dimension === axis ? Math.max(0, gaps[axis]) : size[dimension])) / 2 - 1e-6))) continue;
  const plate = def.armor.filter(p => p.plate && !p.plate.exterior && !p.plate.mountId && p.plate.material !== 'teak').map(p => ({ p, hit: plateHit(a.center, c.center, p, def, []) })).find(({ hit }) => hit && hit.point.every((n, k) => Math.abs(n - center[k]) <= size[k] / 2));
  const id = `partition-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
  b.connections.push({ id, fromId: a.id, toId: c.id, state: 'closed', areaM2: .5, position: plate?.hit?.point ?? center, bounds: { center, size }, ...(plate ? { armorId: plate.p.id } : { thicknessMm: 5 }) });
  pairs.add(key);
}
compileShip(b, catalog);
await writeFile(path, JSON.stringify(b, null, 2) + '\n');
console.log(`${shipId}: ${b.compartments.length} rooms, ${b.floodRegions.length} side regions, ${b.connections.length} closed boundaries. Provisional authoring; inspect and rebuild.`);

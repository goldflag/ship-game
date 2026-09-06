import type { Ammunition, APProjectile, FloodConnection, HEProjectile, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { ShipState } from './ship';
import { plateHit, plateResponse, samePlateSeam } from './protection';
import type { MountState } from './weapons';
import { add, clamp, contains, length, localToWorld, normalize, radians, rotate, scale, segmentBox, sub, worldToLocal } from './geometry';

export interface Breach { position: Vec3; areaM2: number; radiusM: number; shellId: number; }
export interface CompartmentState { id: string; waterM3: number; breachAreaM2: number; breaches: Breach[]; }
export interface ConnectionState { id: string; state: 'open' | 'closed' | 'damaged'; damageAreaM2: number; fromIndex: number; toIndex: number; }
export const connectionId = (c: FloodConnection) => c.id ?? `${c.fromId}:${c.toId}`;
export type DefeatCause = 'structural-fallback' | 'flooding' | 'magazine';
export interface ImpactRecord {
  shellId: number; shipId: string; targetId: string; targetName: string;
  /** Position is ship-local; DamageEvent.position is world-space. */
  kind: 'armor' | 'module' | 'mount' | 'boundary' | 'burst'; position: Vec3;
  thicknessMm?: number; material?: string; obliquityDeg?: number; resistanceMm?: number;
  fragmentBudgetMm?: number;
  impactSpeedMps?: number;
  exitSpeedMps?: number; fuze?: 'unarmed' | 'armed'; fuzeRemainingSeconds?: number;
  penetrationBeforeMm: number; penetrationAfterMm: number;
  outcome: 'penetrated' | 'ricochet' | 'stopped' | 'damaged' | 'destroyed' | 'detonation' | 'backing';
  damage?: number; compartmentId?: string; breachAreaM2?: number; terminal?: boolean;
  connectionIds?: string[];
  breachAssignments?: { compartmentId: string; areaM2: number; position: Vec3 }[];
}
export interface DamageState {
  integrity: number; modules: { id: string; hp: number; detonated: boolean }[];
  compartments: CompartmentState[]; connections: ConnectionState[]; sunk: boolean; defeatCause?: DefeatCause;
}
export interface Combatant { motion: ShipState; mounts: MountState[]; damage: DamageState; }
export interface Shell {
  id: number; ownerId: string; position: Vec3; velocity: Vec3; age: number;
  penetrationMm: number; damage: number; caliberM: number; visited: string[];
  dragPerSecond?: number;
  ap?: APProjectile;
  he?: HEProjectile; ammunition?: Ammunition;
  detonateAtAge?: number;
  lastHitShipId?: string;
  /** Position is ship-local, or mount-local when attached to an articulated gunhouse. */
  lodged?: { shipId: string; position: Vec3; mountId?: string };
}
/** Serializable evidence for render-side effects; never feeds back into damage. */
export interface BallisticEffectData {
  shell?: Pick<Shell, 'id' | 'caliberM' | 'velocity' | 'ammunition'>;
  normal?: Vec3;
  detonation?: boolean;
  blastRadiusM?: number;
}
export interface DamageEvent extends BallisticEffectData { kind: 'penetration' | 'contact' | 'ricochet' | 'stopped' | 'module' | 'sunk' | 'burst'; position: Vec3; message: string; shipId: string; impact?: ImpactRecord; defeatCause?: DefeatCause; }
export function createDamage(def: ShipDefinition): DamageState {
  return { integrity: 1000, modules: def.modules.map(m => ({ id: m.id, hp: m.hp, detonated: false })), compartments: def.compartments.map(c => ({ id: c.id, waterM3: 0, breachAreaM2: 0, breaches: [] })), connections: def.connections.map(c => ({ id: connectionId(c), state: c.state ?? 'open', damageAreaM2: c.state === 'damaged' ? c.areaM2 : 0, fromIndex: def.compartments.findIndex(r => r.id === c.fromId), toIndex: def.compartments.findIndex(r => r.id === c.toId) })), sunk: false };
}
export function addBreach(state: CompartmentState, position: Vec3, areaM2: number, shellId: number, apertureRadiusM = Math.sqrt(areaM2 / Math.PI)): number {
  const added = Math.max(0, Math.min(areaM2, 4 - state.breachAreaM2));
  if (added > 0) {
    const radiusM = apertureRadiusM;
    // Keep separate openings exact until a space accumulates 64. Dense repeated
    // hits merge locally; saturated spaces use the closest cluster, with height
    // weighted strongly to preserve waterline behavior. This bounds fleet cost.
    const closest = state.breaches.map(b => ({ b, distance: Math.hypot(b.position[0] - position[0], 4 * (b.position[1] - position[1]), b.position[2] - position[2]) })).sort((a, b) => a.distance - b.distance)[0];
    if (closest && (closest.distance < .1 || state.breaches.length >= 64)) {
      const b = closest.b, total = b.areaM2 + added;
      b.position = b.position.map((n, i) => (n * b.areaM2 + position[i] * added) / total) as Vec3;
      b.areaM2 = total;
      // Separate small holes are not one giant hole: do not enlarge their
      // vertical extent from the accumulated area.
      b.radiusM = Math.max(b.radiusM, radiusM);
    } else state.breaches.push({ position: [...position], areaM2: added, radiusM, shellId });
  }
  state.breachAreaM2 += added;
  return added;
}
function structuralDamage(state: DamageState, amount: number, cause: DefeatCause): void {
  const before = state.integrity;
  state.integrity = Math.max(0, before - amount);
  if (before > 0 && state.integrity === 0) state.defeatCause = cause;
}
export { systemHealth } from './machinery';

/** Existing magazine consequence shared by contact and burst damage. Ignition,
 * wet ammunition and protection against fire are the following milestone. */
export function checkMagazine(actor: Combatant, def: ShipDefinition, index: number, shell: Shell, emit: (e: DamageEvent) => void): void {
  const m = def.modules[index], state = actor.damage.modules[index];
  if (m.kind !== 'magazine' || state.hp > 0 || state.detonated) return;
  state.detonated = true; structuralDamage(actor.damage, 450, 'magazine');
  const c = actor.damage.compartments.find(c => c.id === m.compartmentId)!;
  const breachAreaM2 = addBreach(c, m.center, 2, shell.id);
  emit({ kind: 'module', position: localToWorld(m.center, actor.motion), shipId: actor.motion.id, message: `${m.name} detonation`, detonation: true,
    shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity] },
    impact: { shellId: shell.id, shipId: actor.motion.id, targetId: m.id, targetName: m.name, kind: 'module', position: [...m.center],
      outcome: 'detonation', damage: 450, penetrationBeforeMm: shell.penetrationMm, penetrationAfterMm: shell.penetrationMm, compartmentId: c.id, breachAreaM2 } });
}

/** Split the same strip approximation used by inflow at authored room heights.
 * An opening across a watertight deck can reach the room below its center. */
function exteriorBreaches(actor: Combatant, def: ShipDefinition, point: Vec3, normal: Vec3, shell: Shell): NonNullable<ImpactRecord['breachAssignments']> {
  const area = shell.caliberM ** 2, radius = Math.sqrt(area / Math.PI), bottom = point[1] - radius, top = point[1] + radius;
  if (!def.floodRegions) {
    const room = def.compartments.map((c, i) => ({ i, distance: Math.hypot(...point.map((n, axis) => Math.max(0, Math.abs(n - c.center[axis]) - c.size[axis] / 2))) })).sort((a, b) => a.distance - b.distance)[0];
    if (!room) return [];
    const c = actor.damage.compartments[room.i];
    return [{ compartmentId: c.id, areaM2: addBreach(c, point, area, shell.id), position: [...point] }];
  }
  const regions = def.floodRegions.filter(r => (!r.face || (r.face === 'bow' || r.face === 'stern'
    ? (r.face === 'bow' ? point[2] < 0 : point[2] >= 0)
    : Math.abs(normal[0]) > .5 && (r.face === 'port' ? point[0] < 0 : point[0] >= 0))) && [0, 2].every(axis => Math.abs(point[axis] - r.center[axis]) <= r.size[axis] / 2));
  const cuts = [...new Set([bottom, top, ...regions.flatMap(r => [r.center[1] - r.size[1] / 2, r.center[1] + r.size[1] / 2]).filter(y => y > bottom && y < top)])].sort((a, b) => a - b);
  const result: NonNullable<ImpactRecord['breachAssignments']> = [];
  for (let i = 1; i < cuts.length; i++) {
    const position: Vec3 = [point[0], (cuts[i - 1] + cuts[i]) / 2, point[2]];
    const region = regions.find(r => contains(r, position));
    if (!region) continue;
    const c = actor.damage.compartments.find(c => c.id === region.compartmentId)!;
    result.push({ compartmentId: c.id, areaM2: addBreach(c, position, area * (cuts[i] - cuts[i - 1]) / (2 * radius), shell.id, (cuts[i] - cuts[i - 1]) / 2), position });
  }
  return result;
}

export interface ShipContact { t: number; key: string; kind: 'armor' | 'module' | 'mount' | 'boundary'; index: number; point: Vec3; normal: Vec3; onEdge?: boolean; seamKeys?: string[]; }
export interface ContactCandidates { armor: number[]; modules: number[]; connections: number[]; mounts: number[]; trains: number[]; }
/** Build once for a local burst, retaining every volume that can intersect a ray
 * inside its sphere. Rotation preserves the radius in mount-local coordinates. */
export function nearbyContacts(originWorld: Vec3, radius: number, actor: Combatant, def: ShipDefinition): ContactCandidates {
  const origin = worldToLocal(originWorld, actor.motion), trains = actor.mounts.map(m => m.train);
  const result: ContactCandidates = { armor: [], modules: [], connections: [], mounts: [], trains };
  const near = (point: Vec3, volume: { center: Vec3; size: Vec3 }) => point.reduce((sum, n, i) => sum + Math.max(0, Math.abs(n - volume.center[i]) - volume.size[i] / 2) ** 2, 0) <= (radius + 1e-5) ** 2;
  const mountOrigins = def.mounts.map((m, i) => worldToLocal(origin, { x: m.position[0], y: m.position[1], z: m.position[2], heading: radians(m.bearingDeg) + trains[i], roll: 0, pitch: 0 }));
  const plated = new Set<string>();
  def.armor.forEach((a, i) => {
    if (a.plate?.mountId) plated.add(a.plate.mountId);
    const mount = a.plate?.mountId ? def.mounts.findIndex(m => m.id === a.plate!.mountId) : -1;
    if (near(mount < 0 ? origin : mountOrigins[mount], a)) result.armor.push(i);
  });
  def.modules.forEach((m, i) => { if (near(origin, m)) result.modules.push(i); });
  def.connections.forEach((c, i) => { if (c.bounds && c.thicknessMm !== undefined && actor.damage.connections[i].state !== 'open' && near(origin, c.bounds)) result.connections.push(i); });
  def.mounts.forEach((m, i) => {
    const w = m.weapon;
    if (!plated.has(m.id) && near(mountOrigins[i], { center: [0, w.gunhouseSize[2] / 2, 0], size: [w.gunhouseSize[1], w.gunhouseSize[2], w.gunhouseSize[0]] })) result.mounts.push(i);
  });
  return result;
}
function eachCandidate<T>(items: T[], indices: number[] | undefined, visit: (item: T, index: number) => void): void {
  if (indices) indices.forEach(i => visit(items[i], i)); else items.forEach(visit);
}
/** An origin exactly on an incoming box face still crosses that sheet. This
 * matters for a fresh burst ray at a projectile's contact point. Visited keys
 * prevent the original projectile paying the same face twice. */
function entersBox(from: Vec3, to: Vec3, box: { center: Vec3; size: Vec3 }): boolean {
  return !contains(box, from) || from.some((n, i) => Math.abs(Math.abs(n - box.center[i]) - box.size[i] / 2) < 1e-7 && (n - box.center[i]) * (to[i] - n) < 0);
}
/** Read-only ordered geometry query. Resolving a contact is separate so flight
 * can stop at that instant and recompute travel after the shell loses speed. */
export function shipContacts(shell: Shell, fromWorld: Vec3, toWorld: Vec3, actor: Combatant, def: ShipDefinition, candidates?: ContactCandidates): ShipContact[] {
  const from = worldToLocal(fromWorld, actor.motion), to = worldToLocal(toWorld, actor.motion);
  const trains = candidates?.trains ?? actor.mounts.map(m => m.train);
  const hits: ShipContact[] = [];
  eachCandidate(def.armor, candidates?.armor, (a, index) => {
    if (a.plate) {
      const key = `${actor.motion.id}:armor:${a.id}:plate`;
      const hit = plateHit(from, to, a, def, trains);
      if (hit && !shell.visited.includes(key)) hits.push({ ...hit, key, kind:'armor', index });
      return;
    }
    const hit = segmentBox(from, to, a);
    if (!hit) return;
    const entryKey = `${actor.motion.id}:armor:${a.id}:entry`;
    if (entersBox(from, to, a) && !shell.visited.includes(entryKey)) hits.push({ ...hit, key: entryKey, kind: 'armor', index });
    const exitKey = `${actor.motion.id}:armor:${a.id}:exit`;
    if (hit.exit < 1 && !shell.visited.includes(exitKey)) {
      const point = add(from, sub(to, from).map(v => v * hit.exit) as Vec3);
      const distances = point.map((v, i) => Math.abs(Math.abs(v - a.center[i]) - a.size[i] / 2));
      const axis = distances.indexOf(Math.min(...distances));
      const normal: Vec3 = [0, 0, 0]; normal[axis] = Math.sign(point[axis] - a.center[axis]);
      hits.push({ t: hit.exit, key: exitKey, kind: 'armor', index, point, normal });
    }
  });
  eachCandidate(def.modules, candidates?.modules, (m, index) => {
    const key = `${actor.motion.id}:module:${m.id}`, hit = segmentBox(from, to, m);
    if (hit && !shell.visited.includes(key)) hits.push({ ...hit, key, kind: 'module', index });
  });
  eachCandidate(def.connections, candidates?.connections, (c, index) => {
    if (!c.bounds || c.thicknessMm === undefined || actor.damage.connections[index].state === 'open') return;
    const key = `${actor.motion.id}:boundary:${connectionId(c)}`, hit = segmentBox(from, to, c.bounds);
    if (hit && !shell.visited.includes(key)) hits.push({ ...hit, key, kind: 'boundary', index });
  });
  eachCandidate(def.mounts, candidates?.mounts, (m, index) => {
    if (!candidates && def.armor.some(a => a.plate?.mountId === m.id)) return;
    const yaw = radians(m.bearingDeg) + actor.mounts[index].train;
    const mountPose = { x: m.position[0], y: m.position[1], z: m.position[2], heading: yaw, roll: 0, pitch: 0 };
    const a = worldToLocal(from, mountPose), b = worldToLocal(to, mountPose), w = m.weapon;
    const box = { center: [0, w.gunhouseSize[2] / 2, 0] as Vec3, size: [w.gunhouseSize[1], w.gunhouseSize[2], w.gunhouseSize[0]] as Vec3 };
    const hit = segmentBox(a, b, box);
    if (!hit) return;
    const key = `${actor.motion.id}:mount:${m.id}:entry`;
    if (entersBox(a, b, box) && !shell.visited.includes(key)) hits.push({ ...hit, point: localToWorld(hit.point, mountPose), normal: rotate(hit.normal, mountPose), key, kind: 'mount', index });
    const exitKey = `${actor.motion.id}:mount:${m.id}:exit`;
    if (hit.exit < 1 && !shell.visited.includes(exitKey)) {
      const point = add(a, scale(sub(b, a), hit.exit));
      const distances = point.map((v, axis) => Math.abs(Math.abs(v - box.center[axis]) - box.size[axis] / 2));
      const axis = distances.indexOf(Math.min(...distances)), normal: Vec3 = [0, 0, 0];
      normal[axis] = Math.sign(point[axis] - box.center[axis]);
      hits.push({ t: hit.exit, point: localToWorld(point, mountPose), normal: rotate(normal, mountPose), key: exitKey, kind: 'mount', index });
    }
  });
  hits.sort((a, b) => a.t - b.t || Number(b.kind === 'armor') - Number(a.kind === 'armor') || (a.kind==='armor' && b.kind==='armor' ? def.armor[b.index].thicknessMm-def.armor[a.index].thicknessMm : 0) || a.key.localeCompare(b.key));
  const unique: ShipContact[] = [];
  for (const hit of hits) {
    const a = hit.kind === 'armor' ? def.armor[hit.index] : undefined;
    const previous = a?.plate && hit.onEdge ? unique.find(p => p.kind === 'armor' &&
      def.armor[p.index].plate?.material === a.plate!.material && samePlateSeam(p, hit,
        !!a.plate!.surfaceId && a.plate!.surfaceId === def.armor[p.index].plate?.surfaceId)) : undefined;
    if (previous) (previous.seamKeys ??= []).push(hit.key); else unique.push(hit);
  }
  return unique;
}

/** Apply exactly one queried contact. Returns true when the projectile stops. */
export function resolveShipContact(shell: Shell, hit: ShipContact, actor: Combatant, def: ShipDefinition, emit: (e: DamageEvent) => void, localDirection?: Vec3): boolean {
    const direction = localDirection ?? normalize(worldToLocal(add([actor.motion.x, actor.motion.y, actor.motion.z], shell.velocity), actor.motion));
    shell.visited.push(hit.key, ...hit.seamKeys ?? []);
    shell.lastHitShipId = actor.motion.id;
    const position = localToWorld(hit.point, actor.motion);
    const boundary = def.connections[hit.index];
    const target = hit.kind === 'armor' ? def.armor[hit.index] : hit.kind === 'module' ? def.modules[hit.index] : hit.kind === 'mount' ? def.mounts[hit.index] : { id: connectionId(boundary), name: `Watertight boundary ${connectionId(boundary)}` };
    const evidence: ImpactRecord = { shellId: shell.id, shipId: actor.motion.id, targetId: target.id, targetName: target.name, kind: hit.kind, position: [...hit.point], impactSpeedMps: length(shell.velocity), penetrationBeforeMm: shell.penetrationMm, penetrationAfterMm: shell.penetrationMm, outcome: 'damaged' };
    const kineticDamage = shell.damage * (shell.ap ? .25 : 1);
    const arm = (resistance: number) => {
      if (shell.ap && shell.detonateAtAge === undefined && resistance >= shell.ap.armingResistanceMm)
        shell.detonateAtAge = shell.age + shell.ap.fuzeDelaySeconds;
    };
    const pay = (resistance: number) => {
      const before = shell.penetrationMm;
      shell.penetrationMm = Math.max(0, before - resistance);
      shell.velocity = shell.penetrationMm > 0 && before > 0 ? scale(shell.velocity, (shell.penetrationMm / before) ** (1 / 1.4)) : [0, 0, 0];
    };
    const report = (kind: DamageEvent['kind'], message: string, detonation = false) => emit({
      kind, position, message, shipId: actor.motion.id,
      impact: { ...evidence, penetrationAfterMm: shell.penetrationMm, exitSpeedMps: length(shell.velocity),
        ...(shell.ap ? { fuze: shell.detonateAtAge === undefined ? 'unarmed' as const : 'armed' as const,
          fuzeRemainingSeconds: shell.detonateAtAge === undefined ? undefined : Math.max(0, shell.detonateAtAge - shell.age) } : {}) },
      shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity] },
      ...(hit.kind === 'mount' || (hit.kind === 'armor' && kind !== 'module' && evidence.outcome !== 'backing') ? { normal: rotate(hit.normal, actor.motion) } : {}),
      ...(detonation ? { detonation: true } : {}),
    });
    const stop = (kind: 'stopped' | 'ricochet', message: string) => {
      pay(shell.penetrationMm);
      if (shell.detonateAtAge !== undefined) {
        const mountId = hit.kind === 'mount' ? def.mounts[hit.index].id : hit.kind === 'armor' ? def.armor[hit.index].plate?.mountId : undefined;
        const index = def.mounts.findIndex(m => m.id === mountId), mount = def.mounts[index];
        const point = mount ? worldToLocal(hit.point, { x: mount.position[0], y: mount.position[1], z: mount.position[2], heading: radians(mount.bearingDeg) + actor.mounts[index].train, roll: 0, pitch: 0 }) : [...hit.point] as Vec3;
        shell.lodged = { shipId: actor.motion.id, position: point, mountId };
      }
      evidence.outcome = kind; evidence.terminal = !shell.lodged;
      shell.position = [...position]; report(kind, message); return true;
    };
    if (shell.he) {
      shell.detonateAtAge = shell.age;
      evidence.outcome = 'detonation'; evidence.fuze = 'armed'; evidence.fuzeRemainingSeconds = 0;
      evidence.fragmentBudgetMm = shell.he.fragmentPenetrationMm;
      if (hit.kind === 'armor') {
        const a = def.armor[hit.index], material = a.plate?.material ?? 'steel';
        // Direct contact provides normal fragment paths into the plate. Only a
        // defeated exterior sheet gets the existing caliber-area opening; this
        // does not assume a free blast path through its other protective layers.
        const resistance = plateResponse(a.thicknessMm, material, 1, .01).resistanceMm;
        Object.assign(evidence, { thicknessMm: a.thicknessMm, material, resistanceMm: resistance });
        if (shell.he.fragmentPenetrationMm > resistance && (a.plate?.exterior || a.exterior || (a.exterior === undefined && !a.plate && hit.key.endsWith(':entry')))) {
          evidence.breachAssignments = exteriorBreaches(actor, def, hit.point, hit.normal, shell);
          evidence.compartmentId = evidence.breachAssignments[0]?.compartmentId;
          evidence.breachAreaM2 = evidence.breachAssignments.reduce((n, b) => n + b.areaM2, 0);
        }
      }
      report('contact', `HE contact · ${target.name}`);
      return true;
    }
    if (hit.kind === 'armor') {
      const a = def.armor[hit.index];
      const cosine = Math.abs(direction.reduce((sum, n, i) => sum + n * hit.normal[i], 0));
      const response = plateResponse(a.thicknessMm, a.plate?.material ?? 'steel', cosine, shell.caliberM);
      const resistance = response.resistanceMm;
      Object.assign(evidence, { thicknessMm: a.thicknessMm, material: a.plate?.material ?? 'steel', obliquityDeg: Math.acos(clamp(cosine, 0, 1)) * 180 / Math.PI, resistanceMm: resistance });
      if (a.plate?.material === 'teak') { evidence.outcome = 'backing'; report('penetration', `Passed ${a.name}`); return false; }
      if (response.ricochet) return stop('ricochet', `Ricochet · ${a.name}`);
      arm(resistance);
      if (shell.penetrationMm <= resistance) return stop('stopped', `Stopped by ${a.name}`);
      pay(resistance);
      evidence.outcome = 'penetrated';
      def.connections.forEach((connection, i) => {
        if (connection.armorId !== a.id || (connection.bounds && !contains(connection.bounds, hit.point))) return;
        const state = actor.damage.connections[i];
        state.state = 'damaged'; state.damageAreaM2 = Math.min(connection.areaM2, state.damageAreaM2 + shell.caliberM ** 2);
        (evidence.connectionIds ??= []).push(state.id);
      });
      if (a.plate?.mountId) {
        const mountIndex = def.mounts.findIndex(m => m.id === a.plate!.mountId);
        const mount = actor.mounts[mountIndex];
        const damageKey = `${actor.motion.id}:mount-damage:${a.plate.mountId}`;
        const amount = shell.visited.includes(damageKey) ? 0 : kineticDamage;
        if (amount) shell.visited.push(damageKey);
        evidence.damage = Math.min(mount.hp, amount); mount.hp = Math.max(0, mount.hp - amount);
        evidence.outcome = mount.hp === 0 ? 'destroyed' : 'damaged';
        report('penetration', `Penetrated ${a.name} · ${def.mounts[mountIndex].name} ${mount.hp === 0 ? 'disabled' : 'damaged'}`);
        return false;
      }
      if (a.plate?.exterior || a.exterior || (a.exterior === undefined && !a.plate && hit.key.endsWith(':entry'))) {
        evidence.damage = Math.min(actor.damage.integrity, shell.damage * .2);
        structuralDamage(actor.damage, shell.damage * .2, 'structural-fallback');
        evidence.breachAssignments = exteriorBreaches(actor, def, hit.point, hit.normal, shell);
        evidence.compartmentId = evidence.breachAssignments[0]?.compartmentId;
        evidence.breachAreaM2 = evidence.breachAssignments.reduce((n, b) => n + b.areaM2, 0);
      }
      report('penetration', `Penetrated ${a.name}`);
    } else if (hit.kind === 'module') {
      const m = def.modules[hit.index], state = actor.damage.modules[hit.index];
      evidence.damage = Math.min(state.hp, kineticDamage); evidence.compartmentId = m.compartmentId;
      state.hp = Math.max(0, state.hp - kineticDamage);
      evidence.outcome = state.hp === 0 ? 'destroyed' : 'damaged';
      evidence.resistanceMm = 50; arm(50); pay(50);
      evidence.terminal = shell.penetrationMm === 0;
      if (evidence.terminal && shell.detonateAtAge !== undefined) { shell.lodged = { shipId: actor.motion.id, position: [...hit.point] }; evidence.terminal = false; }
      report('module', `${m.name} ${state.hp === 0 ? 'disabled' : 'damaged'}`);
      checkMagazine(actor, def, hit.index, shell, emit);
      if (shell.penetrationMm === 0) return true;
    } else if (hit.kind === 'boundary') {
      const state = actor.damage.connections[hit.index];
      const resistance = boundary.thicknessMm! / Math.max(.2, Math.abs(direction.reduce((n, v, i) => n + v * hit.normal[i], 0)));
      Object.assign(evidence, { thicknessMm: boundary.thicknessMm, material: 'steel', resistanceMm: resistance, connectionIds: [state.id] });
      arm(resistance);
      if (shell.penetrationMm <= resistance) return stop('stopped', `Stopped by ${target.name}`);
      pay(resistance);
      state.state = 'damaged'; state.damageAreaM2 = Math.min(boundary.areaM2, state.damageAreaM2 + shell.caliberM ** 2);
      evidence.outcome = 'penetrated'; evidence.breachAreaM2 = state.damageAreaM2;
      report('penetration', `Breached ${target.name}`);
    } else {
      const m = def.mounts[hit.index], state = actor.mounts[hit.index];
      Object.assign(evidence, { thicknessMm: m.weapon.armorMm, material: 'steel', resistanceMm: m.weapon.armorMm });
      arm(m.weapon.armorMm);
      if (shell.penetrationMm <= m.weapon.armorMm) return stop('stopped', `Stopped by ${m.name} armor`);
      pay(m.weapon.armorMm);
      const damageKey = `${actor.motion.id}:mount-damage:${m.id}`;
      const amount = shell.visited.includes(damageKey) ? 0 : kineticDamage;
      if (amount) shell.visited.push(damageKey);
      evidence.damage = Math.min(state.hp, amount); state.hp = Math.max(0, state.hp - amount);
      evidence.outcome = state.hp === 0 ? 'destroyed' : 'damaged';
      report('module', `${m.name} ${state.hp === 0 ? 'disabled' : 'damaged'}`);
      return false;
    }
  return false;
}

/** Controlled contact-only utility and compatibility API. Does not advance time
 * or distribute burst damage. Live AP/HE use advanceProjectile, which resolves
 * these contacts individually and accounts for elapsed time between them. */
export function hitShip(shell: Shell, fromWorld: Vec3, toWorld: Vec3, actor: Combatant, def: ShipDefinition, emit: (e: DamageEvent) => void): boolean {
  const direction = normalize(sub(worldToLocal(toWorld, actor.motion), worldToLocal(fromWorld, actor.motion)));
  for (const hit of shipContacts(shell, fromWorld, toWorld, actor, def)) if (resolveShipContact(shell, hit, actor, def, emit, direction)) return true;
  return false;
}

export function updateFlooding(actor: Combatant, def: ShipDefinition, dt: number): void {
  const damage = actor.damage;
  damage.compartments.forEach((state, i) => {
    const c = def.compartments[i];
    const inflow = state.breaches.reduce((sum, breach) => {
      const world = localToWorld(breach.position, actor.motion);
      const radius = breach.radiusM, bottom = world[1] - radius, top = world[1] + radius;
      const wetted = clamp(-bottom / (2 * radius), 0, 1);
      const internalY = localToWorld([breach.position[0], c.center[1] - c.size[1] / 2 + state.waterM3 / c.capacityM3 * c.size[1], breach.position[2]], actor.motion)[1];
      // Uniform aperture strip approximation. Pressure uses the immersed part's
      // center and the water surface in the compartment, never its center X/Z.
      const head = Math.max(0, -Math.max((bottom + Math.min(top, 0)) / 2, internalY));
      return sum + .6 * breach.areaM2 * wetted * Math.sqrt(2 * 9.81 * head);
    }, 0);
    state.waterM3 = clamp(state.waterM3 + (inflow - c.pumpM3PerSecond) * dt, 0, c.capacityM3);
  });
  // Sequential, stable connection order; each transfer conserves water and respects capacity.
  def.connections.forEach((connection, i) => {
    const state = damage.connections[i];
    if (state.state === 'closed') return;
    const ai = state.fromIndex, bi = state.toIndex;
    const a = damage.compartments[ai], b = damage.compartments[bi], ac = def.compartments[ai], bc = def.compartments[bi];
    const portalY = connection.position ? localToWorld(connection.position, actor.motion)[1] : -Infinity;
    const level = (room: typeof ac, water: number) => localToWorld([room.center[0], room.center[1] - room.size[1] / 2 + water / room.capacityM3 * room.size[1], room.center[2]], actor.motion)[1];
    const ay = level(ac, a.waterM3), by = level(bc, b.waterM3);
    const difference = connection.position ? Math.max(0, ay - portalY) - Math.max(0, by - portalY) : ay - by;
    const area = state.state === 'damaged' ? state.damageAreaM2 : connection.areaM2;
    const equalization = Math.abs(difference) / (ac.size[1] / ac.capacityM3 + bc.size[1] / bc.capacityM3);
    const requested = Math.min(equalization, .6 * area * Math.sqrt(2 * 9.81 * Math.abs(difference)) * dt);
    const amount = difference > 0 ? Math.min(requested, a.waterM3, bc.capacityM3 - b.waterM3) : -Math.min(requested, b.waterM3, ac.capacityM3 - a.waterM3);
    a.waterM3 -= amount; b.waterM3 += amount;
  });
  const water = damage.compartments.reduce((n, c) => n + c.waterM3, 0);
  if (!damage.sunk && (damage.integrity <= 0 || water >= def.hull.reserveBuoyancyM3)) {
    damage.defeatCause ??= damage.integrity <= 0 ? 'structural-fallback' : 'flooding';
    damage.sunk = true;
  }
  if (damage.sunk) { actor.motion.y = Math.max(-50, actor.motion.y - dt * .45); return; }
  actor.motion.y = -water / def.hull.waterplaneAreaM2;
  const totalMass = def.hull.massKg + water * 1000;
  actor.motion.roll = clamp(-damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[0], 0) / totalMass * .5, -.45, .45);
  actor.motion.pitch = clamp(damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[2], 0) / totalMass * .02, -.2, .2);
}

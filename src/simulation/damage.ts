import { hullContacts } from './hullContact';
import { structuralHits, EXTERIOR_PLATING_REPLACEMENT_M } from './structure';
import { createStability, updateStability, waterLevel, type StabilityState } from './stability';
import { createControl, heatModule, type ControlState } from './damageControl';
import { damageShellHull, HULL_DAMAGE, penetrationHullDamage } from './durability';
import type { Ammunition, APProjectile, Armor, FloodConnection, HEProjectile, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { ShipState } from './ship';
import { plateHit, plateResponse, samePlateSeam } from './protection';
import type { MountState } from './weapons';
import { add, clamp, contains, length, localToWorld, normalize, radians, rotate, scale, segmentBox, sub, worldToLocal } from './geometry';

export interface Breach { position: Vec3; areaM2: number; radiusM: number; shellId: number; }
export interface CompartmentState { id: string; waterM3: number; breachAreaM2: number; breaches: Breach[]; }
export interface ConnectionState { id: string; state: 'open' | 'closed' | 'damaged'; damageAreaM2: number; fromIndex: number; toIndex: number; }
export const connectionId = (c: FloodConnection) => c.id ?? `${c.fromId}:${c.toId}`;
export type DefeatCause = 'structural-fallback' | 'hull-failure' | 'flooding' | 'magazine' | 'capsize' | 'weapons-lost' | 'ammunition-exhausted';
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
  /** Actual gameplay HP lost, distinct from the local equipment damage above. */
  hullDamage?: number;
  connectionIds?: string[];
  breachAssignments?: { compartmentId: string; areaM2: number; position: Vec3 }[];
}
export interface DamageState {
  control: ControlState; stability: StabilityState;
  /** Gameplay hull durability. Equipment HP and physical flooding are separate. */
  integrity: number; maxIntegrity: number; modules: { id: string; hp: number; detonated: boolean; ignition: number }[];
  compartments: CompartmentState[]; connections: ConnectionState[]; sunk: boolean; defeatCause?: DefeatCause;
}
export interface Combatant { torpedoLaunchers?: import('./torpedoes').TorpedoLauncherState[]; depthChargeLaunchers?: { id: string; ammo: number }[]; airWing?: import('./aircraft').AirWingState; motion: ShipState; mounts: MountState[]; damage: DamageState; torpedoTubes?: { id: string; ammo: number }[]; submarine?: import('./submarine').SubmarineState; }
export type ShellType = 'AP' | 'HE';
export interface SurfaceImpact {
  position: Vec3; normal: Vec3; direction: Vec3; mountId?: string;
  outcome: 'penetration' | 'stopped' | 'ricochet';
}
export interface Shell {
  id: number; ownerId: string; position: Vec3; velocity: Vec3; age: number;
  penetrationMm: number; damage: number; caliberM: number; visited: string[];
  dragPerSecond?: number;
  ap?: APProjectile;
  he?: HEProjectile; ammunition?: Ammunition;
  type?: ShellType;
  remainingModuleDamage?: number;
  /** Per-victim hull damage already paid by this projectile. */
  hullDamage?: Record<string, number>;
  detonateAtAge?: number;
  lastHitShipId?: string;
  /** Position is ship-local, or mount-local when attached to an articulated gunhouse. */
  lodged?: { shipId: string; position: Vec3; mountId?: string };
}
/** Serializable evidence for render-side effects; never feeds back into damage. */
export interface BallisticEffectData {
  shell?: Pick<Shell, 'id' | 'caliberM' | 'velocity' | 'ammunition' | 'type'>;
  surfaceImpact?: SurfaceImpact;
  normal?: Vec3;
  detonation?: boolean;
  blastRadiusM?: number;
}
export interface DamageEvent extends BallisticEffectData { kind: 'penetration' | 'contact' | 'ricochet' | 'stopped' | 'module' | 'sunk' | 'burst'; position: Vec3; message: string; shipId: string; impact?: ImpactRecord; defeatCause?: DefeatCause; }
/** Displacement-based gameplay durability, shared by every blueprint. */
export function maxHullIntegrity(def: ShipDefinition): number {
  return Math.round((300 + 1450 * Math.sqrt(def.hull.massKg / 70_000_000)) / 10) * 10;
}
export function createDamage(def: ShipDefinition): DamageState {
  return { stability: createStability(), control: createControl(def), integrity: maxHullIntegrity(def), maxIntegrity: maxHullIntegrity(def), modules: def.modules.map(m => ({ id: m.id, hp: m.hp, detonated: false, ignition: 0 })), compartments: def.compartments.map(c => ({ id: c.id, waterM3: 0, breachAreaM2: 0, breaches: [] })), connections: def.connections.map(c => ({ id: connectionId(c), state: c.state ?? 'open', damageAreaM2: c.state === 'damaged' ? c.areaM2 : 0, fromIndex: def.compartments.findIndex(r => r.id === c.fromId), toIndex: def.compartments.findIndex(r => r.id === c.toId) })), sunk: false };
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
export { systemHealth } from './machinery';

/** Split the same strip approximation used by inflow at authored room heights.
 * An opening across a watertight deck can reach the room below its center. */
function exteriorBreaches(actor: Combatant, def: ShipDefinition, point: Vec3, normal: Vec3, shell: Shell): NonNullable<ImpactRecord['breachAssignments']> {
  const area = shell.caliberM ** 2, radius = Math.sqrt(area / Math.PI), bottom = point[1] - radius, top = point[1] + radius;
  if (!def.floodRegions || Math.abs(normal[1]) > .5) {
    const room = def.compartments.map((c, i) => ({ i, distance: Math.min(...(c.cells ?? [c]).map(cell => Math.hypot(...point.map((n, axis) => Math.max(0, Math.abs(n - cell.center[axis]) - cell.size[axis] / 2))))) })).sort((a, b) => a.distance - b.distance)[0];
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
    if (!region) {
      const nearest = def.compartments.map((c, index) => ({ index, distance: Math.min(...(c.cells ?? [c]).map(cell => Math.hypot(...position.map((n, axis) => Math.max(0, Math.abs(n - cell.center[axis]) - cell.size[axis] / 2))))) })).sort((a,b) => a.distance-b.distance)[0];
      if (nearest) { const c = actor.damage.compartments[nearest.index]; result.push({ compartmentId: c.id, areaM2: addBreach(c, position, area * (cuts[i] - cuts[i-1]) / (2 * radius), shell.id, (cuts[i]-cuts[i-1])/2), position }); }
      continue;
    }
    const c = actor.damage.compartments.find(c => c.id === region.compartmentId);
    if (!c) continue;
    result.push({ compartmentId: c.id, areaM2: addBreach(c, position, area * (cuts[i] - cuts[i - 1]) / (2 * radius), shell.id, (cuts[i] - cuts[i - 1]) / 2), position });
  }
  return result;
}

export function contactArmor(def: ShipDefinition, hit: ShipContact): Armor {
  return hit.armor ?? (hit.index >= 0 ? def.armor[hit.index] : { id: hit.key.split(":").slice(1).join("-"), name: 'Hull shell · estimated', thicknessMm: def.stability!.shellThicknessMm, center: hit.point, size: [.001, .001, .001], plate: { vertices: [], material: 'steel', exterior: true } });
}
export interface ShipContact { t: number; key: string; kind: 'armor' | 'module' | 'mount' | 'boundary'; index: number; point: Vec3; normal: Vec3; onEdge?: boolean; seamKeys?: string[]; armor?: Armor; }
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
  if (def.stability || def.structuralPlating) {
    const crossings = def.structuralPlating
      ? structuralHits(from, to, def).map(h => ({ ...h, index: h.triangle, surface: h.surface }))
      : hullContacts(def.hull, from, to).map(h => ({ ...h, surface: undefined }));
    let previous: ShipContact | undefined;
    for (const h of crossings) {
      const key = `${actor.motion.id}:hull:${h.surface?.id ?? 'shell'}:${h.index}`;
      if (shell.visited.includes(key)) continue;
      const allowance = def.structuralPlating ? EXTERIOR_PLATING_REPLACEMENT_M : 5;
      const path = normalize(sub(to, from));
      const probeFrom = add(h.point, scale(path, -allowance)), probeTo = add(h.point, scale(path, allowance));
      const covered = (h.surface?.hull ?? true) && def.armor.some(a => {
        if (a.plate?.mountId || !(a.plate?.exterior || a.exterior || !a.plate) || ![0,1,2].every(i => Math.abs(a.center[i] - h.point[i]) <= a.size[i] / 2 + allowance)) return false;
        const p = a.plate ? plateHit(probeFrom, probeTo, a, def, trains) : segmentBox(probeFrom, probeTo, a);
        return p && Math.abs(p.normal.reduce((n, v, i) => n + v * h.normal[i], 0)) > .5;
      });
      if (covered) continue;
      if (previous && previous.armor?.id === h.surface?.id && length(sub(previous.point, h.point)) < 1e-5) { (previous.seamKeys ??= []).push(key); continue; }
      previous = { ...h, index: -1, key, kind: 'armor', ...(h.surface ? { armor: { id: h.surface.id, name: `${h.surface.name} plating`, thicknessMm: h.surface.thicknessMm, center: h.point, size: [.001, .001, .001], plate: { vertices: [], material: 'steel', exterior: h.surface.hull } } as Armor } : {}) }; hits.push(previous);
    }
  }
  hits.sort((a, b) => a.t - b.t || Number(b.kind === 'armor') - Number(a.kind === 'armor') || (a.kind==='armor' && b.kind==='armor' ? contactArmor(def,b).thicknessMm-contactArmor(def,a).thicknessMm : 0) || a.key.localeCompare(b.key));
  const unique: ShipContact[] = [];
  for (const hit of hits) {
    const a = hit.kind === 'armor' ? contactArmor(def,hit) : undefined;
    const previous = a?.plate && hit.onEdge ? unique.find(p => p.kind === 'armor' &&
      contactArmor(def,p).plate?.material === a.plate!.material && samePlateSeam(p, hit,
        !!a.plate!.surfaceId && a.plate!.surfaceId === contactArmor(def,p).plate?.surfaceId)) : undefined;
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
    const target = hit.kind === 'armor' ? contactArmor(def,hit) : hit.kind === 'module' ? def.modules[hit.index] : hit.kind === 'mount' ? def.mounts[hit.index] : { id: connectionId(boundary), name: `Watertight boundary ${connectionId(boundary)}` };
    const evidence: ImpactRecord = { shellId: shell.id, shipId: actor.motion.id, targetId: target.id, targetName: target.name, kind: hit.kind, position: [...hit.point], impactSpeedMps: length(shell.velocity), penetrationBeforeMm: shell.penetrationMm, penetrationAfterMm: shell.penetrationMm, outcome: 'damaged' };
    // A successful AP equipment strike must be consequential even when its
    // delayed burst occurs elsewhere. Share this budget across the whole path;
    // turret exit plates and downstream modules cannot multiply direct damage.
    const kineticDamage = shell.damage * (shell.ap ? .75 : 1);
    const incomingVelocity: Vec3 = [...shell.velocity];
    const damageEquipment = (hp: number) => {
      const amount = Math.min(hp, shell.remainingModuleDamage ?? kineticDamage);
      shell.remainingModuleDamage = Math.max(0, (shell.remainingModuleDamage ?? kineticDamage) - amount);
      return amount;
    };
    const surfaceEvidence = (kind: DamageEvent['kind']): SurfaceImpact | undefined => {
      if (!(hit.kind === 'mount' || hit.kind === 'armor') || evidence.outcome === 'backing') return;
      const mountId = hit.kind === 'mount' ? def.mounts[hit.index].id : contactArmor(def, hit).plate?.mountId;
      const i = def.mounts.findIndex(m => m.id === mountId), mount = def.mounts[i];
      const pose = mount && { x: mount.position[0], y: mount.position[1], z: mount.position[2], heading: radians(mount.bearingDeg) + actor.mounts[i].train, roll: 0, pitch: 0 };
      return { position: pose ? worldToLocal(hit.point, pose) : [...hit.point],
        normal: pose ? worldToLocal(hit.normal, { ...pose, x: 0, y: 0, z: 0 }) : [...hit.normal],
        direction: pose ? worldToLocal(direction, { ...pose, x: 0, y: 0, z: 0 }) : [...direction], mountId,
        outcome: kind === 'ricochet' ? 'ricochet' : kind === 'stopped' ? 'stopped' : 'penetration' };
    };
    const arm = (resistance: number) => {
      if (shell.ap && shell.detonateAtAge === undefined && resistance >= shell.ap.armingResistanceMm)
        shell.detonateAtAge = shell.age + shell.ap.fuzeDelaySeconds;
    };
    const pay = (resistance: number) => {
      const before = shell.penetrationMm;
      shell.penetrationMm = Math.max(0, before - resistance);
      shell.velocity = shell.penetrationMm > 0 && before > 0 ? scale(shell.velocity, (shell.penetrationMm / before) ** (1 / 1.4)) : [0, 0, 0];
    };
    const report = (kind: DamageEvent['kind'], message: string, detonation = false) => {
      if ((evidence.damage ?? 0) > 0) evidence.hullDamage = (evidence.hullDamage ?? 0) + damageShellHull(shell, actor, shell.damage * HULL_DAMAGE.equipment);
      emit({
      kind, position, message, shipId: actor.motion.id,
      impact: { ...evidence, penetrationAfterMm: shell.penetrationMm, exitSpeedMps: length(shell.velocity),
        ...(shell.ap ? { fuze: shell.detonateAtAge === undefined ? 'unarmed' as const : 'armed' as const,
          fuzeRemainingSeconds: shell.detonateAtAge === undefined ? undefined : Math.max(0, shell.detonateAtAge - shell.age) } : {}) },
      shell: { id: shell.id, caliberM: shell.caliberM, velocity: incomingVelocity, ammunition: shell.ammunition, type: shell.type ?? (shell.ammunition === 'he' ? 'HE' : 'AP') },
      surfaceImpact: surfaceEvidence(kind),
      ...(hit.kind === 'mount' || (hit.kind === 'armor' && kind !== 'module' && evidence.outcome !== 'backing') ? { normal: rotate(hit.normal, actor.motion) } : {}),
      ...(detonation ? { detonation: true } : {}),
      });
    };
    const stop = (kind: 'stopped' | 'ricochet', message: string) => {
      pay(shell.penetrationMm);
      if (shell.detonateAtAge !== undefined) {
        const mountId = hit.kind === 'mount' ? def.mounts[hit.index].id : hit.kind === 'armor' ? contactArmor(def,hit).plate?.mountId : undefined;
        const index = def.mounts.findIndex(m => m.id === mountId), mount = def.mounts[index];
        // Keep the burst on the incoming side. An origin exactly on the plate
        // makes fresh blast rays pay that armor in both directions.
        const origin = add(hit.point, scale(direction, -1e-4));
        const point = mount ? worldToLocal(origin, { x: mount.position[0], y: mount.position[1], z: mount.position[2], heading: radians(mount.bearingDeg) + actor.mounts[index].train, roll: 0, pitch: 0 }) : origin;
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
        const a = contactArmor(def,hit), material = a.plate?.material ?? 'steel';
        // Direct contact provides normal fragment paths into the plate. Only a
        // defeated exterior sheet gets the existing caliber-area opening; this
        // does not assume a free blast path through its other protective layers.
        const resistance = plateResponse(a.thicknessMm, material, 1, .01).resistanceMm;
        Object.assign(evidence, { thicknessMm: a.thicknessMm, material, resistanceMm: resistance });
        if (shell.he.fragmentPenetrationMm > resistance && resistance > 0)
          evidence.hullDamage = damageShellHull(shell, actor, shell.he.damage * HULL_DAMAGE.hePenetration);
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
      const a = contactArmor(def,hit);
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
      evidence.hullDamage = damageShellHull(shell, actor, penetrationHullDamage(shell, resistance));
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
        const amount = shell.visited.includes(damageKey) ? 0 : damageEquipment(mount.hp);
        if (amount) shell.visited.push(damageKey);
        evidence.damage = Math.min(mount.hp, amount); mount.hp = Math.max(0, mount.hp - amount);
        evidence.outcome = mount.hp === 0 ? 'destroyed' : 'damaged';
        report('penetration', `Penetrated ${a.name} · ${def.mounts[mountIndex].name} ${mount.hp === 0 ? 'disabled' : 'damaged'}`);
        return false;
      }
      if (a.plate?.exterior || a.exterior || (a.exterior === undefined && !a.plate && hit.key.endsWith(':entry'))) {

        evidence.breachAssignments = exteriorBreaches(actor, def, hit.point, hit.normal, shell);
        evidence.compartmentId = evidence.breachAssignments[0]?.compartmentId;
        evidence.breachAreaM2 = evidence.breachAssignments.reduce((n, b) => n + b.areaM2, 0);
      }
      report('penetration', `Penetrated ${a.name}`);
    } else if (hit.kind === 'module') {
      const m = def.modules[hit.index], state = actor.damage.modules[hit.index];
      evidence.damage = damageEquipment(state.hp); evidence.compartmentId = m.compartmentId;
      state.hp = Math.max(0, state.hp - evidence.damage);
      evidence.outcome = state.hp === 0 ? 'destroyed' : 'damaged';
      evidence.resistanceMm = 50; arm(50); pay(50);
      evidence.terminal = shell.penetrationMm === 0;
      if (evidence.terminal && shell.detonateAtAge !== undefined) { shell.lodged = { shipId: actor.motion.id, position: [...hit.point] }; evidence.terminal = false; }
      report('module', `${m.name} ${state.hp === 0 ? 'disabled' : 'damaged'}`);
      if (shell.ap || shell.he) heatModule(actor, def, hit.index, evidence.damage * .15);
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
      const amount = shell.visited.includes(damageKey) ? 0 : damageEquipment(state.hp);
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
  if (!damage.sunk && damage.integrity <= 0) {
    damage.sunk = true;
    damage.defeatCause = 'hull-failure';
  }
  updateStability(actor, def, dt);
  damage.compartments.forEach((state, i) => {
    const c = def.compartments[i];
    const inflow = state.breaches.reduce((sum, breach) => {
      const world = localToWorld(breach.position, actor.motion);
      const radius = breach.radiusM, bottom = world[1] - radius, top = world[1] + radius;
      const internalY = waterLevel(actor, def, i);
      // Integrate the uniform aperture strip between pressure discontinuities.
      // Water can enter or leave through the same opening as the ship heels.
      const cuts = [bottom, top, ...[0, internalY].filter(y => y > bottom && y < top)].sort((a,b)=>a-b);
      let flow = 0;
      for (let j=1;j<cuts.length;j++) {
        const a=cuts[j-1], b=cuts[j], mid=(a+b)/2;
        if (mid < Math.min(0,internalY)) flow += Math.sign(-internalY) * Math.sqrt(Math.abs(internalY)) * (b-a);
        else if (mid < Math.max(0,internalY)) {
          const surface=Math.max(0,internalY), sign=internalY>0?-1:1;
          flow += sign * 2/3 * (Math.max(0,surface-a)**1.5-Math.max(0,surface-b)**1.5);
        }
      }
      return sum + .6 * breach.areaM2 / (2*radius) * Math.sqrt(2*9.81) * flow;
    }, 0);
    state.waterM3 = clamp(state.waterM3 + (inflow - c.pumpM3PerSecond - (damage.control.pumping[i] ?? 0)) * dt, 0, c.capacityM3);
  });
  // Sequential, stable connection order; each transfer conserves water and respects capacity.
  def.connections.forEach((connection, i) => {
    const state = damage.connections[i];
    if (state.state === 'closed') return;
    const ai = state.fromIndex, bi = state.toIndex;
    const a = damage.compartments[ai], b = damage.compartments[bi], ac = def.compartments[ai], bc = def.compartments[bi];
    const portalY = connection.position ? localToWorld(connection.position, actor.motion)[1] : -Infinity;
    const ay = waterLevel(actor, def, ai), by = waterLevel(actor, def, bi);
    const difference = connection.position ? Math.max(0, ay - portalY) - Math.max(0, by - portalY) : ay - by;
    const area = state.state === 'damaged' ? state.damageAreaM2 : connection.areaM2;
    const direction = Math.sign(difference);
    let requested = Math.min(.6 * area * Math.sqrt(2 * 9.81 * Math.abs(difference)) * dt,
      direction > 0 ? a.waterM3 : b.waterM3, direction > 0 ? bc.capacityM3 - b.waterM3 : ac.capacityM3 - a.waterM3);
    const remainingHead = (transfer: number) => {
      const from = waterLevel(actor, def, ai, a.waterM3 - direction * transfer);
      const to = waterLevel(actor, def, bi, b.waterM3 + direction * transfer);
      return direction * (connection.position ? Math.max(0, from - portalY) - Math.max(0, to - portalY) : from - to);
    };
    // Only solve when flow would overshoot. The upright bounding-box area is
    // not the waterplane area of a heeled or compound compartment.
    if (requested > 0 && remainingHead(requested) < 0) {
      let low = 0, high = requested;
      for (let j = 0; j < 28; j++) {
        const mid = (low + high) / 2;
        if (remainingHead(mid) >= 0) low = mid; else high = mid;
      }
      requested = low;
    }
    const amount = direction * requested;
    a.waterM3 -= amount; b.waterM3 += amount;
  });
  const water = damage.compartments.reduce((n, c) => n + c.waterM3, 0);
  if (!def.stability && !damage.sunk && water >= def.hull.reserveBuoyancyM3) {
    damage.defeatCause ??= 'flooding';
    damage.sunk = true;
  }
  if (damage.sunk) {
    const y = Math.min(actor.motion.y, Math.max(def.submarine ? -1000 : -50, actor.motion.y - dt * .45));
    actor.motion.verticalSpeed = dt > 0 ? (y - actor.motion.y) / dt : 0;
    actor.motion.y = y; return;
  }
  if (def.stability) return;
  if (!actor.submarine) actor.motion.y = -water / def.hull.waterplaneAreaM2;
  const totalMass = def.hull.massKg + water * 1000;
  actor.motion.roll = clamp(-damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[0], 0) / totalMass * .5, -.45, .45);
  actor.motion.pitch = clamp(damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[2], 0) / totalMass * .02, -.2, .2);
}

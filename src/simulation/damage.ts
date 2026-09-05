import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { ShipState } from './ship';
import { plateHit, samePlateSeam } from './protection';
import type { MountState } from './weapons';
import { add, clamp, contains, length, localToWorld, normalize, radians, rotate, segmentBox, sub, worldToLocal } from './geometry';

export interface Breach { position: Vec3; areaM2: number; radiusM: number; shellId: number; }
export interface CompartmentState { id: string; waterM3: number; breachAreaM2: number; breaches: Breach[]; }
export type DefeatCause = 'structural-fallback' | 'flooding' | 'magazine';
export interface ImpactRecord {
  shellId: number; shipId: string; targetId: string; targetName: string;
  /** Position is ship-local; DamageEvent.position is world-space. */
  kind: 'armor' | 'module' | 'mount'; position: Vec3;
  thicknessMm?: number; material?: string; obliquityDeg?: number; resistanceMm?: number;
  penetrationBeforeMm: number; penetrationAfterMm: number;
  outcome: 'penetrated' | 'ricochet' | 'stopped' | 'damaged' | 'destroyed' | 'detonation' | 'backing';
  damage?: number; compartmentId?: string; breachAreaM2?: number; terminal?: boolean;
}
export interface DamageState {
  integrity: number; modules: { id: string; hp: number; detonated: boolean }[];
  compartments: CompartmentState[]; sunk: boolean; defeatCause?: DefeatCause;
}
export interface Combatant { motion: ShipState; mounts: MountState[]; damage: DamageState; }
export interface Shell {
  id: number; ownerId: string; position: Vec3; velocity: Vec3; age: number;
  penetrationMm: number; damage: number; caliberM: number; visited: string[];
}
/** Serializable evidence for render-side effects; never feeds back into damage. */
export interface BallisticEffectData {
  shell?: Pick<Shell, 'id' | 'caliberM' | 'velocity'>;
  normal?: Vec3;
  detonation?: boolean;
}
export interface DamageEvent extends BallisticEffectData { kind: 'penetration' | 'ricochet' | 'stopped' | 'module' | 'sunk'; position: Vec3; message: string; shipId: string; impact?: ImpactRecord; defeatCause?: DefeatCause; }
export function createDamage(def: ShipDefinition): DamageState {
  return { integrity: 1000, modules: def.modules.map(m => ({ id: m.id, hp: m.hp, detonated: false })), compartments: def.compartments.map(c => ({ id: c.id, waterM3: 0, breachAreaM2: 0, breaches: [] })), sunk: false };
}
export function addBreach(state: CompartmentState, position: Vec3, areaM2: number, shellId: number): number {
  const added = Math.max(0, Math.min(areaM2, 4 - state.breachAreaM2));
  if (added > 0) {
    const radiusM = Math.sqrt(added / Math.PI);
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
export function systemHealth(actor: Combatant, def: ShipDefinition, kind: 'engine' | 'steering'): number {
  const modules = def.modules.filter(m => m.kind === kind);
  return actor.damage.sunk ? 0 : modules.length ? modules.reduce((n, m) => n + (actor.damage.modules.find(s => s.id === m.id)!.hp / m.hp), 0) / modules.length : 1;
}

/** An explicit gameplay approximation: AP penetration budget through ordered plate/box surfaces.
 * No historical claim, fuze simulation, or fragment simulation. */
export function hitShip(shell: Shell, fromWorld: Vec3, toWorld: Vec3, actor: Combatant, def: ShipDefinition, emit: (e: DamageEvent) => void): boolean {
  const from = worldToLocal(fromWorld, actor.motion), to = worldToLocal(toWorld, actor.motion);
  const direction = normalize(sub(to, from));
  type Hit = { t: number; key: string; kind: 'armor' | 'module' | 'mount'; index: number; point: Vec3; normal: Vec3; onEdge?: boolean };
  const hits: Hit[] = [];
  def.armor.forEach((a, index) => {
    if (a.plate) {
      const key = `${actor.motion.id}:armor:${a.id}:plate`;
      const hit = plateHit(from, to, a, def, actor.mounts.map(m => m.train));
      if (hit && !shell.visited.includes(key)) hits.push({ ...hit, key, kind:'armor', index });
      return;
    }
    const hit = segmentBox(from, to, a);
    if (!hit) return;
    const entryKey = `${actor.motion.id}:armor:${a.id}:entry`;
    if (!contains(a, from) && !shell.visited.includes(entryKey)) hits.push({ ...hit, key: entryKey, kind: 'armor', index });
    const exitKey = `${actor.motion.id}:armor:${a.id}:exit`;
    if (hit.exit < 1 && !shell.visited.includes(exitKey)) {
      const point = add(from, sub(to, from).map(v => v * hit.exit) as Vec3);
      const distances = point.map((v, i) => Math.abs(Math.abs(v - a.center[i]) - a.size[i] / 2));
      const axis = distances.indexOf(Math.min(...distances));
      const normal: Vec3 = [0, 0, 0]; normal[axis] = Math.sign(point[axis] - a.center[axis]);
      hits.push({ t: hit.exit, key: exitKey, kind: 'armor', index, point, normal });
    }
  });
  def.modules.forEach((m, index) => {
    const key = `${actor.motion.id}:module:${m.id}`, hit = segmentBox(from, to, m);
    if (hit && !shell.visited.includes(key)) hits.push({ ...hit, key, kind: 'module', index });
  });
  def.mounts.forEach((m, index) => {
    if (def.armor.some(a => a.plate?.mountId === m.id)) return;
    const yaw = radians(m.bearingDeg) + actor.mounts[index].train;
    const mountPose = { x: m.position[0], y: m.position[1], z: m.position[2], heading: yaw, roll: 0, pitch: 0 };
    const a = worldToLocal(from, mountPose), b = worldToLocal(to, mountPose), w = m.weapon;
    const hit = segmentBox(a, b, { center: [0, w.gunhouseSize[2] / 2, 0], size: [w.gunhouseSize[1], w.gunhouseSize[2], w.gunhouseSize[0]] });
    const key = `${actor.motion.id}:mount:${m.id}`;
    if (hit && !shell.visited.includes(key)) hits.push({ ...hit, point: localToWorld(hit.point, mountPose), normal: rotate(hit.normal, mountPose), key, kind: 'mount', index });
  });
  hits.sort((a, b) => a.t - b.t || Number(b.kind === 'armor') - Number(a.kind === 'armor') || (a.kind==='armor' && b.kind==='armor' ? def.armor[b.index].thicknessMm-def.armor[a.index].thicknessMm : 0) || a.key.localeCompare(b.key));
  const crossedPlateEdges: Hit[] = [];
  for (const hit of hits) {
    shell.visited.push(hit.key);
    const position = localToWorld(hit.point, actor.motion);
    const target = hit.kind === 'armor' ? def.armor[hit.index] : hit.kind === 'module' ? def.modules[hit.index] : def.mounts[hit.index];
    const evidence: ImpactRecord = { shellId: shell.id, shipId: actor.motion.id, targetId: target.id, targetName: target.name, kind: hit.kind, position: [...hit.point], penetrationBeforeMm: shell.penetrationMm, penetrationAfterMm: shell.penetrationMm, outcome: 'damaged' };
    const report = (kind: DamageEvent['kind'], message: string, detonation = false) => emit({
      kind, position, message, shipId: actor.motion.id,
      impact: { ...evidence, penetrationAfterMm: shell.penetrationMm },
      shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity] },
      ...(hit.kind === 'mount' || (hit.kind === 'armor' && kind !== 'module' && evidence.outcome !== 'backing') ? { normal: rotate(hit.normal, actor.motion) } : {}),
      ...(detonation ? { detonation: true } : {}),
    });
    if (hit.kind === 'armor') {
      const a = def.armor[hit.index];
      if (a.plate && hit.onEdge) {
        if (crossedPlateEdges.some(previous=>def.armor[previous.index].plate?.material===a.plate!.material && samePlateSeam(previous,hit))) continue;
        crossedPlateEdges.push(hit);
      }
      const cosine = Math.abs(direction.reduce((sum, n, i) => sum + n * hit.normal[i], 0));
      const resistance = a.plate?.material === 'teak' ? 0 : a.thicknessMm / Math.max(.2, cosine);
      Object.assign(evidence, { thicknessMm: a.thicknessMm, material: a.plate?.material ?? 'steel', obliquityDeg: Math.acos(clamp(cosine, 0, 1)) * 180 / Math.PI, resistanceMm: resistance });
      if (a.plate?.material === 'teak') { evidence.outcome = 'backing'; report('penetration', `Passed ${a.name}`); continue; }
      if (cosine < .2) { evidence.outcome = 'ricochet'; evidence.terminal = true; report('ricochet', `Ricochet · ${a.name}`); return true; }
      if (shell.penetrationMm < resistance) { evidence.outcome = 'stopped'; evidence.terminal = true; report('stopped', `Stopped by ${a.name}`); return true; }
      shell.penetrationMm -= resistance;
      evidence.outcome = 'penetrated';
      if (a.plate?.mountId) {
        const mountIndex = def.mounts.findIndex(m => m.id === a.plate!.mountId);
        const mount = actor.mounts[mountIndex];
        evidence.damage = Math.min(mount.hp, shell.damage); mount.hp = Math.max(0, mount.hp - shell.damage);
        evidence.outcome = mount.hp === 0 ? 'destroyed' : 'damaged'; evidence.terminal = true;
        report('penetration', `Penetrated ${a.name} · ${def.mounts[mountIndex].name} ${mount.hp === 0 ? 'disabled' : 'damaged'}`);
        return true;
      }
      if (a.plate?.exterior || hit.key.endsWith(':entry')) {
        evidence.damage = Math.min(actor.damage.integrity, shell.damage * .2);
        structuralDamage(actor.damage, shell.damage * .2, 'structural-fallback');
        // Assign a breach to the closest modeled space. Breach extent is a tunable blast approximation.
        const candidates = def.compartments.map((c, i) => ({ c, i, distance: length(sub(c.center, hit.point)) })).sort((a, b) => a.distance - b.distance);
        if (candidates[0]) {
          const c = actor.damage.compartments[candidates[0].i];
          evidence.compartmentId = c.id;
          evidence.breachAreaM2 = addBreach(c, hit.point, shell.caliberM * shell.caliberM, shell.id);
        }
      }
      report('penetration', `Penetrated ${a.name}`);
    } else if (hit.kind === 'module') {
      const m = def.modules[hit.index], state = actor.damage.modules[hit.index];
      if (state.hp === 0) continue;
      evidence.damage = Math.min(state.hp, shell.damage); evidence.compartmentId = m.compartmentId;
      state.hp = Math.max(0, state.hp - shell.damage);
      evidence.outcome = state.hp === 0 ? 'destroyed' : 'damaged';
      shell.penetrationMm = Math.max(0, shell.penetrationMm - 50);
      evidence.terminal = shell.penetrationMm === 0;
      report('module', `${m.name} ${state.hp === 0 ? 'disabled' : 'damaged'}`);
      if (m.kind === 'magazine' && state.hp === 0 && !state.detonated) {
        state.detonated = true;
        structuralDamage(actor.damage, 450, 'magazine');
        const c = actor.damage.compartments.find(c => c.id === m.compartmentId)!;
        evidence.outcome = 'detonation'; evidence.damage = 450;
        evidence.breachAreaM2 = addBreach(c, m.center, 2, shell.id);
        report('module', `${m.name} detonation`, true);
      }
      if (shell.penetrationMm === 0) return true;
    } else {
      const m = def.mounts[hit.index], state = actor.mounts[hit.index];
      Object.assign(evidence, { thicknessMm: m.weapon.armorMm, material: 'steel', resistanceMm: m.weapon.armorMm, terminal: true });
      if (shell.penetrationMm < m.weapon.armorMm) { evidence.outcome = 'stopped'; report('stopped', `Stopped by ${m.name} armor`); return true; }
      shell.penetrationMm -= m.weapon.armorMm;
      evidence.damage = Math.min(state.hp, shell.damage); state.hp = Math.max(0, state.hp - shell.damage);
      evidence.outcome = state.hp === 0 ? 'destroyed' : 'damaged';
      report('module', `${m.name} ${state.hp === 0 ? 'disabled' : 'damaged'}`);
      return true;
    }
  }
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
  def.connections.forEach(connection => {
    const ai = def.compartments.findIndex(c => c.id === connection.fromId), bi = def.compartments.findIndex(c => c.id === connection.toId);
    const a = damage.compartments[ai], b = damage.compartments[bi], ac = def.compartments[ai], bc = def.compartments[bi];
    const difference = a.waterM3 / ac.capacityM3 - b.waterM3 / bc.capacityM3;
    const requested = connection.areaM2 * Math.sqrt(2 * 9.81 * Math.abs(difference) * Math.min(ac.size[1], bc.size[1])) * dt;
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

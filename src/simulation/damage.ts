import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { ShipState } from './ship';
import type { MountState } from './weapons';
import { add, clamp, contains, length, localToWorld, normalize, radians, segmentBox, sub, worldToLocal } from './geometry';

export interface CompartmentState { id: string; waterM3: number; breachAreaM2: number; breachHeight: number; }
export interface DamageState {
  integrity: number; modules: { id: string; hp: number; detonated: boolean }[];
  compartments: CompartmentState[]; sunk: boolean;
}
export interface Combatant { motion: ShipState; mounts: MountState[]; damage: DamageState; }
export interface Shell {
  id: number; ownerId: string; position: Vec3; velocity: Vec3; age: number;
  penetrationMm: number; damage: number; caliberM: number; visited: string[];
}
export interface DamageEvent { kind: 'penetration' | 'ricochet' | 'stopped' | 'module' | 'sunk'; position: Vec3; message: string; shipId: string; }
export function createDamage(def: ShipDefinition): DamageState {
  return { integrity: 1000, modules: def.modules.map(m => ({ id: m.id, hp: m.hp, detonated: false })), compartments: def.compartments.map(c => ({ id: c.id, waterM3: 0, breachAreaM2: 0, breachHeight: 0 })), sunk: false };
}
export function systemHealth(actor: Combatant, def: ShipDefinition, kind: 'engine' | 'steering'): number {
  const modules = def.modules.filter(m => m.kind === kind);
  return actor.damage.sunk ? 0 : modules.length ? modules.reduce((n, m) => n + (actor.damage.modules.find(s => s.id === m.id)!.hp / m.hp), 0) / modules.length : 1;
}

/** An explicit gameplay approximation: AP penetration budget through ordered box surfaces.
 * No historical claim, fuze simulation, or fragment simulation. */
export function hitShip(shell: Shell, fromWorld: Vec3, toWorld: Vec3, actor: Combatant, def: ShipDefinition, emit: (e: DamageEvent) => void): boolean {
  const from = worldToLocal(fromWorld, actor.motion), to = worldToLocal(toWorld, actor.motion);
  const direction = normalize(sub(to, from));
  type Hit = { t: number; key: string; kind: 'armor' | 'module' | 'mount'; index: number; point: Vec3; normal: Vec3 };
  const hits: Hit[] = [];
  def.armor.forEach((a, index) => {
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
    const yaw = radians(m.bearingDeg) + actor.mounts[index].train;
    const mountPose = { x: m.position[0], y: m.position[1], z: m.position[2], heading: yaw, roll: 0, pitch: 0 };
    const a = worldToLocal(from, mountPose), b = worldToLocal(to, mountPose), w = m.weapon;
    const hit = segmentBox(a, b, { center: [0, w.gunhouseSize[2] / 2, 0], size: [w.gunhouseSize[1], w.gunhouseSize[2], w.gunhouseSize[0]] });
    const key = `${actor.motion.id}:mount:${m.id}`;
    if (hit && !shell.visited.includes(key)) hits.push({ ...hit, point: localToWorld(hit.point, mountPose), key, kind: 'mount', index });
  });
  hits.sort((a, b) => a.t - b.t || Number(b.kind === 'armor') - Number(a.kind === 'armor') || a.key.localeCompare(b.key));
  for (const hit of hits) {
    shell.visited.push(hit.key);
    const position = localToWorld(hit.point, actor.motion);
    const report = (kind: DamageEvent['kind'], message: string) => emit({ kind, position, message, shipId: actor.motion.id });
    if (hit.kind === 'armor') {
      const a = def.armor[hit.index];
      const cosine = Math.abs(direction.reduce((sum, n, i) => sum + n * hit.normal[i], 0));
      if (cosine < .2) { report('ricochet', `Ricochet · ${a.name}`); return true; }
      const resistance = a.thicknessMm / Math.max(.2, cosine);
      if (shell.penetrationMm < resistance) { report('stopped', `Stopped by ${a.name}`); return true; }
      shell.penetrationMm -= resistance;
      report('penetration', `Penetrated ${a.name}`);
      if (hit.key.endsWith(':entry')) {
        actor.damage.integrity = Math.max(0, actor.damage.integrity - shell.damage * .2);
        // Assign a breach to the closest modeled space. Breach extent is a tunable blast approximation.
        const candidates = def.compartments.map((c, i) => ({ c, i, distance: length(sub(c.center, hit.point)) })).sort((a, b) => a.distance - b.distance);
        if (candidates[0] && hit.point[1] < 3) {
          const c = actor.damage.compartments[candidates[0].i];
          c.breachAreaM2 = Math.min(4, c.breachAreaM2 + shell.caliberM * shell.caliberM);
          c.breachHeight = Math.min(c.breachHeight, hit.point[1] - shell.caliberM * 2);
        }
      }
    } else if (hit.kind === 'module') {
      const m = def.modules[hit.index], state = actor.damage.modules[hit.index];
      if (state.hp === 0) continue;
      state.hp = Math.max(0, state.hp - shell.damage);
      report('module', `${m.name} ${state.hp === 0 ? 'disabled' : 'damaged'}`);
      if (m.kind === 'magazine' && state.hp === 0 && !state.detonated) {
        state.detonated = true;
        actor.damage.integrity = Math.max(0, actor.damage.integrity - 450);
        const c = actor.damage.compartments.find(c => c.id === m.compartmentId)!;
        c.breachAreaM2 = Math.min(4, c.breachAreaM2 + 2); c.breachHeight = m.center[1];
        report('module', `${m.name} detonation`);
      }
      shell.penetrationMm = Math.max(0, shell.penetrationMm - 50);
      if (shell.penetrationMm === 0) return true;
    } else {
      const m = def.mounts[hit.index], state = actor.mounts[hit.index];
      if (shell.penetrationMm < m.weapon.armorMm) { report('stopped', `Stopped by ${m.name} armor`); return true; }
      shell.penetrationMm -= m.weapon.armorMm;
      state.hp = Math.max(0, state.hp - shell.damage);
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
    const breachWorld = localToWorld([c.center[0], state.breachHeight, c.center[2]], actor.motion);
    const waterDepth = Math.max(0, -breachWorld[1]);
    const internalDepth = state.waterM3 / c.capacityM3 * c.size[1];
    const head = Math.max(0, Math.min(waterDepth, c.size[1]) - internalDepth);
    const inflow = .6 * state.breachAreaM2 * Math.sqrt(2 * 9.81 * head);
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
  damage.sunk ||= damage.integrity <= 0 || water >= def.hull.reserveBuoyancyM3;
  if (damage.sunk) { actor.motion.y = Math.max(-50, actor.motion.y - dt * .45); return; }
  actor.motion.y = -water / def.hull.waterplaneAreaM2;
  const totalMass = def.hull.massKg + water * 1000;
  actor.motion.roll = clamp(-damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[0], 0) / totalMass * .5, -.45, .45);
  actor.motion.pitch = clamp(damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[2], 0) / totalMass * .02, -.2, .2);
}

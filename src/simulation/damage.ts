import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { ShipState } from './ship';
import { plateHit, samePlateSeam } from './protection';
import { EXTERIOR_PLATING_REPLACEMENT_M, structuralHits, type StructuralSurface } from './structure';
import type { MountState } from './weapons';
import { add, clamp, contains, length, localToWorld, normalize, radians, rotate, segmentBox, sub, worldToLocal } from './geometry';

export interface CompartmentState { id: string; waterM3: number; breachAreaM2: number; breachHeight: number; }
export interface DamageState {
  integrity: number; maxIntegrity: number; modules: { id: string; hp: number; detonated: boolean }[];
  compartments: CompartmentState[]; sunk: boolean;
}
export interface Combatant { motion: ShipState; mounts: MountState[]; damage: DamageState; submarine?: import('./submarine').SubmarineState; }
export type ShellType = 'AP' | 'HE';
export interface Shell {
  id: number; ownerId: string; position: Vec3; velocity: Vec3; age: number;
  penetrationMm: number; damage: number; caliberM: number; visited: string[];
  /** Lazily initialized from damage; persists across module hits and fixed ticks. */
  remainingModuleDamage?: number;
  /** Omitted by older fixtures; current batteries fire AP. */
  type?: ShellType;
}
/** A surface strike in ship-local or, when specified, mount-yaw-local coordinates. */
export interface SurfaceImpact {
  position: Vec3; normal: Vec3; direction: Vec3;
  mountId?: string;
  outcome: 'penetration' | 'stopped' | 'ricochet';
}
/** Serializable evidence for render-side effects; never feeds back into damage. */
export interface BallisticEffectData {
  shell?: Pick<Shell, 'id' | 'caliberM' | 'velocity' | 'type'>;
  normal?: Vec3;
  detonation?: boolean;
  impact?: SurfaceImpact;
}
export interface DamageEvent extends BallisticEffectData { kind: 'penetration' | 'ricochet' | 'stopped' | 'module' | 'sunk'; position: Vec3; message: string; shipId: string; }
// Provisional absolute gameplay damage. Magazine loss
// also disables linked mounts and opens a flooding breach; two losses in an
// opening salvo must leave time to react with the coarse internal envelopes.
const MAGAZINE_DETONATION_DAMAGE = 150;

/** 300 base HP plus a square-root displacement bonus, rounded to 10 HP.
 * A 70,000 tonne hull has 1,750 HP; small hulls retain useful endurance.
 * Armor and flooding resolve separately. This is gameplay calibration. */
export function maxHullIntegrity(def: ShipDefinition): number {
  const sizeBonus = 1450 * Math.sqrt(def.hull.massKg / 70_000_000);
  return Math.round((300 + sizeBonus) / 10) * 10;
}

export function createDamage(def: ShipDefinition): DamageState {
  const maxIntegrity = maxHullIntegrity(def);
  return { integrity: maxIntegrity, maxIntegrity, modules: def.modules.map(m => ({ id: m.id, hp: m.hp, detonated: false })), compartments: def.compartments.map(c => ({ id: c.id, waterM3: 0, breachAreaM2: 0, breachHeight: 0 })), sunk: false };
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
  type Hit = { t: number; key: string; kind: 'armor' | 'module' | 'mount' | 'structure'; index: number; point: Vec3; normal: Vec3; onEdge?: boolean; surface?: StructuralSurface };
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
  for (const hit of structuralHits(from,to,def)) {
    const key=`${actor.motion.id}:structure:${hit.surface.id}:${hit.triangle}`;
    if (!shell.visited.includes(key)) hits.push({...hit,key,kind:'structure',index:hit.triangle});
  }
  hits.sort((a, b) => a.t - b.t || Number(b.kind === 'armor') - Number(a.kind === 'armor') || (a.kind==='armor' && b.kind==='armor' ? def.armor[b.index].thicknessMm-def.armor[a.index].thicknessMm : 0) || a.key.localeCompare(b.key));
  const crossedPlateEdges: Hit[] = [];
  const crossedStructure: Hit[] = [];
  const breach=(point:Vec3)=>{
    if(point[1]>=3-1e-6)return;
    const candidates=def.compartments.map((c,i)=>({i,distance:Math.hypot(...point.map((v,j)=>Math.max(0,Math.abs(v-c.center[j])-c.size[j]/2)))})).sort((a,b)=>a.distance-b.distance);
    if(!candidates[0])return;
    const c=actor.damage.compartments[candidates[0].i];
    c.breachAreaM2=Math.min(4,c.breachAreaM2+shell.caliberM*shell.caliberM);
    c.breachHeight=Math.min(c.breachHeight,point[1]-shell.caliberM*2);
  };
  for (const hit of hits) {
    shell.visited.push(hit.key);
    const position = localToWorld(hit.point, actor.motion);
    const report = (kind: DamageEvent['kind'], message: string, detonation = false) => {
      const armor = hit.kind === 'armor' ? def.armor[hit.index] : undefined;
      const mountId = hit.kind === 'mount' ? def.mounts[hit.index].id : armor?.plate?.mountId;
      const surface = hit.kind === 'structure' || hit.kind === 'mount' ||
        (hit.kind === 'armor' && (!armor?.plate || armor.plate.exterior || mountId));
      let impact: SurfaceImpact | undefined;
      if (surface && !detonation && (kind === 'penetration' || kind === 'stopped' || kind === 'ricochet' || (kind === 'module' && hit.kind === 'mount'))) {
        impact = { position: [...hit.point], normal: [...hit.normal], direction: [...direction],
          outcome: kind === 'stopped' || kind === 'ricochet' ? kind : 'penetration' };
        if (mountId) {
          const index = def.mounts.findIndex(m => m.id === mountId), mount = def.mounts[index];
          const pose = { x: mount.position[0], y: mount.position[1], z: mount.position[2],
            heading: radians(mount.bearingDeg) + actor.mounts[index].train, roll: 0, pitch: 0 };
          impact.position = worldToLocal(hit.point, pose);
          impact.normal = worldToLocal(hit.normal, { ...pose, x: 0, y: 0, z: 0 });
          impact.direction = worldToLocal(direction, { ...pose, x: 0, y: 0, z: 0 });
          impact.mountId = mountId;
        }
      }
      emit({
        kind, position, message, shipId: actor.motion.id,
        shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity], type: shell.type ?? 'AP' },
        ...(hit.kind === 'mount' || hit.kind === 'structure' || (hit.kind === 'armor' && kind !== 'module') ? { normal: rotate(hit.normal, actor.motion) } : {}),
        ...(detonation ? { detonation: true } : {}),
        ...(impact ? { impact } : {}),
      });
    };
    if (hit.kind === 'structure') {
      // Adjacent triangles describe one sheet. Keep both IDs visited at seams.
      if(crossedStructure.some(p=>p.surface===hit.surface&&length(sub(p.point,hit.point))<1e-5))continue;
      crossedStructure.push(hit);
      // A nearby exterior armor face replaces ordinary shell plating there.
      if(hit.surface!.hull&&hits.some(p=>p.kind==='armor'&&def.armor[p.index].plate?.exterior&&length(sub(p.point,hit.point))<EXTERIOR_PLATING_REPLACEMENT_M))continue;
      const cosine=Math.abs(direction.reduce((n,v,i)=>n+v*hit.normal[i],0));
      const resistance=hit.surface!.thicknessMm/Math.max(.05,cosine);
      if(shell.penetrationMm<resistance){report('stopped',`Stopped by ${hit.surface!.name} plating`);return true;}
      shell.penetrationMm-=resistance;
      report('penetration',`Penetrated ${hit.surface!.name} plating`);
      const damageKey=`${actor.motion.id}:structure:${hit.surface!.id}:damage`;
      if(!shell.visited.includes(damageKey)){
        shell.visited.push(damageKey);actor.damage.integrity=Math.max(0,actor.damage.integrity-shell.damage*.1);
      }
      if(hit.surface!.hull)breach(hit.point);
    } else if (hit.kind === 'armor') {
      const a = def.armor[hit.index];
      if (a.plate && hit.onEdge) {
        if (crossedPlateEdges.some(previous=>def.armor[previous.index].plate?.material===a.plate!.material && samePlateSeam(previous,hit))) continue;
        crossedPlateEdges.push(hit);
      }
      if (a.plate?.material === 'teak') continue; // Backing has no invented steel equivalence.
      const cosine = Math.abs(direction.reduce((sum, n, i) => sum + n * hit.normal[i], 0));
      if (cosine < .2) { report('ricochet', `Ricochet · ${a.name}`); return true; }
      const resistance = a.thicknessMm / Math.max(.2, cosine);
      if (shell.penetrationMm < resistance) { report('stopped', `Stopped by ${a.name}`); return true; }
      shell.penetrationMm -= resistance;
      report('penetration', `Penetrated ${a.name}`);
      if (a.plate?.mountId) {
        const mountIndex = def.mounts.findIndex(m => m.id === a.plate!.mountId);
        const mount = actor.mounts[mountIndex];
        mount.hp = Math.max(0, mount.hp - shell.damage);
        report('module', `${def.mounts[mountIndex].name} ${mount.hp === 0 ? 'disabled' : 'damaged'}`);
        return true;
      }
      if (a.plate?.exterior || hit.key.endsWith(':entry')) {
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
      const remaining = shell.remainingModuleDamage ?? shell.damage;
      const applied = Math.min(state.hp, remaining);
      if (applied <= 0) return true;
      state.hp -= applied;
      shell.remainingModuleDamage = remaining - applied;
      report('module', `${m.name} ${state.hp === 0 ? 'disabled' : 'damaged'}`);
      if (m.kind === 'magazine' && state.hp === 0 && !state.detonated) {
        state.detonated = true;
        actor.damage.integrity = Math.max(0, actor.damage.integrity - MAGAZINE_DETONATION_DAMAGE);
        const c = actor.damage.compartments.find(c => c.id === m.compartmentId)!;
        c.breachAreaM2 = Math.min(4, c.breachAreaM2 + 2); c.breachHeight = m.center[1];
        report('module', `${m.name} detonation`, true);
      }
      shell.penetrationMm = Math.max(0, shell.penetrationMm - 50);
      if (shell.penetrationMm === 0 || shell.remainingModuleDamage === 0) return true;
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
    const head = Math.max(0, (def.submarine ? waterDepth : Math.min(waterDepth, c.size[1])) - internalDepth);
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
  if (damage.sunk) {
    const y = Math.min(actor.motion.y, Math.max(def.submarine ? -1000 : -50, actor.motion.y - dt * .45));
    actor.motion.verticalSpeed = dt > 0 ? (y - actor.motion.y) / dt : 0;
    actor.motion.y = y; return;
  }
  if (!actor.submarine) actor.motion.y = -water / def.hull.waterplaneAreaM2;
  const totalMass = def.hull.massKg + water * 1000;
  actor.motion.roll = clamp(-damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[0], 0) / totalMass * .5, -.45, .45);
  actor.motion.pitch = clamp(damage.compartments.reduce((n, c, i) => n + c.waterM3 * 1000 * def.compartments[i].center[2], 0) / totalMass * .02, -.2, .2);
}

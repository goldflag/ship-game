import type { ShipDefinition } from '../ships/blueprint';
import { addBreach, type Combatant, type DamageEvent } from './damage';
import { clamp, localToWorld } from './geometry';
import { hullContains } from './hull';

export type ControlPriority = 'balanced' | 'fires' | 'flooding' | 'repairs';
export interface FireState { heat: number; fuel: number; intensity: number; }
export interface ControlJob { kind: 'fire-room' | 'fire-mount' | 'isolate' | 'patch' | 'pump' | 'repair-module' | 'repair-mount'; index: number; setup: number; }
export interface ControlState {
  priority: ControlPriority; focus: string; spares: number; rooms: FireState[]; mounts: FireState[];
  teams: (ControlJob | null)[]; pumping: number[];
}
interface JobOffer { job: ControlJob; score: number; }
const jobKey = (job: ControlJob) => `${job.kind}:${job.index}`;

/** Reserve every valid incumbent before dispatching idle teams or preempting
 * lower-priority work. Team array order must not cause job stealing. */
function assignTeams(teams: ControlState['teams'], jobs: JobOffer[]): ControlState['teams'] {
  if (teams.length === 0) return teams;
  if (jobs.length === 0) return teams.map(() => null);
  const offers = new Map(jobs.map(offer => [jobKey(offer.job), offer]));
  const claimed = new Set<string>();
  const assigned = teams.map(job => {
    const offer = job && offers.get(jobKey(job));
    if (!job || !offer || claimed.has(jobKey(job))) return null;
    claimed.add(jobKey(job));
    return { job, score: offer.score };
  });
  for (const offer of jobs) {
    if (claimed.has(jobKey(offer.job))) continue;
    let team = assigned.findIndex(current => current === null);
    if (team < 0) {
      team = assigned.reduce((best, current, i) => best < 0 || current!.score < assigned[best]!.score ? i : best, -1);
      if (team < 0 || offer.score < assigned[team]!.score + 30) continue;
    }
    const previous = assigned[team];
    if (previous) claimed.delete(jobKey(previous.job));
    assigned[team] = offer;
    claimed.add(jobKey(offer.job));
  }
  return assigned.map(offer => offer?.job ?? null);
}
export function createControl(def: ShipDefinition): ControlState {
  const d = def.damageControl;
  const fire = (fuel: number): FireState => ({ heat: 0, intensity: 0, fuel });
  return { priority: 'balanced', focus: '', spares: d?.repairPoints ?? 0,
    rooms: def.compartments.map(() => fire(d?.roomFuelSeconds ?? 0)), mounts: def.mounts.map(() => fire(d?.mountFuelSeconds ?? 0)),
    teams: Array.from({ length: d?.teams ?? 0 }, () => null), pumping: def.compartments.map(() => 0) };
}
export function directControl(actor: Combatant, priority: ControlPriority, focus = ''): void {
  if (!['balanced', 'fires', 'flooding', 'repairs'].includes(priority)) return;
  const c = actor.damage.control;
  if (c.priority !== priority || c.focus !== focus) { c.priority = priority; c.focus = focus; c.teams.fill(null); }
}
function wet(actor: Combatant, def: ShipDefinition, index: number): number {
  return actor.damage.compartments[index].waterM3 / def.compartments[index].capacityM3;
}
export function heatModule(actor: Combatant, def: ShipDefinition, index: number, deliveredDamage: number): void {
  if (!def.damageControl) return;
  const m = def.modules[index], room = def.compartments.findIndex(c => c.id === m.compartmentId);
  if (wet(actor, def, room) >= .25) return;
  actor.damage.control.rooms[room].heat = Math.min(2, actor.damage.control.rooms[room].heat + deliveredDamage / 100);
  if (m.kind === 'magazine') actor.damage.modules[index].ignition += deliveredDamage / 150;
}
export function heatMount(actor: Combatant, index: number, deliveredDamage: number): void {
  const f = actor.damage.control.mounts[index];
  if (f) f.heat = Math.min(2, f.heat + deliveredDamage / 100);
}

/** Automatic teams and player priorities share the same bounded, timed jobs.
 * Heat/fuel are normalized game units. No crew pathfinding or electrical network. */
export function updateDamageControl(actor: Combatant, def: ShipDefinition, dt: number, emit: (e: DamageEvent) => void): void {
  const d = def.damageControl, c = actor.damage.control;
  c.pumping.fill(0);
  if (!d || actor.damage.sunk || dt <= 0) return;
  const jobs: JobOffer[] = [];
  const offer = (kind: ControlJob['kind'], index: number, id: string, score: number, category: ControlPriority) => {
    jobs.push({ job: { kind, index, setup: d.setupSeconds },
      score: score + (c.priority === category ? 100 : 0) + (c.focus && c.focus === id ? 200 : 0) });
  };
  c.rooms.forEach((f, i) => {
    const w = wet(actor, def, i), room = def.compartments[i], state = actor.damage.compartments[i];
    if (f.heat > .15 && w < .6) offer('fire-room', i, room.id, 60 + f.heat * 10, 'fires');
    if (w > .001 && w < .9) offer('pump', i, room.id, 20 + w * 20, 'flooding');
    if (w < .6 && state.breaches.some(b => b.areaM2 > 0 && b.areaM2 <= d.maxPatchM2) && c.spares > 0) offer('patch', i, room.id, 50, 'flooding');
  });
  c.mounts.forEach((f, i) => { if (f.heat > .15) offer('fire-mount', i, def.mounts[i].id, 60 + f.heat * 10, 'fires'); });
  actor.damage.connections.forEach((s, i) => {
    if (s.state === 'open' && Math.abs(wet(actor, def, s.fromIndex) - wet(actor, def, s.toIndex)) > .02)
      offer('isolate', i, def.compartments[s.fromIndex].id, 80, 'flooding');
  });
  if (c.spares > 0) {
    def.modules.forEach((m, i) => {
      const room = def.compartments.findIndex(r => r.id === m.compartmentId), hp = actor.damage.modules[i].hp;
      if (hp > 0 && hp < m.hp * d.repairCeiling && c.rooms[room].heat < .15 && wet(actor, def, room) < .2)
        offer('repair-module', i, m.compartmentId, 10, 'repairs');
    });
    actor.mounts.forEach((m, i) => { if (m.hp > 0 && m.hp < 100 * d.repairCeiling && c.mounts[i].heat < .15) offer('repair-mount', i, def.mounts[i].id, 10, 'repairs'); });
  }
  jobs.sort((a, b) => b.score - a.score || a.job.kind.localeCompare(b.job.kind) || a.job.index - b.job.index);
  const suppressRooms = new Map<number, number>(), suppressMounts = new Map<number, number>();
  c.teams = assignTeams(c.teams, jobs);
  c.teams.forEach(job => {
    if (!job) return;
    const workSeconds = Math.max(0, dt - job.setup);
    job.setup = Math.max(0, job.setup - dt);
    if (job.setup > 0) return;
    if (job.kind === 'fire-room') suppressRooms.set(job.index, workSeconds);
    else if (job.kind === 'fire-mount') suppressMounts.set(job.index, workSeconds);
    else if (job.kind === 'pump') c.pumping[job.index] = d.portablePumpM3PerSecond * workSeconds / dt;
    else if (job.kind === 'isolate') actor.damage.connections[job.index].state = 'closed';
    else if (job.kind === 'patch') {
      const room = actor.damage.compartments[job.index], breach = room.breaches.find(b => b.areaM2 > 0 && b.areaM2 <= d.maxPatchM2)!;
      const area = Math.min(breach.areaM2, d.patchM2PerSecond * workSeconds, c.spares / 100);
      breach.areaM2 -= area; room.breachAreaM2 = Math.max(0, room.breachAreaM2 - area); c.spares -= area * 100;
      room.breaches = room.breaches.filter(b => b.areaM2 > 1e-10);
    } else {
      const module = job.kind === 'repair-module', state = module ? actor.damage.modules[job.index] : actor.mounts[job.index];
      const maximum = (module ? def.modules[job.index].hp : 100) * d.repairCeiling;
      const amount = Math.min(maximum - state.hp, d.repairHpPerSecond * workSeconds, c.spares);
      state.hp += amount; c.spares = Math.max(0, c.spares - amount);
    }
  });
  const burn = (f: FireState, water: number, suppressionSeconds = 0) => {
    const burning = f.heat >= .6 && f.fuel > 0 && water < .25;
    const intensity = burning ? Math.min(1, f.heat) : 0;
    // Store average exposure over this tick so damage, spread and magazine
    // heating all respect the final fraction of available fuel.
    f.intensity = Math.min(intensity, f.fuel / dt);
    const burningSeconds = intensity > 0 ? f.intensity * dt / intensity : 0;
    f.fuel = Math.max(0, f.fuel - f.intensity * dt);
    f.heat = clamp(f.heat + .022 * burningSeconds - (.01 + water * .3) * dt - d.suppressionPerSecond * suppressionSeconds, 0, 2);
  };
  c.rooms.forEach((f, i) => burn(f, wet(actor, def, i), suppressRooms.get(i)));
  c.mounts.forEach((f, i) => {
    burn(f, 0, suppressMounts.get(i)); actor.mounts[i].hp = Math.max(0, actor.mounts[i].hp - f.intensity * .8 * dt);
    const magazine = def.mounts[i].magazineId;
    if (magazine && f.intensity > 0 && actor.mounts[i].ammo > 0) {
      const mi = def.modules.findIndex(m => m.id === magazine);
      // Closed flash protection attenuates a sustained feed-path exposure.
      actor.damage.modules[mi].ignition += f.intensity * (1 - d.flashProtection) * .015 * dt;
    }
  });
  // A closed, intact boundary contains fire; only an open/damaged path carries heat.
  actor.damage.connections.forEach(s => {
    if (s.state === 'closed') return;
    const a = c.rooms[s.fromIndex], b = c.rooms[s.toIndex];
    const path = s.state === 'damaged' ? Math.min(1, s.damageAreaM2 / .5) : 1;
    if (a.intensity > 0) b.heat = Math.min(2, b.heat + a.intensity * path * .02 * dt);
    if (b.intensity > 0) a.heat = Math.min(2, a.heat + b.intensity * path * .02 * dt);
  });
  def.modules.forEach((m, i) => {
    const state = actor.damage.modules[i], ri = def.compartments.findIndex(r => r.id === m.compartmentId), f = c.rooms[ri], w = wet(actor, def, ri);
    state.hp = Math.max(0, state.hp - f.intensity * .8 * dt);
    if (m.kind !== 'magazine' || state.detonated) return;
    state.ignition = w >= .25 ? 0 : Math.max(0, state.ignition + (f.intensity * .025 - .003) * dt - .05 * (suppressRooms.get(ri) ?? 0));
    const linked = def.mounts.map((mount, j) => mount.magazineId === m.id ? j : -1).filter(j => j >= 0);
    if (state.ignition < 1 || (linked.length > 0 && linked.every(j => actor.mounts[j].ammo === 0))) return;
    state.detonated = true; state.hp = 0;
    linked.forEach(j => { actor.mounts[j].hp = 0; actor.mounts[j].ammo = 0; actor.mounts[j].heAmmo = 0; });
    let low = 0, high = def.hull.beam / 2;
    for (let j = 0; j < 20; j++) { const x = (low + high) / 2; if (hullContains(def.hull, [x, m.center[1], m.center[2]])) low = x; else high = x; }
    addBreach(actor.damage.compartments[ri], [Math.sign(m.center[0] || 1) * low, m.center[1], m.center[2]], 2, -1);
    actor.damage.connections.forEach((s, j) => { if (s.fromIndex === ri || s.toIndex === ri) { s.state = 'damaged'; s.damageAreaM2 = def.connections[j].areaM2; } });
    f.heat = 2;
    emit({ kind: 'module', position: localToWorld(m.center, actor.motion), shipId: actor.motion.id, message: `${m.name} ignition · ammunition lost, hull opened`, detonation: true });
  });
}

import type { ShipDefinition, TorpedoPart, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { add, clamp, localToWorld, radians, rotate, scale, segmentBox, sub, worldToLocal, wrapAngle } from './geometry';
import { motionVelocity } from './ship';
import { structuralHits } from './structure';

export type TubeDefinition = NonNullable<ShipDefinition['torpedoTubes']>[number];
export interface TubeState {
  id: string; ammo: number; reload: number;
  status: 'ready' | 'reloading' | 'turning' | 'out-of-arc' | 'out-of-range' | 'too-close' | 'disabled' | 'empty' | 'blocked';
}
export interface TorpedoLauncherState { id: string; train: number; }
export interface Torpedo {
  id: number; ownerId: string; tubeId: string; position: Vec3; velocity: Vec3;
  distance: number; age: number; weapon: TorpedoPart;
}
export const createTubeState = (tube: TubeDefinition): TubeState => ({ id: tube.id, ammo: tube.ammo, reload: 0, status: tube.ammo ? 'ready' : 'empty' });

export function tubeLocalPosition(actor: Pick<FleetActor, 'definition' | 'torpedoLaunchers'>, tube: TubeDefinition): Vec3 {
  const launcher = actor.definition.torpedoLaunchers?.find(l => l.id === tube.launcherId);
  if (!launcher) return tube.position;
  const train = actor.torpedoLaunchers?.find(l => l.id === launcher.id)?.train ?? 0;
  return add(launcher.position, rotate(sub(tube.position, launcher.position), { heading: train, roll: 0, pitch: 0 }));
}

/** Train each shared five-tube assembly once per tick. The CPU owns its yaw. */
export function trainTorpedoLaunchers(actor: FleetActor, aimFor: (tube: TubeDefinition) => Vec3 | null, dt: number): void {
  for (const launcher of actor.definition.torpedoLaunchers ?? []) {
    const state = actor.torpedoLaunchers!.find(s => s.id === launcher.id)!;
    const tubes = actor.definition.torpedoTubes!.filter(t => t.launcherId === launcher.id);
    const tube = tubes.find(t => (actor.torpedoTubes?.find(s => s.id === t.id)?.ammo ?? 0) > 0) ?? tubes[0];
    if (actor.damage.sunk || actor.damage.modules.find(m => m.id === tube.magazineId)?.hp === 0) continue;
    const aim = aimFor(tube);
    if (!aim?.every(Number.isFinite)) continue;
    const local = worldToLocal(aim, actor.motion);
    const desired = Math.atan2(local[0] - launcher.position[0], launcher.position[2] - local[2]);
    state.train = wrapAngle(state.train + clamp(wrapAngle(desired - state.train), -radians(launcher.traverseRateDeg) * dt, radians(launcher.traverseRateDeg) * dt));
  }
}

/** Constant-speed interception in the horizontal plane. The course is fixed at launch. */
export function torpedoIntercept(from: Vec3, point: Vec3, velocity: Vec3, speed: number): Vec3 | null {
  const dx = point[0] - from[0], dz = point[2] - from[2];
  const a = velocity[0] ** 2 + velocity[2] ** 2 - speed ** 2;
  const b = 2 * (dx * velocity[0] + dz * velocity[2]), c = dx ** 2 + dz ** 2;
  let time: number;
  if (Math.abs(a) < 1e-8) time = Math.abs(b) > 1e-8 ? -c / b : c < 1e-8 ? 0 : Infinity;
  else {
    const d = b * b - 4 * a * c;
    if (d < 0) return null;
    time = Math.min(...[(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)].filter(t => t >= 0));
  }
  return Number.isFinite(time) && time >= 0 ? add(point, scale([velocity[0], 0, velocity[2]], time)) : null;
}

export function tubeSolution(actor: FleetActor, tube: TubeDefinition, state: TubeState, aim: Vec3, dt: number) {
  state.reload = Math.max(0, state.reload - dt);
  const origin = localToWorld(tubeLocalPosition(actor, tube), actor.motion);
  const heading = Math.atan2(aim[0] - origin[0], origin[2] - aim[2]);
  const range = Math.hypot(aim[0] - origin[0], aim[2] - origin[2]);
  const magazine = actor.damage.modules.find(m => m.id === tube.magazineId);
  const launcher = actor.definition.torpedoLaunchers?.find(l => l.id === tube.launcherId);
  const train = actor.torpedoLaunchers?.find(l => l.id === tube.launcherId)?.train ?? radians(tube.bearingDeg);
  const relative = wrapAngle(heading - actor.motion.heading);
  const inArc = launcher ? launcher.launchArcsDeg.some(([a, b]) => relative >= radians(a) && relative <= radians(b)) : Math.abs(wrapAngle(relative - train)) <= radians(tube.arcDeg) + 1e-8;
  state.status = actor.damage.sunk || magazine?.hp === 0 ? 'disabled' : state.ammo === 0 ? 'empty' :
    !aim.every(Number.isFinite) || !inArc ? 'out-of-arc' :
    range < tube.weapon.armingDistanceM ? 'too-close' : range > tube.weapon.rangeM ? 'out-of-range' : state.reload > 0 ? 'reloading' :
    launcher && Math.abs(wrapAngle(relative - train)) > radians(tube.arcDeg) ? 'turning' : 'ready';
  return { origin, heading, range };
}

/** Predict friendly motion along the actual selected launch course. */
export function clearTorpedoLane(actor: FleetActor, origin: Vec3, aim: Vec3, speed: number, actors: readonly FleetActor[]): boolean {
  const dx = aim[0] - origin[0], dz = aim[2] - origin[2], range = Math.hypot(dx, dz);
  if (range < 1) return false;
  const vx = dx / range * speed, vz = dz / range * speed, time = range / speed;
  return !actors.some(other => {
    if (other === actor || other.team !== actor.team || other.motion.y < -20) return false;
    const velocity = motionVelocity(other.motion), rx = other.motion.x - origin[0], rz = other.motion.z - origin[2];
    const ux = velocity[0] - vx, uz = velocity[2] - vz;
    const t = clamp(-(rx * ux + rz * uz) / Math.max(.001, ux * ux + uz * uz), 0, time);
    return Math.hypot(rx + ux * t, rz + uz * t) < other.definition.hull.length / 2 + 5;
  });
}

// Torpedoes collide with the submerged hull, independently of armor scheduling.
const hulls = new WeakMap<ShipDefinition, ShipDefinition>();
function torpedoHull(def: ShipDefinition): ShipDefinition {
  const cached = hulls.get(def); if (cached) return cached;
  const interpolate = (points: [number, number][], s: number) => {
    const i = Math.max(0, points.findIndex((p, i) => i < points.length - 1 && s >= p[0] && s <= points[i + 1][0]));
    const [a, b] = [points[i], points[i + 1]];
    return a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]);
  };
  let sections = def.hull.sections ?? def.hull.halfBreadths.map(([station, width]) => {
    const bottom = interpolate(def.hull.keelHeights, station), top = interpolate(def.hull.deckHeights, station);
    return { station, points: [[0, bottom], [width * .6, bottom], [width, 0], [width, top]] as [number, number][] };
  });
  // Older presets can author unequal station point counts. Normalize those rings
  // before using the shared surface triangulator; never index one ring as another.
  if (sections.some(s => s.points.length !== sections[0].points.length)) {
    sections = sections.map(section => {
      const bottom = section.points[0][1], top = section.points.at(-1)![1];
      return { station: section.station, points: Array.from({ length: 33 }, (_, i) => {
        const y = bottom + (top - bottom) * i / 32;
        let width = 0;
        for (let j = 0; j < section.points.length - 1; j++) {
          const [wa, ya] = section.points[j], [wb, yb] = section.points[j + 1];
          if (y >= ya - 1e-6 && y <= yb + 1e-6) width = Math.max(width, Math.abs(yb - ya) < 1e-8 ? Math.max(wa, wb) : wa + (wb - wa) * (y - ya) / (yb - ya));
        }
        return [width, y] as [number, number];
      }) };
    });
  }
  const hull = { ...def, hull: { ...def.hull, sections }, structures: [], structuralPlating: { hullMm: 1, superstructureMm: 1, note: 'Collision envelope only' } };
  hulls.set(def, hull); return hull;
}

/** Complete swept segment; first physical hull wins even if an ally or sinking wreck. */
export function firstTorpedoHit(torpedo: Torpedo, from: Vec3, to: Vec3, actors: readonly FleetActor[]) {
  const hits = actors.flatMap(actor => {
    if (actor.motion.id === torpedo.ownerId) return [];
    const a = worldToLocal(from, actor.motion), b = worldToLocal(to, actor.motion), h = actor.definition.hull;
    if (!segmentBox(a, b, { center: [0, h.depth / 2 - h.draft, 0], size: [h.beam, h.depth, h.length] })) return [];
    const hit = structuralHits(a, b, torpedoHull(actor.definition))[0];
    return hit ? [{ actor, ...hit }] : [];
  });
  return hits.sort((a, b) => a.t - b.t)[0];
}

/** Bounded contact blast and one local breach. These are explicit gameplay values. */
export function damageTorpedoHit(torpedo: Torpedo, actor: FleetActor, point: Vec3): string {
  return damageUnderwaterBlast(actor, point, torpedo.weapon, 'Torpedo hit');
}

/** Common local underwater damage; callers own blast falloff, scoring and events. */
export function damageUnderwaterBlast(actor: FleetActor, point: Vec3, w: { damage: number; breachAreaM2: number }, label: string): string {
  const def = actor.definition, damage = actor.damage;
  damage.integrity = Math.max(0, damage.integrity - w.damage);
  const distanceTo = (box: { center: Vec3; size: Vec3 }) => Math.hypot(...point.map((v, i) => Math.max(0, Math.abs(v - box.center[i]) - box.size[i] / 2)));
  const compartment = def.compartments.map((c, i) => ({ c, i, distance: distanceTo(c) })).sort((a, b) => a.distance - b.distance)[0];
  if (compartment) {
    const state = damage.compartments[compartment.i];
    state.breachAreaM2 = Math.min(4, state.breachAreaM2 + w.breachAreaM2);
    state.breachHeight = Math.min(state.breachHeight, point[1]);
  }
  const module = def.modules.map((m, i) => ({ m, i, distance: distanceTo(m) })).filter(m => m.distance < 8).sort((a, b) => a.distance - b.distance)[0];
  if (module) {
    const state = damage.modules[module.i];
    state.hp = Math.max(0, state.hp - w.damage * .5 * (1 - module.distance / 8));
    if (state.hp === 0 && module.m.kind === 'magazine' && !state.detonated) {
      state.detonated = true;
      damage.integrity = Math.max(0, damage.integrity - 150);
      const room = damage.compartments.find(c => c.id === module.m.compartmentId)!;
      room.breachAreaM2 = Math.min(4, room.breachAreaM2 + 2); room.breachHeight = module.m.center[1];
    }
  }
  return `${label}${compartment ? ` · ${compartment.c.name}` : ''} · flooding breach`;
}

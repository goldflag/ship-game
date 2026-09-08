import { surfaceGunAllowed } from '../ships/armament';
import { selectedWeapon, weaponGroupId } from '../ships/weaponGroups';
import type { Ammunition, Battery, Vec3 } from '../ships/blueprint';
import type { AirContext, Aircraft } from './aircraft';
import { antiAircraftCandidates, updateAntiAircraft } from './antiAircraft';
import type { FleetActor } from './battle';
import { updateMountCarrier } from './mountFrames';
import { botAim, botAmmunition, botDidFire, botGunRange, botReadyToFire, clearFiringLane, shipVelocity } from './bots';
import { dispersedDirection, dispersedSpeed, velocityPenetration } from './ballistics';
import { add, length, scale } from './geometry';
import { directorDispersion, equipmentCondition, mountSupport, supportPerformance } from './machinery';
import { availableAmmunition, expendSalvo, muzzleWorld, queueAmmunition, selectAmmunition, shotDirection, updateMount, type MountDefinition, type MountState } from './weapons';

/** The player's intent for one tick. Only the selected group follows the sight;
 * every other surface gun stays idle and every registered AA gun stays automatic. */
export interface PlayerGunOrders {
  battery: Battery;
  weaponGroupId?: string;
  /** Undefined when the host supplied a malformed sight; selected guns then report out-of-arc. */
  aim?: Vec3;
  fire: boolean;
  /** Ordered shell type per weapon group id, with the battery as fallback. */
  ammunition: Readonly<Record<string, Ammunition>>;
}

export interface GunneryContext extends AirContext {
  seed: number;
  dt: number;
  /** Seeded surface dispersion advances per shell, independently of projectile ids. */
  nextDispersion(): number;
  /** This tick's airborne, off-deck aircraft in stable order. Undefined outside an
   * active battle, where no gun engages aircraft. */
  airborne?: readonly Aircraft[];
}

/** Operate every gun mount of one ship for a fixed tick. Each mount advances its
 * reload, recoil and training exactly once. Automatic air defense claims a mount
 * first unless the player has selected its group directly; otherwise the mount
 * follows the sight, its bot's track, or simply keeps reloading. A salvo spends
 * one complete load from the stock shared by both firing paths. */
export function operateGuns(actor: FleetActor, ctx: GunneryContext, target?: FleetActor, player?: PlayerGunOrders): void {
  const def = actor.definition;
  const aircraft = ctx.airborne && antiAircraftCandidates(actor, ctx.airborne);
  const support = supportPerformance(actor, def);
  const laneClear = !!target && clearFiringLane(actor, target, ctx.actors);
  const velocity = shipVelocity(actor);
  def.mounts.forEach((m, i) => {
    updateMountCarrier(def, i, actor.mounts);
    const state = actor.mounts[i];
    if (actor.damage.stability.combatLost) { state.status = 'disabled'; return; }
    if (m.magazineId && equipmentCondition(actor, def, m.magazineId).availability === 0) { state.status = 'disabled'; return; }
    const surfaceAllowed = surfaceGunAllowed(def, m.weapon);
    const selected = surfaceAllowed && !!player && selectedWeapon(m.battery, m.weapon, player.battery, player.weaponGroupId);
    // A directly selected group belongs to the sight; aggregate battery intent keeps AA automatic.
    const manual = selected && player!.weaponGroupId !== undefined;
    if (aircraft && !manual && updateAntiAircraft(actor, m, state, ctx, ctx.dt, aircraft, support.power)) return;
    if (!surfaceAllowed) { updateMount(m, state, def, actor.motion, undefined, ctx.dt, velocity, support.power, actor.mounts); return; }
    let aim: Vec3 | undefined, fire = false, inRange = false;
    if (player) {
      queueAmmunition(m, state, player.ammunition[weaponGroupId(m.battery, m.weapon)] ?? player.ammunition[m.battery]);
      if (!player.aim) { state.status = 'out-of-arc'; return; }
      aim = player.aim; fire = player.fire && selected;
    } else if (actor.controller === 'bot' && target) {
      selectAmmunition(m, state, botAmmunition(target, m, state));
      inRange = Math.hypot(target.motion.x - actor.motion.x, target.motion.z - actor.motion.z) <= botGunRange(m);
      if (inRange && state.hp > 0 && availableAmmunition(state) >= (m.weapon.barrelCount ?? 2)) aim = botAim(actor, target, m, state);
      fire = inRange && laneClear && botReadyToFire(actor, m);
    }
    const aligned = updateMount(m, state, def, actor.motion, aim, ctx.dt, velocity, support.power, actor.mounts);
    if (actor.damage.sunk || !fire || !aligned || state.status !== 'ready') return;
    if (actor.controller === 'bot') botDidFire(actor, m);
    fireSurfaceSalvo(actor, m, state, support.power, velocity, ctx);
  });
}

/** Spend the loaded salvo and launch one dispersed shell per barrel from its own muzzle. */
function fireSurfaceSalvo(actor: FleetActor, m: MountDefinition, state: MountState, power: number, velocity: Vec3, ctx: GunneryContext): void {
  const def = actor.definition, w = m.weapon;
  const barrels = expendSalvo(m, state);
  const spread = (w.ballistics?.dispersionRad ?? 0) + directorDispersion(mountSupport(actor, def, m.id, power).fireControl);
  const label = `${Math.round(w.caliberM * 1000)} mm ${state.loaded.toUpperCase()} · ${m.battery === 'main' ? 'Main' : 'Secondary'}`;
  for (let barrel = 0; barrel < barrels; barrel++) {
    const position = muzzleWorld(m, state, barrel, actor.motion);
    const shot = ctx.nextDispersion();
    const direction = dispersedDirection(shotDirection(m, state, actor.motion), spread, ctx.seed, shot);
    const speed = dispersedSpeed(w.muzzleSpeed, w.ballistics?.muzzleSpeedSigmaFraction ?? 0, ctx.seed, shot);
    const shellVelocity = add(scale(direction, speed), velocity);
    const id = ctx.nextId();
    ctx.shells.push({ id, ownerId: actor.motion.id, weaponLabel: label, position, velocity: shellVelocity, age: 0,
      penetrationMm: state.loaded === 'he' ? 0 : velocityPenetration(w.penetrationMm, w.ballistics?.penetrationReferenceSpeedMps ?? w.muzzleSpeed, length(shellVelocity)),
      damage: w.damage, caliberM: w.caliberM, visited: [], ammunition: state.loaded,
      ap: state.loaded === 'ap' ? w.ap : undefined, he: state.loaded === 'he' ? w.he : undefined, dragPerSecond: w.ballistics?.dragPerSecond ?? 0 });
    ctx.emit({ kind: 'shot', position: [...position], shipId: actor.motion.id, message: `${m.name} fired`,
      shell: { id, caliberM: w.caliberM, velocity: [...shellVelocity], ammunition: state.loaded, type: state.loaded === 'he' ? 'HE' : 'AP' } });
  }
}

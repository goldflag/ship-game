import { SHELL_PACE, torpedoSpeed } from '../../ships/mobility';
import { BATTLE_RULES, physicalLoss } from './battleRules';
import { surfaceGunAllowed } from '../../ships/armament';
import { equipmentCenter } from '../equipmentPose';
import { weaponGroups, selectedWeapon } from '../../ships/weaponGroups';
import { airWingTelemetry } from './airTelemetry';
import { equipmentCondition, supportPerformance } from '../machinery';
import { fireReadout, regionReadout } from './damageReadout';
import { shipDamageReadout, type ShipDamageReadout } from './shipDamageReadout';
import { hullDepth, meanHullY } from './motion';
import { add, localToWorld, scale, sub } from '../geometry';
import { travelFactor } from '../ballistics';
import { torpedoIntercept, tubeLocalPosition } from '../torpedoAim';
import { systemHealth } from '../machinery';
import type { Ammunition, Battery, Vec3 } from '../../ships/blueprint';
import type { FleetActor } from './elements';
import type { WeaponGroup } from '../../ships/weaponGroups';
import type { AirWingTelemetry } from './airTelemetry';
import type { EquipmentCondition } from '../machinery';
import type { FireReadout } from './damageReadout';
import type { ControlPriority } from '../../multiplayer/generated/ControlPriority';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { BattleOutcome } from './battleRules';
import type { BattleResult, BattleSession } from './BattleSession';
import type { CombatEvent, ControlState, DamageLogEntry, DefeatCause, ShellHistory, Team, VesselStatus } from './elements';
import { airborne } from '../airWing';
import { equipmentIntegrity } from '../machinery';
import { availableAmmunition, gunWorkRate, solveBallistic } from '../mountGeometry';
import { shipVelocity } from './motion';
/** The helm and sight the renderer forwards each frame. */
export interface CombatIntent { aim: Vec3; fire: boolean; battery: Battery; weaponGroupId?: string; ammunition?: Ammunition; controlPriority?: ControlPriority; controlFocus?: string; }
export interface FullCombatTelemetry {
  playerDamageReport?: ShipDamageReadout;
  targetKnowledge?: 'full';
  playerSupport: { power: number; fireControl: number }; targetSupport: { power: number; fireControl: number };
  playerFires: FireReadout[]; targetFireDetails: FireReadout[];
  targetRegions: { id: string; name: string; condition: number }[];
  airWing?: AirWingTelemetry;
  airContacts?: { id: string; team: Team; x: number; z: number; heading: number; role: string; ownerId: string; flightId?: string; phase: string }[];
  weaponGroupId?: string;
  weaponGroups: (WeaponGroup & { ammunition: Ammunition; ammo: number; ready: number; total: number; reload: number })[];
  battery: Battery; range: number; ready: number; total: number; targetIntegrity: number; targetWater: number;
  /** Mean flight time to the sight for the selected battery's reachable guns, excluding reload/training. */
  flightTimeSeconds?: number;
  ammunition: Ammunition; ammunitionStock: { ap: number; he: number }; heSupported: boolean;
  targetStatus: VesselStatus; playerStatus: VesselStatus; targetList: number; targetTrim: number; targetDraftChange: number;
  playerList: number; playerTrim: number; playerDraftChange: number;
  control: ControlState; targetFires: number; controlTargets: { id: string; name: string }[];
  targetMounts: { id: string; name: string; condition: number }[];
  targetId: string; targetName: string; targetRange: number;
  targetDepthM?: number;
  contacts: { id: string; name: string; shipId: string; team: Team; controller: FleetActor['controller']; targetId?: string; x: number; z: number; heading: number; speed: number; integrity: number; sunk: boolean; status: VesselStatus; combatLost: boolean; physicalLost: boolean }[];
  battle: boolean; result: BattleResult; playerSunk: boolean;
  remainingSeconds: number | null; afloatKg: [number | null, number | null]; outcome?: BattleOutcome;
  /** A scenario's protected ships (the transports at Savo Island): how many of the owner's are still afloat.
   * `missionId` names the scenario, whose words the HUD looks up. */
  objective?: { missionId: string; protectedAfloat: number; protectedTotal: number };
  targetPower: number; targetSteering: number; targetSunk: boolean; targetUnderway: boolean;
  mounts: { id: string; name: string; status: string; reload: number; ammo: number; loaded?: Ammunition; queued?: Ammunition }[];
  modules: ({ id: string; name: string; condition: number } & EquipmentCondition)[]; message: string;
  targetEquipmentIntegrity: number;
  playerIntegrity: number;
  playerMaxIntegrity: number;
  playerWater: number;
  submarine?: { depthM: number; targetDepthM: number; verticalSpeed: number; ballastM3: number; ballastFraction: number; emergencyBlow: boolean; propulsion: 'Diesel' | 'Electric'; maxDepthM: number; periscopeDepthM: number; maxTorpedoDepthM: number };
  targetDefeatCause?: DefeatCause;
  shellHistory: ShellHistory[];
  playerDamageDealt: number;
  playerArmorBlocked: number;
  playerFrags: number;
  damageLog: DamageLogEntry[];
  targetPosition: { x: number; z: number; heading: number };
  batteries: { battery: Battery; ammunition: Ammunition; ammo: number; ready: number; total: number; reload: number }[];
}
type TargetTelemetryKeys = Extract<keyof FullCombatTelemetry, `target${string}`> | 'modules' | 'shellHistory';
export type CombatTelemetry = FullCombatTelemetry | (Omit<FullCombatTelemetry, TargetTelemetryKeys> & Partial<Pick<FullCombatTelemetry, Exclude<TargetTelemetryKeys, 'targetKnowledge'>>> & { targetKnowledge: 'none' | 'contact' });
export function hasFullTarget(combat: CombatTelemetry): combat is FullCombatTelemetry {
  return combat.targetKnowledge !== 'none' && combat.targetKnowledge !== 'contact';
}
/** What a session must hold for the sight's lead: the helm ship and its target. */
export type AimView = Pick<BattleSession, 'player' | 'definition' | 'ship'> & { target?: FleetActor; targetContact?: ContactTrack };
/** What a session must hold for the instruments: the frame's elements plus the session's own scores and selection. */
export type TelemetryView = Pick<BattleSession, 'player' | 'definition' | 'ship' | 'actors' | 'events' | 'aircraft' | 'shellHistory' | 'result' | 'isBattle' | 'tick' | 'outcome' | 'targetUnderway'> & Partial<Pick<BattleSession, 'missionRules'>> & {
 target?: FleetActor; targetContact?: ContactTrack; remainingSeconds?: number | null;
 ammunitionSelection: Readonly<Record<string, Ammunition>>;
 playerDamageDealt: number; playerArmorBlocked: number; playerFrags: number; damageLog: DamageLogEntry[]; afloatKg: [number | null, number | null];
};

export function presentationAim(view: AimView, moduleId?: string, battery: Battery = 'main', weaponGroupId?: string): Vec3 {
    if (!view.target) return view.targetContact ? [...view.targetContact.estimatedPosition] : [view.ship.x + Math.sin(view.ship.heading) * 5000, 0.5, view.ship.z - Math.cos(view.ship.heading) * 5000];
    const m = view.target.definition.modules.find(m => m.id === moduleId);
    const gun = moduleId?.startsWith('mount:') ? view.target.definition.mounts.find(m => m.id === moduleId.slice(6)) : undefined;
    const center = m && equipmentCenter(view.target,view.target.definition,m);
    const aim = localToWorld(gun ? [gun.position[0], gun.position[1] + gun.weapon.gunhouseSize[2] / 2, gun.position[2]] : center ? [center[0], Math.max(.5, center[1]), center[2]] : [0, .5, 0], view.target.motion);
    if (battery === 'torpedo' && view.definition.torpedoTubes?.length) {
      const tube = view.definition.torpedoTubes.find(t => selectedWeapon('torpedo', t.weapon, battery, weaponGroupId));
      if (!tube) return aim;
      return torpedoIntercept(localToWorld(tubeLocalPosition(view.player, tube), view.ship), aim, shipVelocity(view.target), torpedoSpeed(tube.weapon.speed)) ?? aim;
    }
    const weapon = view.definition.mounts.find(m => selectedWeapon(m.battery, m.weapon, battery, weaponGroupId))?.weapon;
    const speed = weapon?.muzzleSpeed ?? 820, drag = weapon?.ballistics.dragPerSecond ?? 0;
    const from: Vec3 = [view.ship.x, view.ship.y + 8, view.ship.z];
    // Solve in shell time, where world motion appears slower by the shell pace.
    const target = scale(shipVelocity(view.target), 1 / SHELL_PACE), own = scale(shipVelocity(view.player), 1 / SHELL_PACE);
    let time = Math.hypot(aim[0] - view.ship.x, aim[2] - view.ship.z) / speed;
    for (let i = 0; i < 3; i++) {
      const solution = solveBallistic(from, sub(add(aim, scale(target, time)), scale(own, travelFactor(time, drag))), speed, drag);
      if (!solution) break;
      time = solution.time;
    }
    return add(aim, scale(target, time));
  }
export function presentationTelemetry(view: TelemetryView, battery: Battery, aim: Vec3, weaponGroupId?: string, subject: FleetActor = view.player): CombatTelemetry {
    const definition = subject.definition, ship = subject.motion;
    const groups = weaponGroups(definition);
    // Until the player picks a shell, show what the guns hold: HE-only guns load HE.
    const loaded = (key: string): Ammunition => subject.mounts.find(m => groups.find(g => g.id === key || g.battery === key)?.mountIds.includes(m.id))?.loaded ?? 'ap';
    const ammunitionFor = (key: string, fallback = key): Ammunition => subject === view.player
      ? view.ammunitionSelection[key] ?? view.ammunitionSelection[fallback] ?? loaded(key)
      : loaded(key);
    const workRate = gunWorkRate(supportPerformance(subject, subject.definition).power);
    const mounts = battery === 'depth-charge' ? (definition.depthChargeLaunchers ?? []).map((l, i) => {
      const s = subject.depthChargeLaunchers![i];
      return { id: l.id, name: l.name, status: s.status, reload: Math.max(s.reload, subject.depthChargeCooldown ?? 0), ammo: s.ammo };
    }) : battery === 'torpedo' ? (definition.torpedoTubes ?? []).map((tube, i) => {
      const s = subject.torpedoTubes![i];
      return { id: tube.id, name: tube.name, status: s.status, reload: Math.max(s.reload, subject.tubeLaunchCooldown ?? 0), ammo: s.ammo };
    }) : definition.mounts.filter(m => surfaceGunAllowed(definition, m.weapon) && selectedWeapon(m.battery, m.weapon, battery, weaponGroupId)).map(m => {
      const s = subject.mounts.find(s => s.id === m.id)!;
      return { id: m.id, name: m.name, status: s.status, reload: s.reload / workRate, ammo: availableAmmunition(s), loaded: s.loaded, queued: s.queued };
    });
    const selectedGroup = groups.find(g => g.id === weaponGroupId);
    const selectedMounts = weaponGroupId === undefined ? mounts : mounts.filter(m => selectedGroup?.mountIds.includes(m.id));
    const significant = [...view.events].reverse().find(e => ['module', 'sunk', 'stopped', 'ricochet', 'penetration', 'contact', 'burst', 'torpedo-launch', 'torpedo-hit', 'torpedo-dud', 'torpedo-expired', 'depth-charge-launch', 'depth-charge-blast', 'depth-charge-hit'].includes(e.kind));
    const flightTimes = definition.mounts.flatMap((m, i) => {
      const state = subject.mounts[i];
      // Aim caches hold physical shell time; report battle seconds.
      const time = state.aimCache && state.aimCache.time / SHELL_PACE;
      return surfaceGunAllowed(definition, m.weapon) && selectedWeapon(m.battery, m.weapon, battery, weaponGroupId) && ['ready', 'reloading', 'turning'].includes(state.status) && time !== undefined && Number.isFinite(time) && time > 0 ? [time] : [];
    });
    const target = view.target;
    const targetReadout = target ? { targetKnowledge: 'full' as const,
      targetMounts: target.definition.mounts.map((m, i) => ({ id: m.id, name: m.name, condition: target.mounts[i].hp / 100 })),
      targetId: target.motion.id, targetName: target.definition.name,
      ...(target.submarine ? { targetDepthM: hullDepth(target.motion) } : {}),
      targetRange: Math.hypot(target.motion.x - ship.x, target.motion.z - ship.z),
      targetStatus: target.damage.stability.status, targetList: target.motion.roll * 180 / Math.PI, targetTrim: target.motion.pitch * 180 / Math.PI, targetDraftChange: -meanHullY(target.motion),
      targetFires: [...target.damage.control.rooms, ...target.damage.control.mounts].filter(f => f.intensity > 0).length,
      targetSupport: supportPerformance(target, target.definition),
      targetFireDetails: fireReadout(target, target.definition), targetRegions: regionReadout(target, target.definition),
      targetIntegrity: target.damage.integrity / target.damage.maxIntegrity, targetWater: target.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      targetEquipmentIntegrity: equipmentIntegrity(target, target.definition),
      targetPower: systemHealth(target, target.definition, 'engine'), targetSteering: systemHealth(target, target.definition, 'steering'), targetSunk: target.damage.sunk, targetUnderway: view.targetUnderway,
      modules: target.definition.modules.map((m, i) => ({ id: m.id, name: m.name, condition: target.damage.modules[i].hp / m.hp, ...equipmentCondition(target, target.definition, m) })),
      targetDefeatCause: target.damage.defeatCause,
      shellHistory: view.shellHistory.filter(h => h.impacts.some(i => i.shipId === target.motion.id)).slice(-8).reverse().map(h => ({ ...h, impacts: h.impacts.filter(i => i.shipId === target.motion.id).map(i => ({ ...i, position: [...i.position] as Vec3 })) })),
      targetPosition: { x: target.motion.x, z: target.motion.z, heading: target.motion.heading },
    } : view.targetContact ? {
      targetKnowledge: 'contact' as const, targetId: view.targetContact.id,
      targetName: view.targetContact.classification ?? 'Surface contact',
      targetRange: Math.hypot(view.targetContact.estimatedPosition[0] - ship.x, view.targetContact.estimatedPosition[2] - ship.z),
      targetPosition: { x: view.targetContact.estimatedPosition[0], z: view.targetContact.estimatedPosition[2], heading: Math.atan2(view.targetContact.velocity[0], -view.targetContact.velocity[2]) },
    } : { targetKnowledge: 'none' as const };
    return {
      ...targetReadout,
      airWing: (() => { const wing = airWingTelemetry(subject, view.actors); if (wing) wing.available &&= view.result === 'active'; return wing; })(),
      airContacts: view.aircraft.filter(airborne).map(p => ({ id: p.id, team: p.team, x: p.position[0], z: p.position[2], heading: p.heading, role: p.role, ownerId: p.ownerId, flightId: p.flightId, phase: p.phase })),
      battery, weaponGroupId, range: Math.hypot(aim[0] - ship.x, aim[2] - ship.z), ready: selectedMounts.filter(m => m.status === 'ready').length, total: selectedMounts.length,
      flightTimeSeconds: flightTimes.length ? flightTimes.reduce((sum, time) => sum + time, 0) / flightTimes.length : undefined,
      ammunition: ammunitionFor(weaponGroupId ?? battery), heSupported: definition.mounts.some(m => selectedWeapon(m.battery, m.weapon, battery, weaponGroupId) && m.weapon.he !== undefined),
      ammunitionStock: (battery === 'torpedo' || battery === 'depth-charge' ? [] : selectedMounts).reduce((stock, m) => { const s = subject.mounts.find(s => s.id === m.id)!; stock.ap += availableAmmunition(s, 'ap'); stock.he += availableAmmunition(s, 'he'); return stock; }, { ap: 0, he: 0 }),
      battle: view.isBattle, result: view.result, playerSunk: !!physicalLoss(view.player),
      remainingSeconds: view.remainingSeconds === undefined ? Math.max(0, BATTLE_RULES.durationSeconds - view.tick / BATTLE_RULES.tickRate) : view.remainingSeconds,
      afloatKg: view.outcome?.afloatKg ?? view.afloatKg, outcome: view.outcome,
      ...(view.missionRules?.objective ? { objective: (() => {
        const ids = view.missionRules.objective.protectedShipIds, own = view.actors.filter(actor => ids.includes(actor.motion.id));
        return { missionId: view.missionRules.id, protectedTotal: own.length, protectedAfloat: own.filter(actor => !physicalLoss(actor)).length };
      })() } : {}),
      contacts: view.actors.map(actor => ({ id: actor.motion.id, shipId: actor.definition.id, name: actor.definition.name, team: actor.team, controller: actor.controller,
        targetId: actor.targetId, x: actor.motion.x, z: actor.motion.z, heading: actor.motion.heading, speed: actor.motion.speed, integrity: actor.damage.integrity / actor.damage.maxIntegrity, sunk: actor.damage.sunk, status: actor.damage.stability.status, combatLost: actor.damage.stability.combatLost, physicalLost: !!physicalLoss(actor) })),
      playerStatus: subject.damage.stability.status,
      playerList: ship.roll * 180 / Math.PI, playerTrim: ship.pitch * 180 / Math.PI, playerDraftChange: -meanHullY(ship),
      control: structuredClone(subject.damage.control),
      playerSupport: supportPerformance(subject, subject.definition),
      playerFires: fireReadout(subject, subject.definition),
      playerDamageReport: shipDamageReadout(subject, subject.definition),
      controlTargets: [...subject.definition.compartments.map(c => ({ id: c.id, name: c.name })), ...subject.definition.mounts.map(m => ({ id: m.id, name: m.name }))],
      mounts: selectedMounts,
      playerIntegrity: subject.damage.integrity / subject.damage.maxIntegrity,
      playerMaxIntegrity: subject.damage.maxIntegrity, playerDamageDealt: view.playerDamageDealt, playerFrags: view.playerFrags,
      playerArmorBlocked: view.playerArmorBlocked,
      damageLog: view.damageLog,
      playerWater: subject.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      ...(subject.submarine && definition.submarine ? { submarine: {
        depthM: hullDepth(ship), targetDepthM: subject.submarine.targetDepthM,
        verticalSpeed: ship.verticalSpeed ?? 0, ballastM3: subject.submarine.ballastM3,
        ballastFraction: subject.submarine.ballastM3 / definition.submarine.ballastCapacityM3,
        emergencyBlow: subject.submarine.emergencyBlow, propulsion: hullDepth(ship) > .5 ? 'Electric' as const : 'Diesel' as const,
        maxDepthM: definition.submarine.maxDepthM, periscopeDepthM: definition.submarine.periscopeDepthM, maxTorpedoDepthM: definition.submarine.maxTorpedoDepthM,
      } } : {}),
      weaponGroups: groups.map(group => {
        const states = (group.battery === 'depth-charge' ? subject.depthChargeLaunchers ?? [] : group.battery === 'torpedo' ? subject.torpedoTubes ?? [] : subject.mounts).filter(m => group.mountIds.includes(m.id));
        const reloading = states.filter(m => m.reload > 0);
        return { ...group, ammunition: ammunitionFor(group.id, group.battery),
          ammo: states.reduce((n, m) => n + ('loaded' in m ? availableAmmunition(m) : m.ammo), 0),
          ready: states.filter(m => m.status === 'ready').length, total: states.length,
          reload: reloading.length ? Math.min(...reloading.map(m => m.reload)) / (group.battery === 'main' || group.battery === 'secondary' ? workRate : 1) : 0 };
      }),
      batteries: (['main', 'secondary', ...(definition.torpedoTubes?.length ? ['torpedo'] : []), ...(definition.depthChargeLaunchers?.length ? ['depth-charge'] : [])] as Battery[]).map(battery => {
        const states = battery === 'depth-charge' ? subject.depthChargeLaunchers! : battery === 'torpedo' ? subject.torpedoTubes! : definition.mounts.filter(m => m.battery === battery).map(m => subject.mounts.find(s => s.id === m.id)!);
        const reloading = states.filter(m => m.reload > 0);
        return { battery, ammunition: ammunitionFor(battery), ammo: states.reduce((n, m) => n + ('loaded' in m ? availableAmmunition(m) : m.ammo), 0), ready: states.filter(m => m.status === 'ready').length, total: states.length,
          reload: reloading.length ? Math.min(...reloading.map(m => m.reload)) / (battery === 'main' || battery === 'secondary' ? workRate : 1) : 0 };
      }),
      message: significant ? `${view.actors.find(actor => actor.motion.id === significant.shipId)?.definition.name ?? 'Ship'} · ${significant.message}` : battery === 'depth-charge' ? 'Drop during a close pass. Charges sink before exploding; keep moving clear of the blast.' : battery === 'torpedo' ? `${definition.torpedoLaunchers?.length ? 'Bring a broadside toward the sight.' : 'Turn bow or stern toward the sight.'} Torpedoes keep their launch course; lead moving targets.` : 'Only aligned, loaded guns fire. Turn the ship to bring guns marked Out of arc onto the target.',
    };
  }

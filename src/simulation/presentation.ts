import { BATTLE_RULES, physicalLoss } from './battleRules';
import { surfaceGunAllowed } from '../ships/armament';
import { equipmentCenter } from './equipmentPose';
import { weaponGroups, selectedWeapon } from '../ships/weaponGroups';
import { airborne } from './aircraft';
import { airWingTelemetry } from './airTelemetry';
import { equipmentCondition, supportPerformance } from './machinery';
import { equipmentIntegrity } from './durability';
import { fireReadout, regionReadout } from './damageReadout';
import { hullDepth, meanHullY } from './ship';
import { add, localToWorld, scale, sub } from './geometry';
import { availableAmmunition, gunWorkRate, solveBallistic } from './weapons';
import { travelFactor } from './ballistics';
import { shipVelocity } from './bots';
import { torpedoIntercept, tubeLocalPosition } from './torpedoes';
import { systemHealth } from './damage';
import type { Ammunition, Battery, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import type { CombatSimulation, CombatTelemetry } from './combat';
import type { DamageLogEntry } from './damageLog';
export type AimView = Pick<CombatSimulation, 'player' | 'target' | 'definition' | 'ship'>;
export type TelemetryView = Pick<CombatSimulation, 'player' | 'target' | 'definition' | 'ship' | 'actors' | 'events' | 'aircraft' | 'shellHistory' | 'result' | 'isBattle' | 'tick' | 'outcome' | 'targetUnderway'> & {
 ammunitionSelection: Readonly<Record<string, Ammunition>>;
 playerDamageDealt: number; playerFrags: number; damageLog: DamageLogEntry[]; afloatKg: [number, number];
};

export function presentationAim(view: AimView, moduleId?: string, battery: Battery = 'main', weaponGroupId?: string): Vec3 {
    const m = view.target.definition.modules.find(m => m.id === moduleId);
    const gun = moduleId?.startsWith('mount:') ? view.target.definition.mounts.find(m => m.id === moduleId.slice(6)) : undefined;
    const center = m && equipmentCenter(view.target,view.target.definition,m);
    const aim = localToWorld(gun ? [gun.position[0], gun.position[1] + gun.weapon.gunhouseSize[2] / 2, gun.position[2]] : center ? [center[0], Math.max(.5, center[1]), center[2]] : [0, .5, 0], view.target.motion);
    if (battery === 'torpedo' && view.definition.torpedoTubes?.length) {
      const tube = view.definition.torpedoTubes.find(t => selectedWeapon('torpedo', t.weapon, battery, weaponGroupId));
      if (!tube) return aim;
      return torpedoIntercept(localToWorld(tubeLocalPosition(view.player, tube), view.ship), aim, shipVelocity(view.target), tube.weapon.speed) ?? aim;
    }
    const weapon = view.definition.mounts.find(m => selectedWeapon(m.battery, m.weapon, battery, weaponGroupId))?.weapon;
    const speed = weapon?.muzzleSpeed ?? 820, drag = weapon?.ballistics?.dragPerSecond ?? 0;
    const from: Vec3 = [view.ship.x, view.ship.y + 8, view.ship.z];
    let time = Math.hypot(aim[0] - view.ship.x, aim[2] - view.ship.z) / speed;
    for (let i = 0; i < 3; i++) {
      const solution = solveBallistic(from, sub(add(aim, scale(shipVelocity(view.target), time)), scale(shipVelocity(view.player), travelFactor(time, drag))), speed, drag);
      if (!solution) break;
      time = solution.time;
    }
    return add(aim, scale(shipVelocity(view.target), time));
  }
export function presentationTelemetry(view: TelemetryView, battery: Battery, aim: Vec3, weaponGroupId?: string, subject: FleetActor = view.player): CombatTelemetry {
    const definition = subject.definition, ship = subject.motion;
    const groups = weaponGroups(definition);
    const ammunitionFor = (key: string, fallback = key): Ammunition => subject === view.player
      ? view.ammunitionSelection[key] ?? view.ammunitionSelection[fallback] ?? 'ap'
      : subject.mounts.find(m => groups.find(g => g.id === key || g.battery === key)?.mountIds.includes(m.id))?.loaded ?? 'ap';
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
      const time = state.aimCache?.time;
      return surfaceGunAllowed(definition, m.weapon) && selectedWeapon(m.battery, m.weapon, battery, weaponGroupId) && ['ready', 'reloading', 'turning'].includes(state.status) && time !== undefined && Number.isFinite(time) && time > 0 ? [time] : [];
    });
    return {
      airWing: (() => { const wing = airWingTelemetry(subject, view.actors); if (wing) wing.available &&= view.result === 'active'; return wing; })(),
      airContacts: view.aircraft.filter(airborne).map(p => ({ id: p.id, team: p.team, x: p.position[0], z: p.position[2], heading: p.heading, role: p.role, ownerId: p.ownerId, flightId: p.flightId, phase: p.phase })),
      battery, weaponGroupId, range: Math.hypot(aim[0] - ship.x, aim[2] - ship.z), ready: selectedMounts.filter(m => m.status === 'ready').length, total: selectedMounts.length,
      flightTimeSeconds: flightTimes.length ? flightTimes.reduce((sum, time) => sum + time, 0) / flightTimes.length : undefined,
      ammunition: ammunitionFor(weaponGroupId ?? battery), heSupported: definition.mounts.some(m => selectedWeapon(m.battery, m.weapon, battery, weaponGroupId) && m.weapon.he !== undefined),
      ammunitionStock: (battery === 'torpedo' || battery === 'depth-charge' ? [] : selectedMounts).reduce((stock, m) => { const s = subject.mounts.find(s => s.id === m.id)!; stock.ap += availableAmmunition(s, 'ap'); stock.he += availableAmmunition(s, 'he'); return stock; }, { ap: 0, he: 0 }),
      targetMounts: view.target.definition.mounts.map((m, i) => ({ id: m.id, name: m.name, condition: view.target.mounts[i].hp / 100 })),
      targetId: view.target.motion.id, targetName: view.target.definition.name,
      ...(view.target.submarine ? { targetDepthM: hullDepth(view.target.motion) } : {}),
      targetRange: Math.hypot(view.target.motion.x - ship.x, view.target.motion.z - ship.z),
      battle: view.isBattle, result: view.result, playerSunk: !!physicalLoss(view.player),
      remainingSeconds: Math.max(0, BATTLE_RULES.durationSeconds - view.tick / BATTLE_RULES.tickRate),
      afloatKg: view.outcome?.afloatKg ?? view.afloatKg, outcome: view.outcome,
      contacts: view.actors.map(actor => ({ id: actor.motion.id, shipId: actor.definition.id, name: actor.definition.name, team: actor.team, controller: actor.controller,
        targetId: actor.targetId, x: actor.motion.x, z: actor.motion.z, heading: actor.motion.heading, integrity: actor.damage.integrity / actor.damage.maxIntegrity, sunk: actor.damage.sunk, status: actor.damage.stability.status, combatLost: actor.damage.stability.combatLost, physicalLost: !!physicalLoss(actor) })),
      targetStatus: view.target.damage.stability.status, playerStatus: subject.damage.stability.status, targetList: view.target.motion.roll * 180 / Math.PI, targetTrim: view.target.motion.pitch * 180 / Math.PI, targetDraftChange: -meanHullY(view.target.motion),
      playerList: ship.roll * 180 / Math.PI, playerTrim: ship.pitch * 180 / Math.PI, playerDraftChange: -meanHullY(ship),
      control: structuredClone(subject.damage.control), targetFires: [...view.target.damage.control.rooms, ...view.target.damage.control.mounts].filter(f => f.intensity > 0).length,
      playerSupport: supportPerformance(subject, subject.definition), targetSupport: supportPerformance(view.target, view.target.definition),
      playerFires: fireReadout(subject, subject.definition), targetFireDetails: fireReadout(view.target, view.target.definition), targetRegions: regionReadout(view.target, view.target.definition),
      controlTargets: [...subject.definition.compartments.map(c => ({ id: c.id, name: c.name })), ...subject.definition.mounts.map(m => ({ id: m.id, name: m.name }))],
      targetIntegrity: view.target.damage.integrity / view.target.damage.maxIntegrity, targetWater: view.target.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      targetEquipmentIntegrity: equipmentIntegrity(view.target, view.target.definition),
      targetPower: systemHealth(view.target, view.target.definition, 'engine'), targetSteering: systemHealth(view.target, view.target.definition, 'steering'), targetSunk: view.target.damage.sunk, targetUnderway: view.targetUnderway,
      mounts: selectedMounts, modules: view.target.definition.modules.map((m, i) => ({ id: m.id, name: m.name, condition: view.target.damage.modules[i].hp / m.hp, ...equipmentCondition(view.target, view.target.definition, m) })),
      playerIntegrity: subject.damage.integrity / subject.damage.maxIntegrity,
      playerMaxIntegrity: subject.damage.maxIntegrity, playerDamageDealt: view.playerDamageDealt, playerFrags: view.playerFrags,
      damageLog: view.damageLog,
      playerWater: subject.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      ...(subject.submarine && definition.submarine ? { submarine: {
        depthM: hullDepth(ship), targetDepthM: subject.submarine.targetDepthM,
        verticalSpeed: ship.verticalSpeed ?? 0, ballastM3: subject.submarine.ballastM3,
        ballastFraction: subject.submarine.ballastM3 / definition.submarine.ballastCapacityM3,
        emergencyBlow: subject.submarine.emergencyBlow, propulsion: hullDepth(ship) > .5 ? 'Electric' as const : 'Diesel' as const,
        maxDepthM: definition.submarine.maxDepthM, periscopeDepthM: definition.submarine.periscopeDepthM, maxTorpedoDepthM: definition.submarine.maxTorpedoDepthM,
      } } : {}),
      targetDefeatCause: view.target.damage.defeatCause,
      shellHistory: view.shellHistory.filter(h => h.impacts.some(i => i.shipId === view.target.motion.id)).slice(-8).reverse().map(h => ({ ...h, impacts: h.impacts.filter(i => i.shipId === view.target.motion.id).map(i => ({ ...i, position: [...i.position] })) })),
      targetPosition: { x: view.target.motion.x, z: view.target.motion.z, heading: view.target.motion.heading },
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

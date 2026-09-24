/** Carrier strike: Enterprise and Shōkaku trade strikes across 20 km of open sea, a morning in the manner of
 * Santa Cruz (October 1942). Enterprise's Dauntlesses and Devastators go for Shōkaku under a Wildcat escort while a second
 * Wildcat flight holds over her; Shōkaku's Vals and Kates go for Enterprise while her Zeros stay home. */
import type { Command } from '../../../src/multiplayer/generated/Command';
import type { AirOrder } from '../../../src/multiplayer/generated/AirOrder';
import type { Film, Scout, Stage } from '../types';
import { about, ease, lerp, mix, orbit, ride, watch } from '../camera';
import { before, first } from '../scouting';

const ENTERPRISE = 'player', FLETCHER = 'friendly-1', SHOKAKU = 'enemy-1', YUKIKAZE = 'enemy-2';

/** A carrier's first flight of each role, addressed the way the battle groups them. */
function flight(stage: Stage, carrier: string, role: 'fighter' | 'dive-bomber' | 'torpedo-bomber', index = 1): string {
  const actor = stage.ships().find(entry => entry.motion.id === carrier);
  const squadron = actor?.definition.airWing?.squadrons.find(entry => entry.role === role);
  if (!squadron) throw new Error(`carrier-strike: ${carrier} has no ${role} squadron.`);
  return `${carrier}/${squadron.id}/squadron-${index}`;
}
/** A point in a ship's or aircraft's own frame this frame, or where the camera last was if it is gone. */
function pose(stage: Stage, id: string, offset: [number, number, number]): [number, number, number] {
  const subject = stage.pose(id);
  if (!subject) throw new Error(`carrier-strike: ${id} is not in the battle at ${stage.seconds.toFixed(1)} s.`);
  return about(subject, offset);
}
/** The first Zero shot down by a fighter, when and by which Wildcat: the burst fired at the moment it fell. */
function zeroDown(scout: Scout): { tick: number; killer: string } | undefined {
  const loss = scout.events.find(event => event.kind === 'aircraft-lost' && event.aircraftId?.startsWith(`${SHOKAKU}/`) && event.message.startsWith('a6m2'));
  const burst = loss && scout.events.find(event => event.kind === 'aircraft-fire' && event.message.startsWith('Fighter') && event.aircraftId?.startsWith(`${ENTERPRISE}/`)
    && Math.abs(event.tick - loss.tick) <= 30);
  return loss && burst?.aircraftId ? { tick: loss.tick / 60, killer: burst.aircraftId } : undefined;
}
const air = (flightId: string, order: AirOrder): Command => ({ type: 'air', flightId, order });
const route = (waypoints: [number, number][], knots: number): Command => ({ type: 'route', waypoints, speedMps: knots * .5144, looped: false, append: false });

const weapons = (aa: boolean): Command => ({ type: 'weapons', policy: { guns: false, aa, torpedoes: false } });
/** An attacker that has committed: diving, or on its torpedo run. Committed pilots hold their run under fire. */
const committed = (stage: Stage, owner: string) => stage.aircraft().some(plane => plane.ownerId === owner && plane.phase === 'attack'
  && (plane.role === 'dive-bomber' ? plane.pitch < -.3 : plane.role === 'torpedo-bomber' && plane.position[1] < 55));

const film: Film = {
  battle: { battle: 'enterprise-cv6;fletcher;shokaku:normal,yukikaze:normal', range: 20000, map: 'north-atlantic', time: 'morning', weather: 'partly-cloudy', seed: 1026 },
  seconds: 470,
  orders(stage) {
    stage.once('sail', () => {
      // Both forces steam across the line between them, holding their fire: this is a
      // battle of aircraft. Anti-aircraft fire opens when the first attacker commits (below), since near misses turn
      // attackers away before they commit and the strikes would otherwise never arrive.
      stage.order(ENTERPRISE, route([[7000, -600]], 20));
      stage.order(FLETCHER, route([[7000, 200]], 20));
      stage.order(SHOKAKU, route([[-7000, -19400]], 18));
      stage.order(YUKIKAZE, route([[-7000, -20200]], 18));
      for (const ship of [ENTERPRISE, FLETCHER, SHOKAKU, YUKIKAZE]) stage.order(ship, weapons(false));
      stage.order(ENTERPRISE, air(flight(stage, ENTERPRISE, 'dive-bomber'), { kind: 'attack', targetId: SHOKAKU }));
      stage.order(ENTERPRISE, air(flight(stage, ENTERPRISE, 'dive-bomber', 2), { kind: 'attack', targetId: SHOKAKU }));
      // The Devastators wait out of sight until the dive bombers are done.
      stage.order(ENTERPRISE, air(flight(stage, ENTERPRISE, 'torpedo-bomber'), { kind: 'patrol', point: [1500, 250, -12500] }));
      stage.order(ENTERPRISE, air(flight(stage, ENTERPRISE, 'fighter'), { kind: 'escort', flightId: flight(stage, ENTERPRISE, 'dive-bomber') }));
    });
    // Shōkaku's captain launches everything at the nearest enemy; once airborne her bombers go for the carrier, her Zeros with them.
    if (stage.seconds >= 20) stage.once('retask', () => {
      stage.order(SHOKAKU, air(flight(stage, SHOKAKU, 'dive-bomber'), { kind: 'attack', targetId: ENTERPRISE }));
      stage.order(SHOKAKU, air(flight(stage, SHOKAKU, 'torpedo-bomber'), { kind: 'attack', targetId: ENTERPRISE }));
      stage.order(SHOKAKU, air(flight(stage, SHOKAKU, 'fighter'), { kind: 'escort', flightId: flight(stage, SHOKAKU, 'dive-bomber') }));
    });
    // Where the strikes cross, the Wildcats leave their charges to take on the Zeros.
    if (stage.seconds >= 100) stage.once('intercept', () => {
      stage.order(ENTERPRISE, air(flight(stage, ENTERPRISE, 'fighter'), { kind: 'intercept', flightId: flight(stage, SHOKAKU, 'fighter') }));
    });
    // Shōkaku's guns open on the dive bombers, fall silent once they are gone, and open again on the torpedo run.
    const dives = stage.aircraft().filter(plane => plane.ownerId === ENTERPRISE && plane.role === 'dive-bomber');
    const divesDone = dives.some(plane => !plane.payload) && !dives.some(plane => plane.phase === 'attack');
    const torpedoRun = stage.aircraft().some(plane => plane.ownerId === ENTERPRISE && plane.role === 'torpedo-bomber' && plane.phase === 'attack' && plane.position[1] < 55);
    if (committed(stage, ENTERPRISE)) stage.once('shokaku-fires', () => { stage.order(SHOKAKU, weapons(true)); stage.order(YUKIKAZE, weapons(true)); });
    if (divesDone) stage.once('torpedoes-go', () => {
      stage.order(SHOKAKU, weapons(false)); stage.order(YUKIKAZE, weapons(false));
      stage.order(ENTERPRISE, air(flight(stage, ENTERPRISE, 'torpedo-bomber'), { kind: 'attack', targetId: SHOKAKU }));
    });
    if (torpedoRun) stage.once('shokaku-fires-again', () => { stage.order(SHOKAKU, weapons(true)); stage.order(YUKIKAZE, weapons(true)); });
    if (committed(stage, SHOKAKU)) stage.once('enterprise-fires', () => { stage.order(ENTERPRISE, weapons(true)); stage.order(FLETCHER, weapons(true)); });
  },
  shots: [
    {
      name: 'launch', seconds: 6, fade: { in: 1.5 },
      start: scout => before(first(scout, 'aircraft-launch', event => event.aircraftId === 'player/vb-6/7'), .5),
      title: { text: 'Carrier strike', detail: 'Enterprise and Shōkaku · a morning at sea', from: 1.2, to: 5.2 },
      camera: stage => watch(stage, { eye: () => pose(stage, ENTERPRISE, [-17, 19.5, 92]), target: () => pose(stage, ENTERPRISE, [3, 17, -30]), fov: 44, sway: .15 }),
    },
    {
      name: 'airborne', seconds: 5, start: scout => before(first(scout, 'aircraft-launch', event => event.aircraftId === 'player/vt-6/3'), -1),
      camera: stage => watch(stage, { from: ENTERPRISE, eye: t => lerp([40, 50, 460], [55, 62, 430], ease.inOut(t)), target: { id: ENTERPRISE, offset: [0, 30, 40] }, fov: 34, sway: .5 }),
    },
    {
      name: 'formation', seconds: 7, start: 84,
      camera: stage => ride(stage, 'player/vb-6/1', { offset: t => lerp([-58, 12, -34], [-48, 15, -18], ease.inOut(t)), look: [15, -4, 40], fov: 42, lag: .2, sway: .6 }),
    },
    {
      name: 'the-other-strike', seconds: 5, start: 97,
      camera: stage => watch(stage, { from: 'enemy-1/shokaku-dive/1', eye: [70, 14, 340], target: 'enemy-1/shokaku-dive/1', fov: 38, lag: .1, sway: .4 }),
    },
    {
      name: 'guns', seconds: 3.5, start: scout => before(first(scout, 'aircraft-fire', event => event.aircraftId === 'player/vf-6/2'), 1.3),
      camera: stage => ride(stage, 'player/vf-6/2', { offset: [1.2, 2.4, -14], look: [0, 0, 200], attitude: true, fov: 55, lag: .05 }),
    },
    {
      name: 'target', seconds: 5, start: 150,
      camera: stage => watch(stage, { eye: () => pose(stage, 'player/vb-6/1', [4, 5, -18]), target: { id: SHOKAKU, offset: [0, 10, 0] }, fov: 28, lag: .25 }),
    },
    {
      name: 'dive', seconds: 7.5, start: scout => before(first(scout, 'bomb-release', event => event.aircraftId === 'player/vb-6/1'), 6.8),
      camera: stage => ride(stage, 'player/vb-6/1', { offset: [0, 3.5, -17], look: [0, -2, 60], attitude: true, fov: 50, lag: .08 }),
    },
    {
      name: 'impact', seconds: 7.5, start: scout => before(first(scout, 'bomb-release', event => event.aircraftId === 'player/vb-6/1'), -.9),
      camera: stage => watch(stage, { from: SHOKAKU, eye: [560, 6, 120], target: { id: SHOKAKU, offset: [0, 45, 0] }, fov: 21, clearSea: 3, sway: .5 }),
    },
    {
      name: 'enterprise-dive', seconds: 6, start: scout => before(first(scout, 'bomb-release', event => event.shipId === SHOKAKU), 5.2),
      camera: stage => watch(stage, { from: ENTERPRISE, eye: [320, 4, -170], target: () => lerp(pose(stage, ENTERPRISE, [0, 30, 0]), stage.pose('enemy-1/shokaku-dive/2')?.position ?? pose(stage, ENTERPRISE, [0, 300, 0]), .45),
        fov: 48, lag: .3, clearSea: 2, sway: .4 }),
    },
    {
      name: 'enterprise-hit', seconds: 6, start: scout => before(first(scout, 'bomb-release', event => event.shipId === SHOKAKU), -.8),
      camera: stage => watch(stage, { from: ENTERPRISE, eye: [600, 10, 120], target: { id: ENTERPRISE, offset: [0, 25, 0] }, fov: 36, clearSea: 3, sway: .5 }),
    },
    {
      name: 'burning', seconds: 6, start: 205,
      camera: stage => orbit(stage, SHOKAKU, { radius: 520, height: t => mix(90, 120, t), from: 40, to: 75, look: [0, 25, 0], fov: 32 }),
    },
    {
      name: 'zero', seconds: 4, start: scout => before(first(scout, 'aircraft-lost', event => event.aircraftId === 'player/vt-6/6'), 2.2),
      camera: stage => ride(stage, 'enemy-1/shokaku-fighters/6', { offset: [0, 2.5, -15], look: [0, 0, 150], attitude: true, fov: 55, lag: .05 }),
    },
    {
      name: 'wildcat', seconds: 4.5, start: scout => before(zeroDown(scout)?.tick, 1.2),
      camera: (stage, scout) => ride(stage, zeroDown(scout)!.killer, { offset: [-2, 2.5, -14], look: [0, 0, 150], attitude: true, fov: 55, lag: .05 }),
    },
    {
      name: 'torpedo-run', seconds: 9.5, start: scout => before(first(scout, 'aircraft-release', event => event.aircraftId === 'player/vt-6/1'), 8),
      camera: stage => ride(stage, 'player/vt-6/1', { offset: t => lerp([-26, -9, -34], [-22, -10, -26], t), look: [4, -2, 60], fov: 40, lag: .12, sway: .4, clearSea: 3 }),
    },
    {
      name: 'tracks', seconds: 8, start: scout => before(first(scout, 'torpedo-hit', event => event.shipId === SHOKAKU), 4.5),
      camera: stage => watch(stage, { from: SHOKAKU, eye: [-360, 4, -140], target: { id: SHOKAKU, offset: [0, 8, 20] }, fov: 30, clearSea: 2, sway: .4 }),
    },
    {
      name: 'yukikaze', seconds: 8, start: scout => before(first(scout, 'sunk', event => event.shipId === YUKIKAZE), 1),
      camera: stage => watch(stage, { from: YUKIKAZE, eye: [420, 8, 160], target: { id: YUKIKAZE, offset: [0, 5, 0] }, fov: 26, clearSea: 2, sway: .4 }),
    },
    {
      name: 'homeward', seconds: 7, start: 268,
      camera: stage => ride(stage, 'player/vb-6/1', { offset: [-22, 9, -48], look: [40, -12, 120], fov: 42, lag: .3, sway: .6 }),
    },
    {
      name: 'finale', seconds: 9, start: 300, fade: { out: 2.5 },
      camera: stage => orbit(stage, SHOKAKU, { radius: t => mix(700, 1100, t), height: t => mix(60, 260, t), from: 200, to: 235, look: [0, 20, 0], fov: 30 }),
    },
  ],
};
export default film;

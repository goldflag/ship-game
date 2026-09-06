import { expect, test } from 'bun:test';
import { ShellFollow } from './ShellFollow';
import type { Shell } from '../simulation/damage';
import { CombatSimulation, type CombatEvent } from '../simulation/combat';
import { FIXED_DT } from '../simulation/ship';
import { shipPreset } from '../ships/presets';

const shell = (id: number, ownerId = 'player'): Shell => ({ id, ownerId, position: [0, 100, -500], velocity: [0, -20, -800], age: 1, caliberM: .38, damage: 70, penetrationMm: 400, visited: [] });

test('shell follow is opt-in, picks only the latest player shell and keeps that shell through the salvo', () => {
  const follow = new ShellFollow();
  const salvo = [shell(1), shell(2), shell(3, 'enemy')];
  follow.update(salvo, [], 'player', .016);
  expect(follow.phase).toBe('off');
  follow.setEnabled(true);
  follow.update([], [], 'player', .016);
  expect(follow.phase).toBe('ready');
  follow.update(salvo, [], 'player', .016);
  expect(follow.shellId).toBe(2);
  expect(follow.phase).toBe('flight');
  salvo[1].position = [100, 140, -900];
  follow.update([...salvo, shell(4)], [], 'player', .016);
  expect(follow.shellId).toBe(2);
  expect(follow.view!.position).toEqual(salvo[1].position);
  expect(follow.view!.position).not.toBe(salvo[1].position);
});

test('impact holds at the authoritative hit, freezes on pause, then waits for a fresh salvo', () => {
  const follow = new ShellFollow();
  const shot = shell(1), other = shell(2, 'enemy');
  follow.setEnabled(true);
  follow.update([shot, other], [], 'player', .016);
  const impact: CombatEvent = { kind: 'splash', position: [0, 0, -2000], shell: { id: 1, caliberM: .38, velocity: [0, -80, -800] }, sequence: 4, tick: 120, message: 'Shell splash', shipId: '' };
  follow.update([other, shell(3)], [impact], 'player', .016);
  expect(follow.phase).toBe('impact');
  expect(follow.view!.position).toEqual(impact.position);
  for (let i = 0; i < 100; i++) follow.update([other, shell(3)], [impact], 'player', 0);
  expect(follow.phase).toBe('impact');
  follow.update([other, shell(3)], [impact], 'player', 1.2);
  follow.update([other, shell(3)], [impact], 'player', .016);
  expect(follow.phase).toBe('ready');
  follow.update([shell(4)], [impact], 'player', .016);
  expect(follow.shellId).toBe(4);
  follow.setEnabled(false);
  expect(follow.view).toBeUndefined();
  expect(follow.phase).toBe('off');
});

test('missing or reset projectiles release the camera without inventing an impact', () => {
  const follow = new ShellFollow();
  follow.setEnabled(true);
  follow.update([shell(10)], [], 'player', .016);
  follow.update([], [], 'player', .016);
  expect(follow.phase).toBe('ready');
  expect(follow.view).toBeUndefined();
  follow.setEnabled(false);
  follow.setEnabled(true);
  follow.update([shell(1)], [], 'player', .016);
  expect(follow.shellId).toBe(1);
});

for (const stepsPerFrame of [1, 6]) {
  for (const [region, y, z, damage, terminal] of [
    ['bridge', 15, -18, 7, 'splash'],
    ['unarmored bow', 4, -115, 7, 'splash'],
    ['armored hull', .5, 0, 14, 'stopped'],
  ] as const) {
    test(`shell follow holds on the first ${region} strike at ${60 / stepsPerFrame} fps while combat resolves normally`, () => {
      const def = shipPreset('bismarck'), sim = new CombatSimulation(def), follow = new ShellFollow();
      sim.player.motion.x = -1000;
      Object.assign(sim.target.motion, { x: 0, z: 0 });
      const weapon = def.mounts[0].weapon;
      const round: Shell = { ...shell(1), position: [-30, y, z], velocity: [weapon.muzzleSpeed, -20, 0], age: 0,
        caliberM: weapon.caliberM, damage: weapon.damage, penetrationMm: weapon.penetrationMm };
      sim.shells.push(round);
      follow.setEnabled(true);
      follow.update(sim.shells, sim.events, 'player', 0);
      let firstStrike: CombatEvent | undefined;
      let heldWhileShellAlive = false;
      for (let i = 0; i < 60 && sim.shells.length; i += stepsPerFrame) {
        for (let step = 0; step < stepsPerFrame; step++) {
          sim.step({ throttle: 0, rudder: 0 }, { aim: [0, y, z], fire: false, battery: 'main' });
        }
        follow.update(sim.shells, sim.events, 'player', FIXED_DT * stepsPerFrame);
        firstStrike ??= sim.events.find(event => event.shell?.id === round.id && event.kind !== 'shot');
        if (firstStrike) {
          expect(follow.phase).toBe('impact');
          expect(follow.view!.position).toEqual(firstStrike.position);
          expect(follow.view!.velocity).toEqual(firstStrike.shell!.velocity);
          heldWhileShellAlive ||= sim.shells.length > 0;
        }
      }
      expect(firstStrike?.kind).toBe('penetration');
      if (terminal === 'splash') expect(heldWhileShellAlive).toBe(true);
      expect(sim.shells).toHaveLength(0);
      expect(sim.target.damage.maxIntegrity - sim.target.damage.integrity).toBe(damage);
      expect(sim.events.at(-1)!.kind).toBe(terminal);
      expect(follow.view!.position).not.toEqual(sim.events.at(-1)!.position);
    });
  }
}

test('entry, exit and splash between frames keep the first strike and never resume the penetrating shell', () => {
  const follow = new ShellFollow(), round = shell(1);
  follow.setEnabled(true);
  follow.update([round], [], 'player', .016);
  const entry: CombatEvent = { kind: 'penetration', position: [0, 15, -2000], shell: { id: 1, caliberM: .38, velocity: [0, -20, -800] },
    sequence: 1, tick: 120, message: 'Penetrated bridge', shipId: 'target' };
  const exit = { ...entry, sequence: 2, position: [0, 14, -2010] as [number, number, number] };
  const splash: CombatEvent = { ...entry, sequence: 3, kind: 'splash', position: [0, 0, -2500], shipId: '' };
  follow.update([], [entry, exit, splash], 'player', .1);
  expect(follow.phase).toBe('impact');
  expect(follow.view!.position).toEqual(entry.position);
  follow.update([], [entry, exit, splash], 'player', 0);
  expect(follow.phase).toBe('impact');
  follow.update([], [entry, exit, splash], 'player', 1.2);
  expect(follow.phase).toBe('ready');

  // A different pass-through may still be airborne when its impact hold finishes.
  follow.update([shell(2)], [], 'player', .016);
  const nextHit = { ...entry, sequence: 4, shell: { ...entry.shell!, id: 2 } };
  follow.update([shell(2)], [nextHit], 'player', .016);
  expect(follow.phase).toBe('impact');
  follow.update([shell(2)], [nextHit], 'player', 1.2);
  follow.update([shell(2)], [nextHit], 'player', .016);
  expect(follow.phase).toBe('ready');
  expect(follow.view).toBeUndefined();
});

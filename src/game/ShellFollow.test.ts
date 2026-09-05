import { expect, test } from 'bun:test';
import { ShellFollow } from './ShellFollow';
import type { Shell } from '../simulation/damage';
import type { CombatEvent } from '../simulation/combat';

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

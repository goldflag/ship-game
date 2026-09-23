import { expect, test } from 'bun:test';
import { seededRandom, thunderFor } from './lightning';
import { thunderSound } from './thunder';

test('distant thunder rumbles longer and darker, and only near strikes crack', () => {
  const random = seededRandom(3);
  const sounds = [300, 1000, 3000, 8000, 15000, 22000].map(distance => ({ distance, ...thunderSound(distance, thunderFor('ground', distance).loudness, random) }));
  for (let i = 1; i < sounds.length; i++) {
    expect(sounds[i].rumble).toBeGreaterThanOrEqual(sounds[i - 1].rumble);
    expect(sounds[i].cutoff).toBeLessThan(sounds[i - 1].cutoff);
    expect(sounds[i].attack).toBeGreaterThanOrEqual(sounds[i - 1].attack);
    expect(sounds[i].level).toBeLessThanOrEqual(sounds[i - 1].level);
  }
  expect(sounds[0].crack).toBeGreaterThan(.5);
  expect(sounds.find(sound => sound.distance === 8000)!.crack).toBe(0);
  expect(sounds[0].rumble).toBeGreaterThanOrEqual(3);
  expect(sounds[sounds.length - 1].rumble).toBeLessThanOrEqual(14);
  expect(sounds[sounds.length - 1].cutoff).toBeLessThan(250);
  for (const sound of sounds) {
    expect(Math.abs(sound.pan)).toBeLessThanOrEqual(.5);
    expect(sound.rolls.length).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < sound.rolls.length; k++) {
      expect(sound.rolls[k].time).toBeGreaterThanOrEqual(k ? sound.rolls[k - 1].time : 0);
      expect(sound.rolls[k].time).toBeLessThan(sound.rumble);
      expect(sound.rolls[k].level).toBeGreaterThan(0);
      expect(sound.rolls[k].level).toBeLessThanOrEqual(1);
    }
  }
});

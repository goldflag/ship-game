import { expect, test } from 'bun:test';
import type { CombatEvent } from '../simulation/combat';
import { CombatAudioEvents, DEFAULT_AUDIO, SOUND_IDS, sanitizeAudio, spatialMix } from './audio';
import recipe from '../../assets/audio/naval/recipe.json';
import build from '../../assets/audio/naval/build.json';

function event(sequence: number, kind: CombatEvent['kind'], extra: Partial<CombatEvent> = {}): CombatEvent {
  return { sequence, tick: 10, kind, position: [0, 10, 0], shipId: 'player', message: '', shell: { id: sequence, caliberM: .38, velocity: [0, 0, -820] }, ...extra };
}

test('simultaneous barrels share a turret boom while separate mounts and calibers keep their sound', () => {
  const cursor = new CombatAudioEvents();
  const events = [event(1, 'shot'), event(2, 'shot', { position: [3, 10, 0] }), event(3, 'shot', { position: [0, 10, 30] }),
    event(4, 'shot', { position: [0, 10, 60], shell: { id: 4, caliberM: .127, velocity: [0, 0, -800] } })];
  expect(cursor.consume(events, 11).map(c => c.id)).toEqual(['main-gun-a', 'main-gun-a', 'secondary-gun']);
  expect(cursor.consume(events, 12)).toEqual([]);
  const heavy = event(5, 'shot', { shell: { id: 5, caliberM: .46, velocity: [0, 0, -780] } });
  expect(cursor.consume([...events, heavy], 12)[0].id).toBe('main-gun-b');
});

test('one shell crossing several plates across frames sounds once; a magazine detonation remains audible', () => {
  const cursor = new CombatAudioEvents();
  const first = event(1, 'penetration');
  const second = event(2, 'penetration', { shell: first.shell });
  const module = event(3, 'module', { shell: first.shell });
  expect(cursor.consume([first], 10).map(c => c.id)).toEqual(['armor-hit']);
  expect(cursor.consume([first, second, module], 11)).toEqual([]);
  expect(cursor.consume([event(4, 'module', { shell: first.shell, detonation: true })], 12).map(c => c.id)).toEqual(['magazine-explosion']);
});

test('misses and ricochets are distinct, stale events are dropped, and resets do not replay history', () => {
  const cursor = new CombatAudioEvents();
  expect(cursor.consume([event(1, 'splash'), event(2, 'ricochet'), event(3, 'module'), event(4, 'sunk')], 10).map(c => c.id)).toEqual(['splash', 'ricochet']);
  expect(cursor.consume([event(5, 'shot')], 50)).toEqual([]);
  cursor.reset([event(6, 'shot')]);
  expect(cursor.consume([event(6, 'shot')], 10)).toEqual([]);
  cursor.reset();
  expect(cursor.consume([event(1, 'shot')], 10)).toHaveLength(1);
});

test('camera orientation controls stereo placement, with finite distance attenuation at the listener', () => {
  const origin = [0, 0, 0] as [number, number, number];
  const right = [1, 0, 0] as [number, number, number];
  expect(spatialMix(origin, origin, right)).toEqual({ gain: 1, pan: 0, cutoff: 16000 });
  expect(spatialMix([100, 0, 0], origin, right).pan).toBeGreaterThan(0);
  expect(spatialMix([100, 0, 0], origin, [-1, 0, 0]).pan).toBeLessThan(0);
  expect(spatialMix([2000, 0, 0], origin, right).gain).toBeLessThan(spatialMix([100, 0, 0], origin, right).gain);
});

test('invalid persisted audio values cannot make the mix NaN or exceed unity', () => {
  expect(sanitizeAudio(null)).toEqual(DEFAULT_AUDIO);
  expect(sanitizeAudio({ master: 3, effects: -1, ambience: NaN, interface: 'loud', muted: 'false' })).toEqual({ ...DEFAULT_AUDIO, master: 1, effects: 0 });
  expect(sanitizeAudio({ ...DEFAULT_AUDIO, ambience: 1 })).toEqual(DEFAULT_AUDIO);
});

test('every runtime sound has its generated original, prompt, and checked PCM output', async () => {
  expect(recipe.clips.filter(clip => clip.publish !== false).map(clip => clip.id)).toEqual([...SOUND_IDS]);
  expect(build.clips.map(clip => clip.id)).toEqual([...SOUND_IDS]);
  for (const clip of recipe.clips.filter(clip => clip.publish === false)) {
    expect(await Bun.file(new URL(`../../public/audio/naval/${clip.id}.wav`, import.meta.url)).exists()).toBe(false);
  }
  for (const clip of build.clips) {
    expect(clip.loop).toBe(false);
    for (const [path, hash] of [[clip.runtime, clip.runtimeSha256], [clip.source, clip.sourceSha256]]) {
      const bytes = await Bun.file(new URL(`../../${path}`, import.meta.url)).arrayBuffer();
      expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(hash);
    }
    expect(clip.durationSeconds).toBeGreaterThan(.1);
    expect(clip.processed.peakDbfs).toBeLessThanOrEqual(-2.99);
  }
});

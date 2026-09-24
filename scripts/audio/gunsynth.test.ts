import { expect, test } from 'bun:test';
import { renderGun, type GunPreset } from './gunsynth';
import recipe from '../../assets/audio/naval/recipe.json';

const procedural = (recipe.clips as { id: string; provider?: string; seed?: number; sample_rate?: number; preset?: GunPreset }[])
  .filter(clip => clip.provider === 'procedural');

test('every gun cue is procedural, and each preset renders a finite, bounded, repeatable report', () => {
  expect(procedural.map(clip => clip.id).sort()).toEqual(['main-gun-a', 'main-gun-b', 'secondary-gun']);
  for (const clip of procedural) {
    const a = renderGun(clip.preset!, clip.sample_rate!, clip.seed!), b = renderGun(clip.preset!, clip.sample_rate!, clip.seed!);
    expect(a.length).toBe(Math.round(clip.preset!.duration * clip.sample_rate!));
    let peak = 0, same = true;
    for (let i = 0; i < a.length; i++) { peak = Math.max(peak, Math.abs(a[i])); if (a[i] !== b[i]) same = false; }
    expect(same).toBe(true);
    expect(Number.isFinite(peak) && peak > .5 && peak <= 1).toBe(true);
    // The report starts at once and the tail ends in silence rather than a click.
    expect(Math.max(...Array.from(a.subarray(0, Math.round(clip.sample_rate! * .01)), Math.abs))).toBeGreaterThan(.05);
    expect(Math.abs(a.at(-1)!)).toBeLessThan(1e-3);
  }
});

test('a different seed changes the grain of a report but not its length', () => {
  const clip = procedural[0];
  const a = renderGun(clip.preset!, 16000, 1), b = renderGun(clip.preset!, 16000, 2);
  expect(a.length).toBe(b.length);
  expect(a.some((v, i) => v !== b[i])).toBe(true);
});

/** Render the recipe's procedural clips (`"provider": "procedural"`) to their originals, which
 * `bun run audio:build` then trims, balances and publishes like any other original.
 *
 *   bun run audio:synth            every procedural clip
 *   bun run audio:synth main-gun-a one clip
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderGun, type GunPreset } from './gunsynth';

const ROOT = join(import.meta.dir, '../..');
const ASSETS = join(ROOT, 'assets/audio/naval');

interface ProceduralClip { id: string; provider: 'procedural'; seed: number; sample_rate: number; preset: GunPreset }

/** 16-bit PCM mono WAV. */
function wav(samples: Float32Array, rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const recipe = JSON.parse(readFileSync(join(ASSETS, 'recipe.json'), 'utf8')) as { clips: { id: string; provider?: string }[] };
const only = process.argv[2];
const clips = recipe.clips.filter((clip): clip is ProceduralClip => clip.provider === 'procedural' && (!only || clip.id === only));
if (!clips.length) throw new Error(only ? `${only} is not a procedural clip in recipe.json` : 'recipe.json has no procedural clips');
for (const clip of clips) {
  const out = join(ASSETS, 'originals', clip.id, `${clip.id}.wav`);
  mkdirSync(dirname(out), { recursive: true });
  const samples = renderGun(clip.preset, clip.sample_rate, clip.seed);
  writeFileSync(out, wav(samples, clip.sample_rate));
  console.log(`${clip.id}: ${(samples.length / clip.sample_rate).toFixed(2)} s -> ${out.slice(ROOT.length + 1)}`);
}

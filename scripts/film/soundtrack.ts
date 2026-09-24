/** A film's soundtrack, laid from what each rendered frame heard (`FrameEvents`, written beside each shot by the film driver).
 *
 * The game's own combat cues play its own clips (`public/audio/naval`) through its own `spatialMix`. What the game leaves silent
 * is synthesized here: radial engines with propeller blade-pass and firing harmonics (Doppler and air absorption by distance),
 * light anti-aircraft and fighter guns, bomb whistles and flak bursts, and a bed of sea and wind. Deterministic: the same frames
 * lay the same track. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spatialMix, type AudioCue } from '../../src/game/audio';
import type { FrameEvents, V3 } from './types';

const RATE = 48_000, FPS = 60, SPEED_OF_SOUND = 343;
const FRAME = RATE / FPS;

/** Engine and propeller per aircraft model: crankshaft rpm at cruise, cylinders, propeller reduction and blades. */
const ENGINES: Record<string, { rpm: number; cylinders: number; gear: number; blades: number; level: number }> = {
  'f4f-4-wildcat': { rpm: 2550, cylinders: 14, gear: .5625, blades: 3, level: 1 },
  'sbd-3-dauntless': { rpm: 2000, cylinders: 9, gear: .5625, blades: 3, level: 1.1 },
  'tbd-1-devastator': { rpm: 2100, cylinders: 14, gear: .5625, blades: 3, level: 1.1 },
  'a6m2-zero': { rpm: 2350, cylinders: 14, gear: .6875, blades: 3, level: .9 },
  'd3a1-val': { rpm: 2300, cylinders: 14, gear: .6875, blades: 3, level: 1 },
  'b5n2-kate': { rpm: 2200, cylinders: 14, gear: .6875, blades: 3, level: 1 },
};
const DEFAULT_ENGINE = ENGINES['sbd-3-dauntless'];

export interface SoundShot { events: string; frames: number; fade?: { in?: number; out?: number } }

/** Lay the soundtrack for `shots` (in cut order) and write it as a 48 kHz stereo WAV at `file`. */
export function layTrack(root: string, shots: readonly SoundShot[], file: string): void {
  const clips = new Clips(root);
  const parts = shots.map(shot => layShot(JSON.parse(readFileSync(shot.events, 'utf8')) as FrameEvents[], shot.frames, clips, shot.fade));
  const length = parts.reduce((sum, part) => sum + part[0].length, 0);
  const left = new Float32Array(length), right = new Float32Array(length);
  let offset = 0;
  for (const [l, r] of parts) { left.set(l, offset); right.set(r, offset); offset += l.length; }
  master(left, right);
  writeWav(file, left, right);
}

function layShot(frames: FrameEvents[], count: number, clips: Clips, fade?: { in?: number; out?: number }): [Float32Array, Float32Array] {
  const length = Math.round(count * FRAME), mix = new Mix(length);
  const listener = (index: number) => frames[Math.min(frames.length - 1, Math.max(0, index))]?.camera ?? { position: [0, 0, 0] as V3, forward: [0, 0, -1] as V3 };
  const rightOf = (forward: V3): V3 => { const l = Math.hypot(forward[0], forward[2]) || 1; return [-forward[2] / l, 0, forward[0] / l]; };
  const place = (index: number, position: V3) => {
    const { position: ear, forward } = listener(index);
    return spatialMix(position, ear, rightOf(forward));
  };
  bed(mix, frames);
  engines(mix, frames, rightOf);
  for (const frame of frames) {
    const start = frame.frame * FRAME;
    for (const cue of frame.cues) mix.clip(clips.get(cue.id), start, cue.gain, cue.rate, place(frame.frame, cue.position));
    // One bomb lands as several reports (contact, then blasts in each compartment); one explosion answers them.
    const landed = new Set<string>();
    for (const event of frame.events) {
      const heard = place(frame.frame, event.position);
      if (event.kind === 'aircraft-fire' && event.message.startsWith('Fighter')) mix.add(start, machineGun(event.aircraftId ?? ''), .5, heard);
      else if (event.kind === 'aircraft-fire') {
        if ((event.caliberM ?? 0) >= .1) {
          mix.clip(clips.get('secondary-gun'), start, .45, 1.08, heard);
          if (event.target && event.flightTime) mix.clip(clips.get('armor-hit'), start + event.flightTime * RATE, .35, .62, place(frame.frame + Math.round(event.flightTime * FPS), event.target));
        } else mix.add(start, pom(event.caliberM ?? .025), .32, heard);
      } else if (event.kind === 'bomb-release') mix.add(start, whistle(), .55, { ...heard, gain: Math.max(heard.gain, .35) });
      else if (event.kind === 'aircraft-lost') mix.clip(clips.get('armor-hit'), start, .45, 1.25, heard);
      else if (!event.shell && (event.kind === 'contact' || event.kind === 'penetration')) {
        const key = event.position.map(n => Math.round(n / 20)).join();
        if (landed.has(key)) continue;
        landed.add(key);
        mix.clip(clips.get('magazine-explosion'), start, 1, .82, heard);
      }
    }
  }
  mix.fade(fade?.in ?? .012, fade?.out ?? .012);
  return [mix.left, mix.right];
}

/** Sea wash near the water and wind higher up, a slow unsteady bed under everything. */
function bed(mix: Mix, frames: FrameEvents[]): void {
  const random = rng(7);
  let brown = 0, low = 0, hiss = 0, hissLow = 0;
  for (let i = 0; i < mix.length; i++) {
    const frame = frames[Math.min(frames.length - 1, Math.floor(i / FRAME))], height = frame?.camera.position[1] ?? 20;
    const nearSea = 1 / (1 + Math.max(0, height - 4) / 40), t = i / RATE;
    const white = random() * 2 - 1;
    brown = brown * .995 + white * .05; low += (brown - low) * .02;
    hiss += (white - hiss) * .35; hissLow += (hiss - hissLow) * .08;
    const swell = .6 + .4 * Math.sin(t * .31 * 2 * Math.PI) * Math.sin(t * .17 * 2 * Math.PI + 1);
    const sample = low * 1.6 * (.35 + .65 * nearSea) * swell + (hiss - hissLow) * .05 * (1 - .5 * nearSea);
    mix.left[i] += sample * .5; mix.right[i] += sample * .5 * (.9 + .1 * Math.sin(t * .7));
  }
}

/** Every aircraft within earshot: a radial engine and its propeller, Doppler-shifted and dulled by distance. */
function engines(mix: Mix, frames: FrameEvents[], rightOf: (forward: V3) => V3): void {
  const ids = new Set(frames.flatMap(frame => frame.aircraft.map(plane => plane.id)));
  for (const id of ids) {
    const track = frames.map(frame => frame.aircraft.find(plane => plane.id === id));
    const model = track.find(Boolean)!.modelId, engine = ENGINES[model] ?? DEFAULT_ENGINE, random = rng(hash(id));
    const detune = 1 + (random() - .5) * .04;
    // Per frame: distance, Doppler, pan and loudness, interpolated sample by sample.
    const points = track.map((plane, index) => {
      if (!plane) return undefined;
      const { position, forward } = frames[index].camera, delta = plane.position.map((n, k) => n - position[k]) as V3;
      const distance = Math.max(1, Math.hypot(...delta)), right = rightOf(forward);
      const pan = Math.max(-.9, Math.min(.9, (delta[0] * right[0] + delta[2] * right[2]) / distance));
      return { distance, pan, speed: plane.speed };
    });
    const phase = [0, 0, 0, 0, 0, 0, 0], filter = { band: 0, bandLow: 0, out: 0 };
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (!point) continue;
      const previous = points[index - 1] ?? point, next = points[index + 1] ?? point;
      const closing = (next.distance - previous.distance) / (2 / FPS);
      const doppler = SPEED_OF_SOUND / Math.max(60, SPEED_OF_SOUND + Math.max(-280, Math.min(280, closing)));
      // Throttle and dive speed raise the revolutions a little.
      const rpm = engine.rpm * detune * (1 + Math.min(.18, Math.max(-.1, (point.speed - 75) / 400)));
      const blade = rpm / 60 * engine.gear * engine.blades * doppler, firing = rpm / 60 * engine.cylinders / 2 * doppler;
      const gain = engine.level * .7 / (1 + point.distance / 55) ** 1.25;
      const cutoff = Math.min(.9, 2 * Math.PI * 11000 / (1 + point.distance / 260) / RATE);
      const leftGain = Math.cos((point.pan + 1) * Math.PI / 4) * gain, rightGain = Math.sin((point.pan + 1) * Math.PI / 4) * gain;
      // Fade a voice in and out where the plane enters or leaves earshot instead of clicking.
      const entering = !points[index - 1] ? 1 : 0, leaving = !points[index + 1] ? 1 : 0;
      for (let s = 0; s < FRAME; s++) {
        const i = Math.round(index * FRAME) + s;
        if (i >= mix.length) break;
        const ramp = entering ? s / FRAME : leaving ? 1 - s / FRAME : 1;
        let prop = 0;
        for (let k = 1; k <= 5; k++) { phase[k] += 2 * Math.PI * blade * k / RATE; prop += Math.sin(phase[k] + k * 1.3) / k ** 1.15; }
        phase[0] += 2 * Math.PI * firing / RATE; phase[6] += 2 * Math.PI * firing * 2 / RATE;
        const white = random() * 2 - 1;
        filter.band += (white - filter.band) * .25; filter.bandLow += (filter.band - filter.bandLow) * .02;
        const exhaust = (filter.band - filter.bandLow) * (.55 + .45 * Math.sin(phase[0]));
        const tone = .3 * Math.sin(phase[0]) + .12 * Math.sin(phase[6]);
        filter.out += (prop * .45 + exhaust * 1.1 + tone - filter.out) * cutoff;
        const sample = filter.out * ramp;
        mix.left[i] += sample * leftGain; mix.right[i] += sample * rightGain;
      }
    }
  }
}

/** A light anti-aircraft round: a sharp report over a short low thump. */
function pom(caliberM: number): Float32Array {
  const random = rng(Math.round(caliberM * 1e4)), length = Math.round(RATE * .16), out = new Float32Array(length);
  const pitch = 70 + (.04 - Math.min(.04, caliberM)) * 2500;
  let hp = 0;
  for (let i = 0; i < length; i++) {
    const t = i / RATE, white = random() * 2 - 1;
    hp += (white - hp) * .6;
    out[i] = (white - hp) * Math.exp(-t / .006) * .9 + Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t / .045) * .8;
  }
  return out;
}

/** A fighter's burst: four to six guns firing about 13 rounds a second each for half a second or so. */
function machineGun(seed: string): Float32Array {
  const random = rng(hash(seed) + 3), length = Math.round(RATE * .75), out = new Float32Array(length);
  for (let round = 0; round < 40; round++) {
    const at = Math.floor(random() * (length - RATE * .03));
    for (let i = 0; i < RATE * .03 && at + i < length; i++) {
      const t = i / RATE;
      out[at + i] += ((random() * 2 - 1) * Math.exp(-t / .002) + Math.sin(2 * Math.PI * 950 * t) * Math.exp(-t / .008) * .6) * .6;
    }
  }
  return out;
}

/** A falling bomb's whistle, dropping in pitch as it goes. */
function whistle(): Float32Array {
  const seconds = 2.3, length = Math.round(RATE * seconds), out = new Float32Array(length), random = rng(11);
  let phase = 0, noise = 0;
  for (let i = 0; i < length; i++) {
    const t = i / seconds / RATE, frequency = 1500 - 1050 * t ** .8 + Math.sin(i / RATE * 2 * Math.PI * 6) * 12;
    phase += 2 * Math.PI * frequency / RATE;
    noise += ((random() * 2 - 1) - noise) * .2;
    out[i] = (Math.sin(phase) * .6 + noise * .15) * Math.min(1, t * 6) * (.4 + .6 * t);
  }
  return out;
}

class Mix {
  readonly left: Float32Array; readonly right: Float32Array;
  constructor(readonly length: number) { this.left = new Float32Array(length); this.right = new Float32Array(length); }
  /** A mono sound at sample `start`, placed by the game's `spatialMix`: gain, pan and an air-absorption cutoff. */
  add(start: number, sound: Float32Array, gain: number, heard: { gain: number; pan: number; cutoff: number }, rate = 1): void {
    const g = gain * heard.gain, l = Math.cos((heard.pan + 1) * Math.PI / 4) * g, r = Math.sin((heard.pan + 1) * Math.PI / 4) * g;
    const k = Math.min(.95, 2 * Math.PI * heard.cutoff / RATE);
    let filtered = 0;
    const from = Math.round(start);
    for (let n = 0; ; n++) {
      const source = n * rate, whole = Math.floor(source);
      if (whole + 1 >= sound.length) break;
      const i = from + n;
      if (i >= this.length) break;
      const sample = sound[whole] + (sound[whole + 1] - sound[whole]) * (source - whole);
      filtered += (sample - filtered) * k;
      if (i >= 0) { this.left[i] += filtered * l; this.right[i] += filtered * r; }
    }
  }
  clip(sound: Float32Array, start: number, gain: number, rate: number, heard: { gain: number; pan: number; cutoff: number }): void { this.add(start, sound, gain, heard, rate); }
  fade(inSeconds: number, outSeconds: number): void {
    const a = Math.max(1, Math.round(inSeconds * RATE)), b = Math.max(1, Math.round(outSeconds * RATE));
    for (let i = 0; i < this.length; i++) {
      const g = Math.min(1, i / a, (this.length - 1 - i) / b);
      this.left[i] *= g; this.right[i] *= g;
    }
  }
}

/** Clips the game ships with, decoded once to 48 kHz mono. */
class Clips {
  private cache = new Map<string, Float32Array>();
  constructor(private readonly root: string) {}
  get(id: AudioCue['id']): Float32Array {
    let clip = this.cache.get(id);
    if (!clip) {
      const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', resolve(this.root, `public/audio/naval/${id}.wav`), '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
      if (decoded.status) throw new Error(`Could not decode the ${id} clip: ${decoded.stderr}`);
      clip = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.byteLength / 4).slice();
      this.cache.set(id, clip);
    }
    return clip;
  }
}

/** Level the whole track: loud moments soft-clipped rather than squashed, quiet ones left alone. */
function master(left: Float32Array, right: Float32Array): void {
  const peaks = new Float32Array(Math.ceil(left.length / 4800));
  for (let i = 0; i < left.length; i++) peaks[Math.floor(i / 4800)] = Math.max(peaks[Math.floor(i / 4800)], Math.abs(left[i]), Math.abs(right[i]));
  const sorted = [...peaks].sort((a, b) => a - b), loud = sorted[Math.floor(sorted.length * .97)] || 1, drive = .9 / loud;
  for (let i = 0; i < left.length; i++) { left[i] = Math.tanh(left[i] * drive) * .95; right[i] = Math.tanh(right[i] * drive) * .95; }
}

function writeWav(file: string, left: Float32Array, right: Float32Array): void {
  const bytes = Buffer.alloc(44 + left.length * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + left.length * 4, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(left.length * 4, 40);
  for (let i = 0; i < left.length; i++) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(file, bytes);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(text: string): number { let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return h >>> 0; }

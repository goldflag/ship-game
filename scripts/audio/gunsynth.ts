/** Procedural naval gun report: pure sample math, seeded, so a preset and seed always render the same samples.
 *
 * Layers, all built from filtered noise:
 * - crack: the muzzle snap, highpassed, one burst per barrel, with a supersonic crackle thinning out behind it;
 * - blast: expanding gas, broadband at the muzzle and darkening within tens of milliseconds;
 * - boom: heavy low noise with slow swells, plus a sub-bass drop that is part noise band, part falling sine;
 * - roar: a mid band whose lowpass closes as the report rolls away;
 * - rumble: low-mid noise rising behind the report and rolling off the sea in slow swells;
 * - tail: an eight-line feedback delay network fed by the blast and roar;
 * - reflection: one delayed copy of the crack, blast and boom off the sea surface.
 * The sum is highpassed, soft-saturated for density, normalised to a 1.0 peak and faded out.
 *
 * `assets/audio/naval/recipe.json` holds the presets; `bun run audio:synth` renders them. */

export interface GunPreset {
  duration: number;
  /** Decay time constant (s), highpass (Hz); `barrels` fire about `spread` s apart; `crackle` discharges per second
   * at the report, thinning with time constant `crackleDecay`. */
  crack: { gain: number; decay: number; highpass: number; spread: number; barrels: number; crackle: number; crackleDecay: number };
  /** Lowpass sweeps from `from` to `to` Hz with time constant `sweep`. */
  blast: { gain: number; hold: number; decay: number; from: number; to: number; sweep: number };
  /** Low noise under `lowpass` Hz with swells of depth `swell` at about `swellRate` Hz, and a sub falling from
   * `subFrom` to `subTo` Hz; `subNoise` 0 is a pure sine, 1 a noise band following the same fall. */
  boom: { gain: number; lowpass: number; hold: number; decay: number; swell: number; swellRate: number;
    sub: number; subFrom: number; subTo: number; subDecay: number; subNoise: number };
  /** Band around `center` Hz; its lowpass closes from `from` to `to` Hz with time constant `sweep`. */
  roar: { gain: number; center: number; q: number; hold: number; decay: number; from: number; to: number; sweep: number; swell: number; swellRate: number };
  /** Band around `center` Hz, rising over `attack` s behind the report, then decaying with time constant `decay`. */
  rumble: { gain: number; center: number; q: number; attack: number; decay: number; swell: number; swellRate: number };
  /** `send` feeds the network, `rt60` (s) and `damp` (Hz) shape it, `wet` mixes it back. */
  tail: { send: number; rt60: number; damp: number; wet: number };
  /** Delay (ms) and gain of the sea-surface copy. */
  reflection: { delay: number; gain: number };
  /** Output highpass (Hz), four-pole: sub-audible weight only costs headroom. */
  highpass: number;
  /** Soft-saturation drive; 0 only normalises. */
  drive: number;
}

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Topology-preserving state-variable filter (Simper); the cutoff may change every sample. */
class Svf {
  private ic1 = 0; private ic2 = 0;
  private k = 1; private a1 = 0; private a2 = 0; private a3 = 0; private f = -1; private q = -1;
  constructor(private rate: number) {}
  set(cutoff: number, q = Math.SQRT1_2): void {
    const f = Math.min(cutoff, this.rate * .45);
    if (f === this.f && q === this.q) return;
    this.f = f; this.q = q;
    const g = Math.tan(Math.PI * f / this.rate);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  /** [low, band, high]. */
  run(v0: number): [number, number, number] {
    const v3 = v0 - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    return [v2, v1, v0 - this.k * v1 - v2];
  }
}

/** Quarter-sine attack, hold at full level, then exponential decay. */
function envelope(t: number, attack: number, hold: number, decay: number): number {
  if (t < 0) return 0;
  if (t < attack) return Math.sin(t / attack * Math.PI / 2);
  const u = t - attack - hold;
  return u <= 0 ? 1 : Math.exp(-u / decay);
}

/** Eight-line feedback delay network with Householder mixing and one-pole damping in each line. */
function tailNetwork(input: Float32Array, rate: number, rt60: number, damp: number): Float32Array {
  const lengths = [1433, 1601, 1867, 2053, 2251, 2399, 2617, 2833].map(n => Math.round(n * rate / 48000));
  const lines = lengths.map(n => new Float32Array(n)), index = lengths.map(() => 0);
  const gains = lengths.map(n => Math.pow(10, -3 * n / (rate * rt60)));
  const lp = lengths.map(() => 0), coeff = Math.exp(-2 * Math.PI * damp / rate);
  const out = new Float32Array(input.length), taps = new Array<number>(8).fill(0);
  for (let i = 0; i < input.length; i++) {
    let sum = 0;
    for (let l = 0; l < 8; l++) { taps[l] = lines[l][index[l]]; sum += taps[l]; }
    const mix = sum * 2 / 8;
    let y = 0;
    for (let l = 0; l < 8; l++) {
      y += taps[l] * (l % 2 ? -1 : 1);
      lp[l] = (taps[l] - mix) * gains[l] * (1 - coeff) + lp[l] * coeff;
      lines[l][index[l]] = lp[l] + input[i];
      index[l] = (index[l] + 1) % lengths[l];
    }
    out[i] = y / 8;
  }
  return out;
}

export function renderGun(p: GunPreset, rate = 48000, seed = 1): Float32Array {
  const n = Math.round(p.duration * rate), rng = random(seed), noise = () => rng() * 2 - 1;
  const crack = new Float32Array(n), direct = new Float32Array(n), diffuse = new Float32Array(n), send = new Float32Array(n);

  const crackFilter = new Svf(rate); crackFilter.set(p.crack.highpass, .6);
  const fires = Array.from({ length: Math.max(1, p.crack.barrels) }, (_, b) => b === 0 ? 0 : p.crack.spread * (b + (rng() - .5) * .6));
  const sparkFade = Math.exp(-1 / (rate * .0015));
  let spark = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let e = 0;
    for (const at of fires) e += envelope(t - at, .0006, .002, p.crack.decay) * (at === 0 ? 1 : .7);
    if (p.crack.crackle > 0 && rng() < p.crack.crackle / rate * Math.exp(-t / p.crack.crackleDecay)) spark = Math.max(spark, .4 + rng() * .6);
    spark *= sparkFade;
    if (e < 1e-5 && spark < 1e-5 && t > .5) continue;
    crack[i] = crackFilter.run(noise() * (e + spark))[2] * p.crack.gain;
  }

  /** Slow random modulation in -1..1, lowpassed noise under `cutoff` Hz. */
  const lfo = (cutoff: number) => {
    const f = new Svf(rate), out = new Float32Array(n); f.set(cutoff, .5);
    let peak = 1e-6;
    for (let i = 0; i < n; i++) { out[i] = f.run(noise())[0]; peak = Math.max(peak, Math.abs(out[i])); }
    for (let i = 0; i < n; i++) out[i] /= peak;
    return out;
  };
  const roarSwells = lfo(p.roar.swellRate), boomSwells = lfo(p.boom.swellRate), rumbleSwells = lfo(p.rumble.swellRate);
  const blastLow = new Svf(rate), blastLow2 = new Svf(rate), subBand = new Svf(rate);
  const boomLow = new Svf(rate), boomLow2 = new Svf(rate); boomLow.set(p.boom.lowpass); boomLow2.set(p.boom.lowpass);
  const roarBand = new Svf(rate), roarLow = new Svf(rate); roarBand.set(p.roar.center, p.roar.q);
  const rumbleBand = new Svf(rate); rumbleBand.set(p.rumble.center, p.rumble.q);
  let subPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const blastCut = p.blast.to + (p.blast.from - p.blast.to) * Math.exp(-t / p.blast.sweep);
    if (i % 16 === 0) { blastLow.set(blastCut); blastLow2.set(blastCut); }
    const blast = blastLow2.run(blastLow.run(noise())[0])[0] * envelope(t, .003, p.blast.hold, p.blast.decay) * p.blast.gain;

    const subFreq = p.boom.subTo + (p.boom.subFrom - p.boom.subTo) * Math.exp(-t / .12);
    subPhase += 2 * Math.PI * subFreq / rate;
    if (i % 16 === 0) subBand.set(subFreq, 1.4);
    const sub = p.boom.subNoise > 0 ? subBand.run(noise())[1] * 3 * p.boom.subNoise + Math.sin(subPhase) * (1 - p.boom.subNoise) : Math.sin(subPhase);
    const boomLevel = envelope(t, .008, p.boom.hold, p.boom.decay) * Math.max(0, 1 + p.boom.swell * boomSwells[i]);
    const boom = boomLow2.run(boomLow.run(noise())[0])[0] * boomLevel * p.boom.gain + sub * envelope(t, .004, .02, p.boom.subDecay) * p.boom.sub;

    const roarCut = p.roar.to + (p.roar.from - p.roar.to) * Math.exp(-t / p.roar.sweep);
    if (i % 16 === 0) roarLow.set(roarCut);
    const roar = roarLow.run(roarBand.run(noise())[1])[0] * envelope(t, .012, p.roar.hold, p.roar.decay) * (1 + p.roar.swell * roarSwells[i]) * p.roar.gain;

    const { attack, decay } = p.rumble;
    const rise = t < attack ? Math.sin(t / attack * Math.PI / 2) ** 2 : Math.exp(-(t - attack) / decay);
    const rumble = rumbleBand.run(noise())[1] * rise * Math.max(0, 1 + p.rumble.swell * rumbleSwells[i]) * p.rumble.gain;

    direct[i] = blast + boom;
    diffuse[i] = roar + rumble;
    send[i] = (blast + roar) * p.tail.send;
  }

  const tail = tailNetwork(send, rate, p.tail.rt60, p.tail.damp);
  const out = new Float32Array(n), delay = Math.round(p.reflection.delay / 1000 * rate);
  // The sea reflects the report itself; the rolling roar is already diffuse.
  for (let i = 0; i < n; i++) {
    const reflected = i >= delay ? crack[i - delay] + direct[i - delay] : 0;
    out[i] = crack[i] + direct[i] + diffuse[i] + reflected * p.reflection.gain + tail[i] * p.tail.wet;
  }
  const hp = new Svf(rate), hp2 = new Svf(rate); hp.set(p.highpass); hp2.set(p.highpass);
  for (let i = 0; i < n; i++) out[i] = hp2.run(hp.run(out[i])[2])[2];
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (p.drive > 0) {
    const k = Math.tanh(p.drive);
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] / peak * p.drive) / k;
  } else for (let i = 0; i < n; i++) out[i] /= peak;
  const fade = Math.round(.05 * rate);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

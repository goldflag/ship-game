import type { BattleSession } from './session/BattleSession';
import { selectedWeapon } from '../ships/weaponGroups';

import type { Battery, Vec3 } from '../ships/blueprint';
import { CombatAudioEvents, SOUND_IDS, sanitizeAudio, spatialMix, type AudioBus, type AudioSettings, type SoundId } from './audio';
import { thunderSound } from './sky/weather/thunder';

/** `thunder` voices never count against the combat cap, and at most `MAX_THUNDER` claps wait or roll at once. */
interface Voice { source: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; bus: AudioBus; thunder?: boolean; released?: boolean; }
const MAX_THUNDER = 4;
/** Seconds of looped rumble noise, and of the crack's burst. */
const RUMBLE_NOISE = 4, CRACK_NOISE = .7;

/** Procedural thunder noise, made once per audio context: a seamlessly looping brown-noise rumble and a crackle of
 * sharp impulses over a decaying hiss for the crack. No recorded asset. */
function thunderNoise(context: AudioContext): { rumble: AudioBuffer; crack: AudioBuffer } {
  const rate = context.sampleRate, rumble = context.createBuffer(1, Math.round(rate * RUMBLE_NOISE), rate), low = rumble.getChannelData(0);
  let walk = 0, sum = 0;
  for (let i = 0; i < low.length; i++) { walk = (walk + (Math.random() * 2 - 1) * .02) / 1.02; low[i] = walk; sum += walk; }
  // Remove the drift and the seam, so the loop neither thumps nor clicks.
  const mean = sum / low.length, seam = low[low.length - 1] - low[0];
  let peak = 1e-6;
  for (let i = 0; i < low.length; i++) { low[i] -= mean + seam * (i / (low.length - 1) - .5); peak = Math.max(peak, Math.abs(low[i])); }
  for (let i = 0; i < low.length; i++) low[i] /= peak;
  const crack = context.createBuffer(1, Math.round(rate * CRACK_NOISE), rate), burst = crack.getChannelData(0);
  // A hiss that dies in a quarter second, and 4 ms discharges that thin out behind the first report.
  const fade = Math.exp(-1 / (rate * .004));
  let spark = 1;
  for (let i = 0; i < burst.length; i++) {
    const t = i / rate;
    if (Math.random() < 40 / rate * Math.exp(-t / .15)) spark = Math.max(spark, .5 + Math.random() * .5);
    spark *= fade;
    burst[i] = (Math.random() * 2 - 1) * (Math.exp(-t / .09) * .45 + spark);
  }
  return { rumble, crack };
}

/** Browser audio adapter; never writes to the CPU simulation. One owner per game session. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private buses?: Record<AudioBus, GainNode>;
  private buffers = new Map<SoundId, AudioBuffer>();
  private voices = new Set<Voice>();
  private events = new CombatAudioEvents();
  private abort = new AbortController();
  private loading?: Promise<void>;
  private disposed = false;
  private paused = false;
  private inPort = true;
  private order?: number;
  private reloading = new Map<string, boolean>();
  private listener: Vec3 = [0, 0, 0];
  private right: Vec3 = [1, 0, 0];
  private lastUi = -Infinity;
  private failed: SoundId[] = [];
  private played = 0;
  private thunders = 0;
  private noise?: ReturnType<typeof thunderNoise>;
  private settings: AudioSettings;

  constructor(settings: AudioSettings) {
    this.settings = sanitizeAudio(settings);
    const options = { signal: this.abort.signal, capture: true };
    // Creation/resume happens synchronously inside a real gesture for browser autoplay rules.
    document.addEventListener('pointerdown', this.unlock, options);
    document.addEventListener('keydown', this.unlock, options);
    document.addEventListener('click', this.click, options);
    document.addEventListener('change', this.change, options);
    document.addEventListener('visibilitychange', this.visibility, { signal: this.abort.signal });
    window.addEventListener('blur', this.blur, { signal: this.abort.signal });
    window.addEventListener('focus', this.visibility, { signal: this.abort.signal });
  }

  private unlock = (): void => {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -12; this.compressor.knee.value = 18;
        this.compressor.ratio.value = 8; this.compressor.attack.value = .003; this.compressor.release.value = .25;
        this.buses = Object.fromEntries((['effects', 'interface'] as const).map(bus => {
          const gain = this.context!.createGain(); gain.connect(this.compressor!); return [bus, gain];
        })) as Record<AudioBus, GainNode>;
        this.compressor.connect(this.master); this.master.connect(this.context.destination);
        this.applySettings(this.settings);
        this.loading = this.load();
      }
      if (!document.hidden && this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional on browsers without a usable output device. */ }
  };

  private async load(): Promise<void> {
    await Promise.all(SOUND_IDS.map(async id => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/naval/${id}.wav`, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return;
        this.buffers.set(id, buffer);
      } catch {
        if (!this.disposed) { this.failed.push(id); console.warn(`Sound unavailable: ${id}`); }
      }
    }));
  }

  private click = (event: MouseEvent): void => {
    const control = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a[href]') : null;
    if (!control || control.matches(':disabled, [aria-disabled="true"]') || control.dataset.sound === 'none') return;
    const id = control.dataset.sound;
    this.ui(id === 'back' ? 'ui-back' : id === 'confirm' || control.classList.contains('primary-button') ? 'ui-confirm' : 'ui-click');
  };
  private change = (event: Event): void => {
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement && event.target.type === 'checkbox') this.ui('ui-click');
  };
  private blur = (): void => { this.stopEffects(); void this.context?.suspend().catch(() => {}); };
  private visibility = (): void => {
    if (document.hidden) this.blur();
    else if (this.context && !this.disposed) void this.context.resume().catch(() => {});
  };

  ui(id: 'ui-click' | 'ui-confirm' | 'ui-back' = 'ui-click'): void {
    this.unlock();
    const now = performance.now();
    if (now - this.lastUi < 45) return;
    this.lastUi = now;
    if (this.buffers.has(id)) this.play(id, 'interface', .45);
    else {
      // Only the most recent first click may wait for decoding; combat is never queued.
      void this.loading?.then(() => { if (!this.disposed && this.lastUi === now && performance.now() - now < 1500) this.play(id, 'interface', .45); });
    }
  }
  preview(id: SoundId): void {
    this.unlock();
    void this.loading?.then(() => { if (!this.disposed) this.play(id, id.startsWith('ui-') ? 'interface' : 'effects', .5); });
  }
  applySettings(settings: AudioSettings): void {
    this.settings = sanitizeAudio(settings);
    if (!this.context || !this.buses || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, now, .02);
    for (const bus of ['effects', 'interface'] as const) this.buses[bus].gain.setTargetAtTime(this.settings[bus], now, .04);
    if (this.settings.muted) this.stopEffects();
  }

  setScene(inPort: boolean, paused: boolean): void {
    if (paused !== this.paused || inPort !== this.inPort) this.stopEffects();
    this.inPort = inPort; this.paused = paused;
  }
  departure(): void { this.play('ship-horn', 'effects', .4); }
  reset(simulation: BattleSession): void {
    this.stopEffects(); this.events.reset(simulation.events); this.reloading.clear(); this.order = undefined;
  }
  update(simulation: BattleSession, order: number, battery: Battery, listener: Vec3, right: Vec3, weaponGroupId?: string): void {
    this.listener = listener; this.right = right;
    const cues = this.events.consume(simulation.events, simulation.tick);
    if (!this.paused && !this.inPort) {
      for (const cue of cues) this.play(cue.id, 'effects', cue.gain, cue.position, cue.rate);
      if (this.order !== undefined && this.order !== order) this.play('telegraph', 'interface', .4);
      let ready = false;
      simulation.player.mounts.forEach(mount => {
        const definition = simulation.definition.mounts.find(m => m.id === mount.id);
        if (this.reloading.get(mount.id) && mount.reload <= 0 && mount.status === 'ready' && definition && selectedWeapon(definition.battery, definition.weapon, battery, weaponGroupId)) ready = true;
        this.reloading.set(mount.id, mount.reload > 0);
      });
      if (ready) this.play('reload', 'interface', .35);
    }
    this.order = order;
  }

  private play(id: SoundId, bus: AudioBus, level: number, position?: Vec3, rate = 1): void {
    const context = this.context, buffer = this.buffers.get(id);
    if (!context || !buffer || !this.buses || this.disposed || context.state !== 'running' || document.hidden || this.settings.muted || this.settings.master === 0 || this.settings[bus] === 0) return;
    // Bound salvos and repeat input without sacrificing menu feedback. Rolling thunder never crowds out the guns.
    // Menu repeats past the cap are dropped; in combat the oldest tail fades out so the newest report is heard.
    const busy = [...this.voices].filter(v => v.bus === bus && !v.thunder && !v.released);
    if (busy.length >= (bus === 'interface' ? 4 : 20)) {
      if (bus === 'interface') return;
      const oldest = busy[0], now = context.currentTime;
      oldest.released = true;
      oldest.gain.gain.cancelScheduledValues(now);
      oldest.gain.gain.setValueAtTime(oldest.gain.gain.value, now);
      oldest.gain.gain.linearRampToValueAtTime(0, now + .08);
      oldest.source.stop(now + .09);
    }
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.playbackRate.value = rate;
    const nodes: AudioNode[] = [source, gain];
    if (position) {
      const mix = spatialMix(position, this.listener, this.right);
      const pan = context.createStereoPanner(), filter = context.createBiquadFilter();
      pan.pan.value = mix.pan; filter.type = 'lowpass'; filter.frequency.value = mix.cutoff;
      source.connect(filter); filter.connect(pan); pan.connect(gain); nodes.push(pan, filter);
      level *= mix.gain;
    } else source.connect(gain);
    gain.gain.value = level; gain.connect(this.buses[bus]);
    const voice = { source, gain, nodes, bus }; this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); nodes.forEach(node => node.disconnect()); };
    source.start(); this.played++;
  }
  /** A thunderclap for a lightning strike, heard `delay` seconds from now: procedural noise on the effects bus, a
   * crack for a near strike and a rumble whose length and muffling grow with `distance` (`thunderSound`). Nothing
   * is scheduled while paused, muted or hidden, and pausing or leaving the scene cancels a clap still in flight,
   * as it stops every effect. */
  thunder({ distance, delay, loudness }: { distance: number; delay: number; loudness: number }): void {
    const context = this.context, buses = this.buses;
    if (!context || !buses || this.disposed || this.paused || context.state !== 'running' || document.hidden || this.settings.muted
      || this.settings.master === 0 || this.settings.effects === 0 || !(loudness > .01)) return;
    if ([...this.voices].filter(voice => voice.thunder).length >= MAX_THUNDER) return;
    const noise = this.noise ??= thunderNoise(context), sound = thunderSound(distance, loudness, Math.random);
    const start = context.currentTime + Math.max(0, delay), end = start + sound.attack + sound.rumble;
    const pan = context.createStereoPanner();
    pan.pan.value = sound.pan; pan.connect(buses.effects);
    const voice = (source: AudioBufferSourceNode, gain: GainNode, nodes: AudioNode[]) => {
      const entry: Voice = { source, gain, nodes: [source, ...nodes, gain], bus: 'effects', thunder: true };
      this.voices.add(entry);
      source.onended = () => { this.voices.delete(entry); entry.nodes.forEach(node => node.disconnect()); };
    };
    // The rumble: looped brown noise, muffled by distance, swelling through its rolls and dying away.
    const rumble = context.createBufferSource(), lowpass = context.createBiquadFilter(), rumbleGain = context.createGain();
    rumble.buffer = noise.rumble; rumble.loop = true;
    lowpass.type = 'lowpass'; lowpass.frequency.value = sound.cutoff; lowpass.Q.value = .5;
    const level = rumbleGain.gain;
    level.setValueAtTime(0, start);
    level.linearRampToValueAtTime(sound.level * (sound.rolls[0]?.level ?? 1), start + sound.attack);
    for (const roll of sound.rolls) level.linearRampToValueAtTime(sound.level * roll.level, start + sound.attack + roll.time);
    level.exponentialRampToValueAtTime(1e-4, end);
    rumble.connect(lowpass); lowpass.connect(rumbleGain); rumbleGain.connect(pan);
    // The rumble outlasts the crack, so it takes the shared panner down with it.
    voice(rumble, rumbleGain, [lowpass, pan]);
    rumble.start(start, Math.random() * RUMBLE_NOISE); rumble.stop(end + .05);
    if (sound.crack > .01) {
      // The crack: a bright burst of discharges ahead of the rumble.
      const crack = context.createBufferSource(), highpass = context.createBiquadFilter(), crackGain = context.createGain();
      crack.buffer = noise.crack;
      highpass.type = 'highpass'; highpass.frequency.value = 450;
      crackGain.gain.value = sound.crack;
      crack.connect(highpass); highpass.connect(crackGain); crackGain.connect(pan);
      voice(crack, crackGain, [highpass]);
      crack.start(start);
    }
    this.thunders++;
  }

  private stopEffects(): void {
    for (const voice of this.voices) if (voice.bus === 'effects') voice.source.stop();
  }
  diagnostics() {
    return { state: this.context?.state ?? 'locked', loaded: this.buffers.size, total: SOUND_IDS.length, failed: [...this.failed],
      voices: this.voices.size, played: this.played, thunders: this.thunders, inPort: this.inPort, paused: this.paused, settings: { ...this.settings } };
  }
  dispose(): void {
    this.disposed = true; this.abort.abort();
    for (const voice of this.voices) { voice.source.stop(); voice.nodes.forEach(node => node.disconnect()); }
    this.voices.clear(); this.buffers.clear();
    this.compressor?.disconnect(); this.master?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}

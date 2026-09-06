import type { Vec3 } from '../ships/blueprint';
import type { CombatEvent } from '../simulation/combat';

export const SOUND_IDS = ['ui-click', 'ui-confirm', 'ui-back', 'telegraph', 'ship-horn', 'main-gun-a', 'main-gun-b', 'secondary-gun', 'armor-hit', 'ricochet', 'splash', 'magazine-explosion', 'reload'] as const;
export type SoundId = typeof SOUND_IDS[number];
export type AudioBus = 'effects' | 'interface';
export interface AudioSettings { muted: boolean; master: number; effects: number; interface: number; }
export const AUDIO_STORAGE_KEY = 'sea-trials-audio-v1';
export const DEFAULT_AUDIO: AudioSettings = { muted: false, master: .65, effects: .8, interface: .65 };
export function sanitizeAudio(value: unknown): AudioSettings {
  const saved = value && typeof value === 'object' ? value as Partial<AudioSettings> : {};
  const volume = (key: Exclude<keyof AudioSettings, 'muted'>) => typeof saved[key] === 'number' && Number.isFinite(saved[key]) ? Math.max(0, Math.min(1, saved[key]!)) : DEFAULT_AUDIO[key];
  return { muted: typeof saved.muted === 'boolean' ? saved.muted : false, master: volume('master'), effects: volume('effects'), interface: volume('interface') };
}
export function loadAudioSettings(): AudioSettings {
  try { return sanitizeAudio(JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_AUDIO }; }
}
export interface AudioCue { id: SoundId; position: Vec3; gain: number; rate: number; }

/** Presentation-only cursor. Several armor layers can report the same shell impact. */
export class CombatAudioEvents {
  private sequence = 0;
  private impacts = new Set<string>();
  reset(events: readonly CombatEvent[] = []): void {
    this.sequence = events.at(-1)?.sequence ?? 0;
    this.impacts.clear();
  }
  consume(events: readonly CombatEvent[], tick: number): AudioCue[] {
    const cues: AudioCue[] = [], shots: CombatEvent[] = [];
    for (const event of events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      // Never burst old combat audio after loading, tab suspension or a slow frame.
      if (tick - event.tick > 12) continue;
      if (event.kind === 'torpedo-expired' || event.kind === 'depth-charge-hit') continue;
      if (event.kind === 'depth-charge-blast' || event.kind === 'depth-charge-splash' || event.kind === 'depth-charge-launch') {
        cues.push({ id: event.kind === 'depth-charge-blast' ? 'magazine-explosion' : event.kind === 'depth-charge-splash' ? 'splash' : 'reload', position: event.position, gain: event.kind === 'depth-charge-blast' ? .75 : .35, rate: .65 });
        if (event.kind === 'depth-charge-blast') cues.push({ id: 'splash', position: event.position, gain: .7, rate: .7 });
        continue;
      }
      if (event.kind === 'torpedo-launch' || event.kind === 'torpedo-dud' || event.kind === 'torpedo-hit') {
        cues.push({ id: event.kind === 'torpedo-hit' ? 'magazine-explosion' : 'splash', position: event.position, gain: event.kind === 'torpedo-hit' ? .85 : .35, rate: .7 });
        if (event.kind === 'torpedo-hit') cues.push({ id: 'splash', position: event.position, gain: .8, rate: .8 });
        continue;
      }
      let id: SoundId;
      if (event.kind === 'shot') {
        if (shots.some(shot => shot.tick === event.tick && shot.shipId === event.shipId && Math.hypot(...shot.position.map((n, i) => n - event.position[i])) < 12)) continue;
        shots.push(event);
        id = (event.shell?.caliberM ?? .38) < .2 ? 'secondary-gun' : (event.shell?.caliberM ?? .38) >= .42 ? 'main-gun-b' : 'main-gun-a';
      } else {
        if (event.kind === 'sunk' || ((event.kind === 'module' || event.kind === 'burst') && !event.detonation)) continue;
        const key = `${event.shell?.id ?? event.sequence}:${event.detonation ? 'detonation' : 'impact'}`;
        if (this.impacts.has(key)) continue;
        this.impacts.add(key);
        if (this.impacts.size > 512) this.impacts.delete(this.impacts.values().next().value!);
        id = event.detonation ? 'magazine-explosion' : event.kind === 'splash' ? 'splash' : event.kind === 'ricochet' ? 'ricochet' : 'armor-hit';
      }
      cues.push({ id, position: event.position, gain: event.kind === 'burst' ? .35 : id === 'magazine-explosion' ? .9 : event.kind === 'shot' ? .7 : .8,
        rate: (event.kind === 'burst' ? 1.17 : .97) + (event.sequence % 7) * .01 });
    }
    return cues;
  }
}

export function spatialMix(position: Vec3, listener: Vec3, right: Vec3) {
  const delta = position.map((n, i) => n - listener[i]);
  const distance = Math.hypot(...delta);
  return { gain: 1 / (1 + distance / 900), pan: Math.max(-.9, Math.min(.9, delta.reduce((sum, n, i) => sum + n * right[i], 0) / Math.max(1, distance))),
    cutoff: Math.max(1600, 16000 / (1 + distance / 450)) };
}

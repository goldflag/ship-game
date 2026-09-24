/** Films: a battle staged through the account-free harness and filmed shot by shot. `bun run film -- <name>` scouts the battle,
 * then replays it with the same seed and the same orders to render each shot. See docs/film.md. */
import type { PerspectiveCamera } from 'three/webgpu';
import type { Game, SubjectPose } from '../../src/game/Game';
import type { Aircraft, FleetActor } from '../../src/game/session/elements';
import type { Command } from '../../src/multiplayer/generated/Command';
import type { EventKind } from '../../src/multiplayer/generated/EventKind';
import type { AudioCue } from '../../src/game/audio';

export type V3 = [number, number, number];

export interface Film {
  /** Harness page parameters (`docs/browser-verification.md`): `battle`, `range`, `bearing`, `map`, `time`, `weather`, `wind`, `seed`. */
  battle: Record<string, string | number>;
  /** The graphics preset the battle launches with (default `ultra`); `graphics` rows the preset does not set go on top. */
  graphics?: { preset?: 'high' | 'ultra' } & Record<string, string | number>;
  /** Battle seconds the scout watches. */
  seconds: number;
  /** Staging, called at every whole battle second of the scout and of every take, so each plays out the same battle. Orders given
   * here land 12 ticks later in every run; read the battle only through `stage`. */
  orders?(stage: Stage): void;
  /** The cut, in order. Shots may overlap in battle time; the driver films them in as many replays as that takes. */
  shots: Shot[];
}

export interface Shot {
  name: string;
  /** The battle second the shot starts, or one chosen from what the scout saw. `undefined` drops the shot with a note. */
  start: number | ((scout: Scout) => number | undefined);
  /** Seconds of film. */
  seconds: number;
  /** Battle time per film time: 0.5 is half-speed slow motion. Default 1. Keep it at most 1, or a whole number of ticks per frame. */
  speed?: number;
  /** Called at the shot's first frame; returns what places the camera every frame. */
  camera(stage: Stage, scout: Scout): ShotDirector;
  /** A caption faded in over the picture, in shot seconds. */
  title?: { text: string; detail?: string; from?: number; to?: number };
  /** Fade from or to black over these many seconds. */
  fade?: { in?: number; out?: number };
}

/** Places the camera for one frame: `t` runs 0 → 1 over the shot, `seconds` is film time into it, `dt` the frame's battle seconds. */
export type ShotDirector = (camera: PerspectiveCamera, frame: { t: number; seconds: number; dt: number }) => void;

/** The battle as a film reads and stages it. */
export interface Stage {
  game: Game;
  /** The tick the frame shows, and in seconds. */
  readonly tick: number;
  readonly seconds: number;
  ships(): FleetActor[];
  aircraft(): Aircraft[];
  /** Where a ship or aircraft is drawn this frame. */
  pose(id: string): SubjectPose | undefined;
  /** The long-wave sea's height here, which a low camera must clear. */
  sea(x: number, z: number): number;
  /** Order any ship on either side as its owner would. It lands 12 ticks from now, in the scout and in every take. */
  order(shipId: string, command: Command): void;
  /** Run `action` the first time it is reached under `key`. */
  once(key: string, action: () => void): void;
}

/** What the scout saw: every event but gunfire, and once a second where everything was. */
export interface Scout {
  film: string;
  seed: number;
  /** The last tick watched. */
  ticks: number;
  events: ScoutEvent[];
  samples: ScoutSample[];
}
export interface ScoutEvent { tick: number; kind: EventKind; shipId: string; sourceId?: string; aircraftId?: string; position: V3; message: string }
export interface ScoutSample {
  tick: number;
  ships: { id: string; presetId: string; team: string; x: number; z: number; heading: number; speed: number; integrity: number; sunk: boolean }[];
  aircraft: { id: string; ownerId: string; role: string; phase: string; flightId?: string; targetId?: string; x: number; y: number; z: number }[];
}

/** What one rendered frame sounds like, which the soundtrack is laid from (`soundtrack.ts`). */
export interface FrameEvents {
  frame: number;
  tick: number;
  camera: { position: V3; forward: V3 };
  /** The game's own combat cues (`CombatAudioEvents`): gunfire, hits, splashes, crashes. */
  cues: AudioCue[];
  /** What the game leaves silent: anti-aircraft and fighter fire, bomb releases, bomb hits. */
  events: { kind: EventKind; position: V3; message: string; caliberM?: number; aircraftId?: string; target?: V3; flightTime?: number; shell: boolean }[];
  /** Aircraft within earshot of the camera. */
  aircraft: { id: string; modelId: string; position: V3; speed: number }[];
}

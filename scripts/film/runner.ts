/** The page side of the film driver (`scripts/browser/film.ts`), loaded into the harness page on the manual clock.
 *
 * Determinism: the battle has a fixed seed, the player's helm is released before the first tick (so no sight or helm input
 * reaches the simulation), and the film's orders run at every whole battle second and land 12 ticks later in the worker whatever
 * the batch sizes. Skipping steps six ticks a frame and filming one or less, but no batch ever crosses a whole second, so the
 * scout and every take see the same state when the orders run and play out the same battle. */
import type { PerspectiveCamera } from 'three/webgpu';
import type { Film, FrameEvents, Scout, ScoutEvent, ScoutSample, Shot, Stage } from './types';
import type {} from '../diagnostics/app';
import { CombatAudioEvents } from '../../src/game/audio';

declare global { interface Window { filmRunner?: FilmRunner } }

/** Aircraft engines carry this far (m); events the game does not voice itself, which a film does. */
const EARSHOT = 3000;
const AUDIBLE = new Set<FrameEvents['events'][number]['kind']>(['aircraft-fire', 'bomb-release', 'contact', 'penetration', 'burst', 'aircraft-lost']);

/** Ticks between an order and the battle acting on it: past any batch already in flight. */
const ORDER_DELAY = 12;
/** Most ticks a skipping frame covers: the worker's batch at 1×. */
const SKIP_TICKS = 6;

export interface FilmRunner {
  /** Watch the battle to `seconds` (or its end), skipping, and report what happened. */
  scout(seconds: number): Promise<Scout>;
  /** Skip to `tick` and hold the camera for `shot`, so the next `frame` shows that tick. */
  cue(shotIndex: number, tick: number): Promise<void>;
  /** Draw the cued shot's next frame and return its events. */
  frame(): Promise<FrameEvents>;
  /** Hand the camera back and remove the caption. */
  cut(): void;
}

/** Frames per second of battle time a take is drawn at: one tick a frame at full speed, so no batch crosses a whole second. */
export const FILM_FPS = 60;

export async function createRunner(filmUrl: string, filmName: string, scoutLog?: Scout): Promise<FilmRunner> {
  const fps = FILM_FPS;
  const film = (await import(/* @vite-ignore */ filmUrl)).default as Film;
  const review = window.review, game = review.game!;
  const simulation = () => game.simulation;
  const workerTick = () => simulation().workerTick ?? simulation().tick;
  const done = new Set<string>();
  const stage: Stage = {
    game,
    get tick() { return simulation().tick; },
    get seconds() { return simulation().tick / 60; },
    ships: () => simulation().actors,
    aircraft: () => simulation().aircraft,
    pose: id => game.subjectPose(id),
    sea: (x, z) => game.seaSurface(x, z),
    order: (shipId, command) => review.command(shipId, command, simulation().tick + ORDER_DELAY),
    once: (key, action) => { if (!done.has(key)) { done.add(key); action(); } },
  };

  // The helm goes before the first tick is stepped: the sight would otherwise train the player's guns with the camera.
  simulation().releaseHelm?.();
  game.setBuoysVisible(false);
  let ordered = -1, lastSequence = Math.max(0, ...simulation().events.map(event => event.sequence));
  const newEvents = () => {
    const events = simulation().events.filter(event => event.sequence > lastSequence);
    if (events.length) lastSequence = events[events.length - 1].sequence;
    return events;
  };
  let onSecond: ((tick: number) => void) | undefined;
  /** One frame covering `dt` seconds of battle; at every whole second shown, the film's orders. */
  async function step(dt: number): Promise<void> {
    await game.stepFrame(dt);
    const tick = simulation().tick;
    if (tick % 60 === 0 && tick !== ordered) { ordered = tick; film.orders?.(stage); onSecond?.(tick); }
  }
  const active = () => simulation().result === 'active';
  /** Skip until the frame shows `tick`, never letting a batch cross a whole second. */
  async function skipTo(tick: number): Promise<void> {
    if (simulation().tick > tick) throw new Error(`Film: the battle is already at tick ${simulation().tick}, past ${tick}; cue shots in battle order.`);
    while (workerTick() < tick) {
      const at = workerTick();
      await step(Math.min(SKIP_TICKS, 60 - at % 60, tick - at) / 60);
    }
    // The last batch is still pending; a frame of no time applies it.
    if (simulation().tick < tick) await step(0);
  }

  async function scout(seconds: number): Promise<Scout> {
    const events: ScoutEvent[] = [], samples: ScoutSample[] = [];
    onSecond = tick => samples.push({
      tick,
      ships: simulation().actors.map(actor => ({ id: actor.motion.id, presetId: actor.definition.id, team: actor.team, x: actor.motion.x, z: actor.motion.z,
        heading: actor.motion.heading, speed: actor.motion.speed, integrity: actor.damage.integrity / (actor.damage.maxIntegrity || 1), sunk: !!actor.damage.sunk })),
      aircraft: simulation().aircraft.filter(plane => !['ready', 'lost', 'withdrawn'].includes(plane.phase)).map(plane => ({
        id: plane.id, ownerId: plane.ownerId, role: plane.role, phase: plane.phase, flightId: plane.flightId, targetId: plane.targetId,
        x: Math.round(plane.position[0]), y: Math.round(plane.position[1]), z: Math.round(plane.position[2]) })),
    });
    const end = Math.round(seconds * 60);
    try {
      while (simulation().tick < end && active()) {
        await skipTo(Math.min(end, workerTick() + 60 - workerTick() % 60));
        for (const event of newEvents()) if (event.kind !== 'shot') events.push({ tick: event.tick, kind: event.kind, shipId: event.shipId, sourceId: event.sourceId,
          aircraftId: event.aircraft?.id, position: event.position.map(Math.round) as ScoutEvent['position'], message: event.message });
      }
    } finally { onSecond = undefined; }
    return { film: filmName, seed: Number(review.battle?.seed ?? 0), ticks: simulation().tick, events, samples };
  }

  // The game's own mapping from combat events to its sound cues.
  const audio = new CombatAudioEvents();
  let shot: Shot | undefined, frameIndex = 0, caption: HTMLElement | undefined, lens: PerspectiveCamera | undefined;
  async function cue(index: number, tick: number): Promise<void> {
    cut();
    await skipTo(tick);
    shot = film.shots[index]; frameIndex = 0;
    const current = shot, frames = Math.max(1, Math.round(current.seconds * fps));
    if (!scoutLog) throw new Error('Film: a take needs the scout log.');
    const direct = current.camera(stage, scoutLog);
    game.directCamera((camera: PerspectiveCamera, { dt }) => {
      direct(camera, { t: frameIndex / Math.max(1, frames - 1), seconds: frameIndex / fps, dt });
      lens = camera;
    });
    // A skip's last frame drew between two frames six ticks apart. Filmed frames step one tick each, so step one first: the first
    // filmed frame then shows `tick` itself, and every frame after it the next tick. The director already holds the camera, so the
    // smoke and detail that follow it settle where the shot looks.
    await step(1 / fps);
    audio.reset(simulation().events);
    newEvents();
    if (current.title) caption = showCaption(current.title.text, current.title.detail);
  }
  async function frame(): Promise<FrameEvents> {
    if (!shot) throw new Error('Film: cue a shot before drawing its frames.');
    const seconds = frameIndex / fps, title = shot.title;
    if (caption && title) caption.style.opacity = String(captionOpacity(seconds, title.from ?? .6, title.to ?? shot.seconds - .6));
    await step((shot.speed ?? 1) / fps);
    await game.gpuIdle();
    await presented();
    const events = newEvents(), forward = lens?.getWorldDirection(new review.three.Vector3()).toArray() ?? [0, 0, -1];
    const position = lens?.position.toArray() ?? [0, 0, 0];
    const record: FrameEvents = { frame: frameIndex, tick: simulation().tick, camera: { position, forward },
      cues: audio.consume(events, simulation().tick),
      events: events.filter(event => AUDIBLE.has(event.kind)).map(event => ({ kind: event.kind, position: event.position, message: event.message,
        caliberM: event.shell?.caliberM ?? event.aircraft?.caliberM, aircraftId: event.aircraft?.id, target: event.aircraft?.target,
        flightTime: event.aircraft?.airburst?.flightTime, shell: !!event.shell })),
      aircraft: simulation().aircraft.flatMap(plane => {
        const at = game.subjectPose(plane.id)?.position;
        return at && Math.hypot(at[0] - position[0], at[1] - position[1], at[2] - position[2]) < EARSHOT
          ? [{ id: plane.id, modelId: plane.modelId, position: at, speed: Math.hypot(...plane.velocity) }] : [];
      }) };
    frameIndex++;
    return record;
  }
  function cut(): void {
    game.directCamera();
    caption?.remove(); caption = undefined; shot = undefined;
  }
  return { scout, cue, frame, cut };
}

/** A frame drawn is on screen, where a capture reads it, only after the compositor's next two frames. */
const presented = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** A caption over the picture, outside the game shell the harness hides. */
function showCaption(text: string, detail?: string): HTMLElement {
  const element = document.body.appendChild(document.createElement('div'));
  element.style.cssText = 'position:fixed;left:6vw;bottom:9vh;z-index:99999;opacity:0;pointer-events:none;color:#f3efe4;'
    + 'font-family:"Barlow Condensed",sans-serif;text-shadow:0 2px 18px rgba(0,0,0,.55);letter-spacing:.06em';
  element.innerHTML = `<div style="font-size:4.2vh;font-weight:600;text-transform:uppercase">${escape(text)}</div>`
    + (detail ? `<div style="font-family:Barlow,sans-serif;font-size:2.1vh;font-weight:500;margin-top:.8vh;opacity:.86;letter-spacing:.04em">${escape(detail)}</div>` : '');
  return element;
}
const captionOpacity = (seconds: number, from: number, to: number) => Math.min(1, Math.max(0, (seconds - from) / .8), Math.max(0, (to - seconds) / .8));
const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

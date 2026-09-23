/** In-page effects stage for the account-free harness battle (`scripts/diagnostics/app.html`).
 *
 * Freezes the live battle, then replays repeatable, synthetic combat events (per-barrel shots, hull
 * hits, HE bursts, magazine detonations), seeded fire states and scripted ship motion through the
 * real `Game` renderer: ocean, sky, lighting, ships and every effect system. The same scene script
 * produces the same frames, so an effect change can be compared frame for frame against master.
 *
 * Development only. Driven by `scripts/browser/effects-review.ts`; scenes live in
 * `scripts/browser/effectsScenes.ts`. Nothing here ships in the game. */
import * as THREE from 'three/webgpu';
import type { Game } from '../../src/game/Game';
import type { CombatEvent, FleetActor } from '../../src/game/session/elements';
import { muzzleWorld, shotDirection } from '../../src/game/mountGeometry';
import { localToWorld } from '../../src/game/geometry';
import { SHIP_PACE } from '../../src/ships/mobility';
import type { EnvironmentOverrides } from '../../src/game/VisualEnvironment';

type Vec3 = [number, number, number];
const DT = 1 / 60;

/** `any` access to the Game's private presentation members, confined to this development stage. */
interface GameInternals {
  simulation: Game['simulation'];
  fleetViews: { actor: FleetActor; motion: FleetActor['motion']; root: THREE.Object3D; definition: FleetActor['definition'];
    capturePreviousPose(): void; update(alpha?: number): void; impactMarks: { update(events: readonly CombatEvent[], id: string, budget: { remainingMs: number }, pose: () => void): void; clear(): void } }[];
  effects: { update(sim: unknown, dt: number, camera: THREE.Camera, opticsShipId?: string, poses?: unknown): void; reset(): void; diagnostics(): unknown; sequence: number };
  funnelSmoke: { update(ships: unknown, dt: number, camera: THREE.Camera, hidden?: string): void; reset(): void; diagnostics(): unknown };
  rig: { update: (...args: unknown[]) => void };
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGPURenderer & { _nodes: { nodeFrame: { update(): void } } };
  paused: boolean; raf: number; frameTask?: Promise<void>;
  scheduleFrame(): void; frame(time: number): Promise<void>; renderFrame(): void;
  setDeveloperWeather(overrides: EnvironmentOverrides): void;
  environment?: { update(camera: THREE.PerspectiveCamera, dt: number): void };
  lastTime: number;
}

export interface HitOptions {
  /** `penetration` and `stopped` are solid strikes, `ricochet` a glancing one, `burst` an HE or fuzed detonation,
   * `magazine` a magazine ignition (the sim's `module` event with `detonation`). */
  kind?: 'penetration' | 'ricochet' | 'stopped' | 'burst' | 'magazine';
  caliberM?: number;
  /** Ship index the shell came from; its bearing sets the strike side and direction. Default: the player. */
  from?: number;
  /** Ship-local point on the target, metres (+X starboard, +Y up, −Z bow). Default: the hull side facing `from`. */
  at?: Vec3;
  /** Fraction along the hull from stern (0) to bow (1), used when `at` is not given. */
  along?: number;
  /** Height above the waterline for the default hull point. */
  height?: number;
  blastRadiusM?: number;
}

export interface BurnOptions {
  /** Compartment indices with an authored fire vent, `'all'`, or a count of vented compartments to light. */
  rooms?: number[] | 'all' | number;
  mounts?: number[];
  intensity?: number;
  trend?: 'growing' | 'contained' | 'cooling' | 'out';
  suppressed?: boolean;
}

export interface CameraOptions {
  /** Place the camera relative to this ship: `offset` and `look` are ship-local metres. */
  ship?: number;
  offset?: Vec3;
  look?: Vec3;
  /** World-space alternative. */
  position?: Vec3;
  target?: Vec3;
  fov?: number;
}

export interface Frame { label: string; png: string }

export function installStage(game: Game) {
  const g = game as unknown as GameInternals;
  const sim = () => g.simulation;
  const views = () => g.fleetViews;
  let frozen = false, sequence = 0, shellId = 1_000_000, elapsed = 0;
  let events: CombatEvent[] = [];
  const notes: Record<string, unknown> = {};
  let camera: CameraOptions = {};
  const motions = new Map<FleetActor, FleetActor['motion']>();
  const controls = new Map<FleetActor, string>();
  const mounts = new Map<FleetActor, string>();
  const speeds = new Map<FleetActor, number>();

  // Reads only `events`, `shells` and the other lists the effect systems consume;
  // everything else (actors, tick, interpolation) is the frozen live session.
  const stageSim = () => new Proxy(sim(), {
    get(target, key) {
      if (key === 'events') return events;
      if (key === 'shells' || key === 'torpedoes' || key === 'depthCharges' || key === 'aircraft' || key === 'airReleases') return [];
      if (key === 'interpolationAlpha') return 1;
      return Reflect.get(target, key, target);
    },
  });

  const actor = (index: number): FleetActor => {
    const found = views()[index]?.actor;
    if (!found) throw new Error(`Stage: no ship ${index}; ships are ${views().map((v, i) => `${i}=${v.definition.id}`).join(', ')}.`);
    return found;
  };
  const view = (index: number) => views()[index];
  const settleViews = () => views().forEach(v => { v.capturePreviousPose(); v.update(1); });

  function freeze(): void {
    if (frozen) return;
    frozen = true;
    // Direct flag, not setPaused: no pause menu, and incoming worker frames stop applying.
    g.paused = true;
    // A paused Game still hands the worker's latest frame to the session on its next advance,
    // which would snap staged poses, speeds and seeded fires back to the live battle.
    (g.simulation as unknown as { advance: () => void }).advance = () => {};
    g.scheduleFrame = () => {};
    cancelAnimationFrame(g.raf);
    g.rig.update = () => {};
    for (const v of views()) {
      motions.set(v.actor, { ...v.actor.motion });
      controls.set(v.actor, JSON.stringify(v.actor.damage.control));
      mounts.set(v.actor, JSON.stringify(v.actor.mounts));
    }
    const live = sim().events.reduce((max, event) => Math.max(max, event.sequence), 0);
    sequence = Math.max(live, g.effects.sequence) + 1000;
    g.effects.sequence = sequence;
  }

  /** Back to the frozen poses: no particles, fires, synthetic events or motion. */
  function reset(): void {
    freeze();
    for (const v of views()) {
      Object.assign(v.actor.motion, motions.get(v.actor));
      Object.assign(v.actor.damage.control, JSON.parse(controls.get(v.actor)!));
      JSON.parse(mounts.get(v.actor)!).forEach((m: object, i: number) => Object.assign(v.actor.mounts[i], m));
      v.impactMarks.clear();
    }
    speeds.clear(); events = []; elapsed = 0;
    g.effects.reset(); g.effects.sequence = sequence;
    g.funnelSmoke.reset();
    settleViews();
  }

  const push = (event: Omit<CombatEvent, 'sequence' | 'tick' | 'message'> & { message?: string }) => {
    events.push({ message: '', ...event, sequence: ++sequence, tick: sim().tick } as CombatEvent);
    if (events.length > 400) events.splice(0, events.length - 400);
  };

  /** Train every mount of `battery` on the target ship (no arc limits; this is a stage). */
  function aim(shipIndex = 0, targetIndex = 1, elevationDeg = 2, battery: 'main' | 'secondary' | 'all' = 'all'): void {
    freeze();
    const a = actor(shipIndex), t = actor(targetIndex).motion;
    a.definition.mounts.forEach((m, i) => {
      if (battery !== 'all' && m.battery !== battery) return;
      const local = worldToShip([t.x, 0, t.z], a.motion);
      const bearing = Math.atan2(local[0], -local[2]);
      a.mounts[i].train = bearing - THREE.MathUtils.degToRad(m.bearingDeg);
      a.mounts[i].elevation = THREE.MathUtils.degToRad(elevationDeg);
    });
    settleViews();
  }

  /** One `shot` event per barrel, exactly where and how the authority fires them. */
  function fire(shipIndex = 0, options: { battery?: 'main' | 'secondary' | 'all'; mounts?: number[] } = {}): number {
    freeze();
    const a = actor(shipIndex), battery = options.battery ?? 'main';
    let count = 0;
    a.definition.mounts.forEach((m, i) => {
      if (options.mounts ? !options.mounts.includes(i) : battery !== 'all' && m.battery !== battery) return;
      const state = a.mounts[i], direction = shotDirection(m, state, a.motion);
      for (let barrel = 0; barrel < m.weapon.barrelCount; barrel++) {
        push({ kind: 'shot', shipId: a.motion.id, position: muzzleWorld(m, state, barrel, a.motion) as Vec3,
          shell: { id: ++shellId, caliberM: m.weapon.caliberM, type: 'AP', velocity: direction.map(v => v * m.weapon.muzzleSpeed) as Vec3 } });
        count++;
      }
    });
    return count;
  }

  /** A strike on `targetIndex`'s hull, on the side facing the firing ship unless `at` is given. */
  function hit(targetIndex = 1, options: HitOptions = {}): Vec3 {
    freeze();
    const target = actor(targetIndex), from = actor(options.from ?? 0), kind = options.kind ?? 'penetration';
    const caliberM = options.caliberM ?? .38, hull = target.definition.hull;
    const toward = worldToShip([from.motion.x, 0, from.motion.z], target.motion);
    const side = toward[0] >= 0 ? 1 : -1;
    const along = options.along ?? .55, z = (0.5 - along) * hull.length;
    let local: Vec3 = options.at ?? [side * hull.beam * .5, options.height ?? 3, z];
    let normal: Vec3 = options.at ? [side, 0, 0] : [side, 0, 0];
    // Snap to the rendered hull when the model is raycastable: effects must sit on the plating.
    const root = view(targetIndex).root, origin = new THREE.Vector3(...localToWorld([side * hull.beam * 2, local[1], local[2]], target.motion));
    const end = new THREE.Vector3(...localToWorld(local, target.motion));
    root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(origin, end.clone().sub(origin).normalize(), 0, hull.beam * 3);
    const struck = ray.intersectObject(root, true).find(result => result.face);
    let position: Vec3;
    if (struck && !options.at) {
      position = struck.point.toArray() as Vec3;
      normal = struck.face!.normal.clone().transformDirection(struck.object.matrixWorld).toArray() as Vec3;
    } else position = localToWorld(local, target.motion);
    const incoming = new THREE.Vector3(...position).sub(new THREE.Vector3(from.motion.x, position[1] + 400, from.motion.z)).normalize().multiplyScalar(700);
    const shell = { id: ++shellId, caliberM, type: kind === 'burst' ? 'HE' as const : 'AP' as const, velocity: incoming.toArray() as Vec3 };
    if (kind === 'magazine') {
      const magazine = target.definition.modules.find(m => m.kind === 'magazine');
      position = localToWorld(magazine ? [magazine.center[0], magazine.center[1], magazine.center[2]] : [0, 4, -hull.length * .3], target.motion);
      push({ kind: 'module', shipId: target.motion.id, position, detonation: true });
    } else if (kind === 'burst') push({ kind: 'burst', shipId: target.motion.id, position, detonation: true, blastRadiusM: options.blastRadiusM ?? caliberM * 12, shell, normal });
    else push({ kind, shipId: target.motion.id, position, normal, shell, hullDamage: undefined });
    return position;
  }

  /** A heavy AA airburst at a ship-local point above `shipIndex` (the stage's frozen clock makes it burst at once). */
  function flak(shipIndex = 1, local: Vec3 = [0, 180, 0], caliberM = .105): Vec3 {
    freeze();
    const target = localToWorld(local, actor(shipIndex).motion);
    push({ kind: 'aircraft-fire', shipId: actor(shipIndex).motion.id, position: target,
      aircraft: { id: 'stage-flak', target, caliberM, airburst: { flightTime: 0, caliberM } } });
    return target;
  }

  /** Seed exterior fire state on a ship: vented compartments and/or mounts. */
  function burn(shipIndex = 1, options: BurnOptions = {}): { rooms: number[]; mounts: number[] } {
    freeze();
    const a = actor(shipIndex), def = a.definition, intensity = options.intensity ?? 1;
    const vented = def.compartments.map((c, i) => c.fire?.ventPosition ? i : -1).filter(i => i >= 0);
    const wanted = options.rooms;
    const rooms = wanted === 'all' ? vented : typeof wanted === 'number'
      ? vented.filter((_, i) => i % Math.max(1, Math.floor(vented.length / wanted)) === 0).slice(0, wanted)
      : wanted ?? [];
    const set = (fire: FleetActor['damage']['control']['rooms'][number]) => Object.assign(fire, {
      heat: intensity > 0 ? Math.max(1, intensity) : .4, intensity, fuel: 600, initialFuel: 600,
      trend: options.trend ?? (intensity > 0 ? 'growing' : 'cooling'), suppressed: options.suppressed ?? false });
    rooms.forEach(i => set(a.damage.control.rooms[i]));
    (options.mounts ?? []).forEach(i => set(a.damage.control.mounts[i]));
    return { rooms, mounts: options.mounts ?? [] };
  }

  /** Scripted forward speed, as a fraction of the ship's full ahead; `advance` moves the hull. */
  function underway(shipIndex = 0, fraction = 1): void {
    freeze();
    const a = actor(shipIndex);
    speeds.set(a, fraction * a.definition.handling.forwardSpeed);
    a.motion.speed = speeds.get(a)!;
  }

  function place(options: CameraOptions = camera): void {
    camera = options;
    const c = g.camera;
    if (options.fov) { c.fov = options.fov; c.updateProjectionMatrix(); }
    if (options.ship !== undefined) {
      const pose = actor(options.ship).motion;
      c.position.set(...localToWorld(options.offset ?? [260, 60, 120], pose));
      c.lookAt(...localToWorld(options.look ?? [0, 12, 0], pose));
    } else if (options.position && options.target) {
      c.position.set(...options.position); c.lookAt(...options.target);
    }
    c.updateMatrixWorld();
  }

  /** Step the effect systems (and scripted motion) at 60 Hz; the ocean and simulation stay frozen. */
  function advance(seconds: number): void {
    freeze();
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      for (const [a, speed] of speeds) {
        a.motion.speed = speed;
        a.motion.x += Math.sin(a.motion.heading) * speed * SHIP_PACE * DT;
        a.motion.z -= Math.cos(a.motion.heading) * speed * SHIP_PACE * DT;
      }
      if (speeds.size) { settleViews(); place(); }
      const staged = stageSim();
      g.effects.update(staged, DT, g.camera, undefined, views());
      g.funnelSmoke.update(views(), DT, g.camera);
      for (const v of views()) v.impactMarks.update(events, v.actor.motion.id, { remainingMs: 50 }, () => v.update(1));
      elapsed += DT;
    }
  }

  async function render(): Promise<void> {
    freeze(); settleViews(); place();
    g.renderer._nodes.nodeFrame.update();
    g.lastTime = performance.now() - 16;
    await g.frame(performance.now());
  }

  async function capture(label = `t=${elapsed.toFixed(2)}s`): Promise<Frame> {
    await render();
    return { label, png: g.renderer.domElement.toDataURL('image/png') };
  }

  /** Developer weather, applied before the next `advance`: the sky moves the sun and moon only in its
   * per-frame update, so step it once here or effects emitted meanwhile would see the old light. */
  function weather(overrides: EnvironmentOverrides): void {
    g.setDeveloperWeather(overrides);
    g.environment?.update(g.camera, 0);
  }

  /** +1 when `fromIndex` lies off `targetIndex`'s starboard side, −1 to port: the side its shells strike. */
  function facing(targetIndex = 1, fromIndex = 0): 1 | -1 {
    const from = actor(fromIndex).motion;
    return worldToShip([from.x, 0, from.z], actor(targetIndex).motion)[0] >= 0 ? 1 : -1;
  }

  /** GPU cost of the combat effects in the current staged scene: frames alternate with `game.effects.root`
   * shown and hidden, so load from other GPU work on the machine cancels out of the difference. */
  async function effectsCost(samples = 60): Promise<{ withMs: number; withoutMs: number; deltaMs: number } | null> {
    await render();
    const renderer = g.renderer as unknown as THREE.WebGPURenderer & { backend: { trackTimestamp: boolean } };
    if (!renderer.hasFeature('timestamp-query')) return null;
    const root = (g.effects as unknown as { root: THREE.Object3D }).root, tracking = renderer.backend.trackTimestamp;
    const times: [number[], number[]] = [[], []];
    renderer.backend.trackTimestamp = true;
    try {
      for (let i = -20; i < samples * 2; i++) {
        const shown = i % 2 === 0;
        root.visible = shown;
        g.renderer._nodes.nodeFrame.update();
        g.renderFrame();
        const time = await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
        if (i >= 0 && typeof time === 'number') times[shown ? 0 : 1].push(time);
      }
    } finally { root.visible = true; renderer.backend.trackTimestamp = tracking; }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const deltas = times[0].map((time, i) => time - (times[1][i] ?? time));
    return { withMs: median(times[0]), withoutMs: median(times[1]), deltaMs: median(deltas) };
  }

  /** Median GPU and CPU milliseconds of the render pipeline for the current staged scene (the ocean
   * simulation is frozen and excluded), with WebGPU timestamps when the adapter offers them. */
  async function measure(samples = 60, warmup = 30): Promise<{ gpuMs: number | null; cpuMs: number; drawCalls: number }> {
    await render();
    const renderer = g.renderer as unknown as THREE.WebGPURenderer & { backend: { trackTimestamp: boolean } };
    const timed = renderer.hasFeature('timestamp-query'), tracking = renderer.backend.trackTimestamp, autoReset = renderer.info.autoReset;
    const gpu: number[] = [], cpu: number[] = [];
    let drawCalls = 0;
    renderer.backend.trackTimestamp = timed; renderer.info.autoReset = false;
    try {
      // GPU clocks ramp after the page's first frames; discard a generous warm-up.
      for (let i = -warmup; i < samples; i++) {
        g.renderer._nodes.nodeFrame.update(); renderer.info.reset();
        const start = performance.now();
        g.renderFrame();
        const submitted = performance.now() - start;
        const time = timed ? await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER) : undefined;
        if (i < 0) continue;
        cpu.push(submitted); if (typeof time === 'number') gpu.push(time);
        drawCalls = renderer.info.render.drawCalls;
      }
    } finally { renderer.backend.trackTimestamp = tracking; renderer.info.autoReset = autoReset; }
    const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
    return { gpuMs: median(gpu), cpuMs: median(cpu)!, drawCalls };
  }

  return {
    freeze, reset, aim, fire, hit, flak, burn, underway, camera: place, advance, render, capture, weather, facing, measure, effectsCost,
    get elapsed() { return elapsed; },
    ships: () => views().map((v, i) => ({ index: i, id: v.actor.motion.id, preset: v.definition.id, team: v.actor.team,
      position: [v.actor.motion.x, v.actor.motion.z], heading: v.actor.motion.heading,
      vents: v.definition.compartments.filter(c => c.fire?.ventPosition).length, mounts: v.definition.mounts.length })),
    /** Record a measurement or finding; it lands in the scene's diagnostics.json and the CLI output. */
    note: (key: string, value: unknown) => { notes[key] = value; },
    diagnostics: () => ({ notes: { ...notes }, effects: g.effects.diagnostics(), funnelSmoke: g.funnelSmoke.diagnostics(), elapsed }),
    game,
  };
}
export type EffectsStage = ReturnType<typeof installStage>;

function worldToShip(point: Vec3, pose: { x: number; z: number; heading: number }): Vec3 {
  const dx = point[0] - pose.x, dz = point[2] - pose.z, c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  return [c * dx + s * dz, point[1], -s * dx + c * dz];
}

/** Lay captured frames out on one labelled sheet, so a whole sequence reads in a single image. */
export async function contactSheet(frames: Frame[], columns = 3, width = 640): Promise<string> {
  const images = await Promise.all(frames.map(frame => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = frame.png;
  })));
  const height = Math.round(width * images[0].height / images[0].width), rows = Math.ceil(images.length / columns);
  const canvas = document.createElement('canvas'); canvas.width = width * columns; canvas.height = height * rows;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, i) => {
    const x = (i % columns) * width, y = Math.floor(i / columns) * height;
    context.drawImage(image, x, y, width, height);
    context.font = '600 15px sans-serif'; context.fillStyle = 'rgba(0,0,0,.6)';
    const text = frames[i].label, measured = context.measureText(text).width;
    context.fillRect(x + 6, y + 6, measured + 12, 22); context.fillStyle = '#fff'; context.fillText(text, x + 12, y + 22);
  });
  return canvas.toDataURL('image/png');
}

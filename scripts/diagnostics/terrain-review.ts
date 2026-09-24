/** Terrain review: fixed views of the real game over each battle map's land, for side-by-side review and timing.
 *
 * A real battle starts on the map (`Game.prepareBattle`); this page then builds the land itself from the baked
 * heightfield, placed as a custom battle places it (offset [0, −spawnDistance / 2]), adds it to the scene and calls
 * `update` before every frame it draws. Each map gets the same presets, aimed from the field: the coast that rises
 * highest over the sea as seen from the lane's centre ("the main coast"), from sea level at 3, 8 and 20 km, through
 * 12× binoculars from the lane, from an aircraft, from the spawn's chase camera and from overhead; the steepest coast
 * (sea cliffs, or a mountain wall standing in the sea) from 2.5 km and through 4× from 900 m; and the map art's view
 * behind the player's ship.
 *
 * `scripts/browser/terrain-review.ts` drives it through the browser harness; `window.review` answers the harness's
 * readiness polling. Query: `quality` (graphics preset, default high), `range` (spawn distance, default 5000). */
import * as THREE from 'three/webgpu';
import { Game } from '../../src/game/Game';
import { GRAPHICS_PRESETS, type GraphicsPreset } from '../../src/game/graphicsSettings';
import { createBattleLandscape, type BattleLandscapeView } from '../../src/game/BattleLandscape';
import { TERRAIN_DEBUG, type TerrainDebug, type TerrainMaterial } from '../../src/game/terrain/TerrainMaterial';
import { treeAtlasCanvas } from '../../src/game/terrain/TreeAtlas';
import { loadHeightfield, type Heightfield } from '../../src/maps/heightfield';
import { OCEAN_MAPS, oceanMap, type OceanMapId } from '../../src/maps/catalog';

/** The part of the WebGPU device the timings wait on (TypeScript's DOM library does not declare WebGPU). */
interface GpuQueue { queue: { onSubmittedWorkDone(): Promise<void> } }
// Private members of Game the review drives, as the other review pages do.
interface GameInternals {
  scheduleFrame(): void; frame(now: number): Promise<void>; camera: THREE.PerspectiveCamera; scene: THREE.Scene; renderer: THREE.WebGPURenderer;
  rig: { update: (...args: unknown[]) => void; releasePointer(): void };
  ocean: { time: number }; sky: { hold(time?: number): void; resetHistory(): void };
  pipeline: { render(): void }; landscape?: { root?: THREE.Object3D };
}

const params = new URLSearchParams(location.search);
const output = document.querySelector('output')!;
const errors: string[] = [];
const review = { ready: false, inBattle: false, errors, stage: 'loading', game: undefined as unknown };
(window as unknown as { review: typeof review }).review = review;
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message ?? event.reason)));
// A background window must not pause the battle or stall its frames.
addEventListener('blur', event => event.stopImmediatePropagation(), true);
document.addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true);

const quality = (params.get('quality') ?? 'high') as GraphicsPreset;
const range = Number(params.get('range') ?? 5000);
const settings = { ...GRAPHICS_PRESETS[quality], renderScale: params.get('pixels') === 'device' ? 100 : 100 / Math.min(devicePixelRatio, 1.5) };
const noop = () => {};
const game = new Game(document.querySelector('#scene')!, settings, {
  progress: text => { output.textContent = text; review.stage = text; }, ready: noop, telemetry: noop, pause: noop, hud: noop,
  error: message => errors.push(message),
} as ConstructorParameters<typeof Game>[2]);
const internal = game as unknown as GameInternals;
review.game = game;
internal.scheduleFrame = noop;
game.setInPort(true); game.start();
await (game as unknown as { initialization: Promise<void> }).initialization;
const rigUpdate = internal.rig.update.bind(internal.rig);

export const TERRAIN_MAPS = OCEAN_MAPS.filter(map => map.land.terrain).map(map => map.id);
const SEA_TIME = 60;

let current: { map: OceanMapId; field: Heightfield; view: BattleLandscapeView; far: number } | undefined;
let debugMode: TerrainDebug = 'off';
/** Draw one of the land's debug views (`TERRAIN_DEBUG`) instead of the lit land, or 'off'. */
function debug(mode: string): void {
  if (!TERRAIN_DEBUG.includes(mode as TerrainDebug)) throw new Error(`Debug views: ${TERRAIN_DEBUG.join(', ')}.`);
  debugMode = mode as TerrainDebug;
  const material = (current?.view.root.children[0] as THREE.Mesh<THREE.BufferGeometry, TerrainMaterial> | undefined)?.material;
  if (material) material.debug.value = TERRAIN_DEBUG.indexOf(debugMode);
}
const offset = (): [number, number] => [0, -range / 2];

/** Enter (or stay in) a paused battle on `map` with this page's own land in the scene. */
async function battle(map: OceanMapId): Promise<NonNullable<typeof current>> {
  if (current?.map === map) return current;
  current?.view.dispose();
  internal.rig.update = rigUpdate;
  game.setInPort(true); game.setPaused(true);
  review.inBattle = false;
  await game.prepareBattle({ playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: range, mapId: map, weather: 'map' });
  game.setInPort(false); game.setPaused(true); internal.rig.releasePointer();
  // Once the game draws battle land itself, keep only this page's copy in view.
  internal.landscape?.root?.removeFromParent();
  const terrainId = oceanMap(map).land.terrain;
  if (!terrainId) throw new Error(`${map} has no terrain.`);
  const field = await loadHeightfield(terrainId);
  const started = performance.now();
  const view = createBattleLandscape(oceanMap(map), { field, offset: offset() }, settings.terrain);
  const built = performance.now() - started;
  internal.scene.add(view.root);
  review.inBattle = true;
  current = { map, field, view, far: internal.camera.far };
  debug(debugMode);
  console.info(`terrain: built ${map} in ${built.toFixed(0)} ms`);
  (current as { built?: number }).built = built;
  return current;
}

async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise(requestAnimationFrame);
    current?.view.update(internal.camera);
    await internal.frame(performance.now());
  }
}

function look(position: THREE.Vector3Tuple, target: THREE.Vector3Tuple, fov = 52, far?: number): void {
  internal.rig.update = noop;
  const camera = internal.camera;
  camera.position.set(...position); camera.lookAt(...target);
  camera.fov = fov; camera.far = far ?? current?.far ?? camera.far;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
const zoom = (magnification: number) => 2 * Math.atan(Math.tan(52 * Math.PI / 360) / magnification) * 180 / Math.PI;

/** The coast that stands highest over the sea seen from the lane's centre: its bearing, where the sea meets it, and how
 * high the land behind rises (as an angle from 25 m). Chart axes: x east, z toward the chart's bottom. */
function mainCoast(field: Heightfield): { direction: [number, number]; hit: number; angle: number } {
  let best = { direction: [0, -1] as [number, number], hit: 8000, angle: 0, score: -Infinity };
  for (let degrees = 0; degrees < 360; degrees += 2) {
    const a = degrees * Math.PI / 180, dx = Math.sin(a), dz = -Math.cos(a);
    let hit = 0;
    for (let d = 2000; d < 32000; d += 50) if (field.height(dx * d, dz * d) > 3) { hit = d; break; }
    if (!hit) continue;
    let angle = 0;
    for (let d = hit; d < hit + 16000; d += 100) angle = Math.max(angle, (field.height(dx * d, dz * d) - 25) / d);
    const score = angle / (1 + hit / 12000);
    if (score > best.score) best = { direction: [dx, dz], hit, angle, score };
  }
  return best;
}

/** A point `back` metres seaward of the coast along the main bearing, stepped further out until it is over water. */
function seaward(field: Heightfield, coast: ReturnType<typeof mainCoast>, back: number): [number, number] {
  const [dx, dz] = coast.direction;
  for (let d = coast.hit - back; ; d -= 100) if (field.height(dx * d, dz * d) < -2 || d < coast.hit - back - 20000) return [dx * d, dz * d];
}

type Preset = (field: Heightfield) => Promise<void> | void;
/** The art view's framing, adjustable from the page (`terrainReview.art`). */
const ART = { back: 700, eye: 70, target: 60, fov: 24 };
const world = ([x, z]: [number, number], y: number): THREE.Vector3Tuple => [x + offset()[0], y, z + offset()[1]];
const PRESETS: Record<string, Preset> = {
  /** Sea level at 3, 8 and 20 km from the main coast, facing it. */
  coast3: field => vista(field, 3000),
  coast8: field => vista(field, 8000),
  coast20: field => vista(field, 20000),
  /** 12× binoculars from the lane's centre on the main coast. */
  binoculars: field => {
    const coast = mainCoast(field), [dx, dz] = coast.direction, d = coast.hit + 400;
    look(world([0, 0], 30), world([dx * d, dz * d], Math.max(field.height(dx * d, dz * d), 0) + 25), zoom(12));
  },
  /** An aircraft 900 m up, 3 km off the coast, looking down across it. */
  aerial: field => {
    const coast = mainCoast(field), [dx, dz] = coast.direction, [x, z] = seaward(field, coast, 3000);
    look(world([x, z], 900), world([x + dx * 5500, z + dz * 5500], 0));
  },
  /** The highest steep coast (sea cliffs, or a mountain wall standing in the sea) from 2.5 km off, at sea level. */
  cliffs: field => {
    const { x, z, dx, dz, height } = steepestCoast(field);
    look(world([x + dx * 2500, z + dz * 2500], 20), world([x, z], height * .45), 40);
  },
  /** The same coast from 900 m off through 4× binoculars, low: the cliff face and its foot. */
  cliffsNear: field => {
    const { x, z, dx, dz, height } = steepestCoast(field);
    look(world([x + dx * 900, z + dz * 900], 12), world([x, z], height * .4), zoom(4));
  },
  /** Map art: behind and above the player's ship through a long lens, toward the main coast. */
  art: field => {
    if (current?.map === 'strait-of-dover') {
      // The chalk is this map: its tallest wall from 3 km off, a little above the sea, without the distant ship.
      const { x, z, dx, dz, height } = steepestCoast(field);
      look(world([x + dx * 3200, z + dz * 3200], 45), world([x, z], height * .5), 34);
      return;
    }
    const ship = (internal as unknown as { cameraShipView: { motion: { x: number; z: number } } }).cameraShipView.motion;
    // Toward the main coast.
    const [dx, dz] = mainCoast(field).direction;
    const back = ART.back, ahead = 1800;
    look([ship.x - dx * back, ART.eye, ship.z - dz * back], [ship.x + dx * ahead, ART.target, ship.z + dz * ahead], ART.fov);
  },
  /** The player's chase camera at the spawn, facing the enemy line. */
  spawn: async () => {
    internal.rig.update = rigUpdate;
    internal.camera.fov = 52; internal.camera.updateProjectionMatrix();
    await frames(30);
  },
  /** Overhead, 30 km up: the whole chart as a satellite would see it. */
  overview: () => look(world([0, 4000], 30000), world([0, 0], 0), 70, 200000),
};

/** The land sample within 400 m of the sea (and 30 km of the lane) whose height times slope is greatest, and the unit
 * direction down its slope toward the sea. */
function steepestCoast(field: Heightfield): { x: number; z: number; dx: number; dz: number; height: number } {
  let best = { x: 0, z: 0, dx: 0, dz: 1, height: 0, score: -Infinity };
  for (let z = -30000; z <= 30000; z += 80) for (let x = -30000; x <= 30000; x += 80) {
    const h = field.height(x, z);
    if (h < 20) continue;
    const gx = (field.height(x + 40, z) - field.height(x - 40, z)) / 80, gz = (field.height(x, z + 40) - field.height(x, z - 40)) / 80;
    const slope = Math.hypot(gx, gz);
    if (slope < .3) continue;
    const dx = -gx / slope, dz = -gz / slope;
    if (field.height(x + dx * 400, z + dz * 400) > 0 && field.height(x + dx * 250, z + dz * 250) > 0) continue;
    // Open water all the way out to the eyes, and land that carries on inland (not a one-sample spike in the survey).
    let open = true;
    for (let d = 500; d <= 2600 && open; d += 100) open = field.height(x + dx * d, z + dz * d) < -1;
    if (!open || field.height(x - dx * 160, z - dz * 160) < h * .5 || field.height(x - dx * 80 + dz * 80, z - dz * 80 - dx * 80) < h * .5) continue;
    const score = h * slope;
    if (score > best.score) best = { x, z, dx, dz, height: h, score };
  }
  return best;
}

function vista(field: Heightfield, back: number): void {
  const coast = mainCoast(field), [dx, dz] = coast.direction, [x, z] = seaward(field, coast, back);
  // The land's highest angle from this eye along the bearing; the view centres a little below half of it.
  let crest = 0;
  for (let d = 100; d < 40000; d += 100) crest = Math.max(crest, (field.height(x + dx * d, z + dz * d) - 25) / d);
  const pitch = Math.min(crest * .4, .1);
  look(world([x, z], 25), world([x + dx * 4000, z + dz * 4000], 25 + 4000 * pitch));
}

async function show(map: OceanMapId, preset: string): Promise<Record<string, unknown>> {
  output.textContent = `${map} · ${preset}`;
  const { field, view } = await battle(map);
  internal.ocean.time = SEA_TIME;
  internal.sky.hold(SEA_TIME);
  await PRESETS[preset](field);
  internal.sky.resetHistory();
  await frames(40);
  output.textContent = '';
  const mesh = view.root.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry> | undefined;
  return { map, preset, patches: mesh?.geometry.instanceCount ?? 0, camera: internal.camera.position.toArray().map(Math.round),
    fov: internal.camera.fov, built: (current as { built?: number }).built, errors: [...errors] };
}

async function capture(): Promise<string> {
  current?.view.update(internal.camera);
  await internal.frame(performance.now());
  await (internal.renderer.backend as unknown as { device: GpuQueue }).device.queue.onSubmittedWorkDone();
  return internal.renderer.domElement.toDataURL('image/png');
}

/** Draw the whole frame again: the scene pass renders once per node frame, which only animation frames advance. */
function redraw(): void {
  (internal.renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
  internal.pipeline.render();
}
const trimmedMean = (values: number[]) => {
  const kept = [...values].sort((a, b) => a - b).slice(Math.floor(values.length * .1), Math.ceil(values.length * .9));
  return kept.reduce((sum, v) => sum + v, 0) / kept.length;
};

/** The land's cost per frame: frames with it drawn alternating with frames without (which of a pair goes first swaps every
 * pair), each serialised by waiting for the GPU and timed by wall clock. `cpu` is the time until the frame is submitted
 * (encoding, the land's update and its patch selection), `frame` the time until the GPU finishes it. Milliseconds. */
async function bench(pairs = 150, part: 'land' | 'trees' = 'land'): Promise<Record<string, number>> {
  const view = current?.view;
  if (!view) throw new Error('Show a map first.');
  // The whole land, or only its trees (the second child) with the ground drawn in both frames of a pair.
  const toggled = part === 'trees' ? view.root.children[1] : view.root;
  if (!toggled) throw new Error('This land has no trees.');
  const device = (internal.renderer.backend as unknown as { device: GpuQueue }).device;
  const frame = async (on: boolean) => {
    toggled.visible = on;
    await device.queue.onSubmittedWorkDone();
    const start = performance.now();
    if (on) view.update(internal.camera);
    redraw();
    const submitted = performance.now();
    await device.queue.onSubmittedWorkDone();
    return [submitted - start, performance.now() - start];
  };
  try {
    for (let i = 0; i < 10; i++) await frame(i % 2 === 0);
    const cpuOn: number[] = [], cpuOff: number[] = [], on: number[] = [], off: number[] = [], differences: number[] = [], cpuDifferences: number[] = [];
    for (let i = 0; i < pairs; i++) {
      const first = i % 2 === 0, a = await frame(first), b = await frame(!first);
      const [withLand, without] = first ? [a, b] : [b, a];
      cpuOn.push(withLand[0]); cpuOff.push(without[0]); on.push(withLand[1]); off.push(without[1]);
      differences.push(withLand[1] - without[1]); cpuDifferences.push(withLand[0] - without[0]);
    }
    return { land: trimmedMean(differences), landCpu: trimmedMean(cpuDifferences), frame: trimmedMean(off), withLand: trimmedMean(on),
      cpuFrame: trimmedMean(cpuOff), cpuWithLand: trimmedMean(cpuOn) };
  } finally { toggled.visible = true; }
}

/** Build the land `times` times from the decoded field: the battle-start cost on top of the decode. Milliseconds. */
async function buildCost(map: OceanMapId, times = 3): Promise<number[]> {
  const terrainId = oceanMap(map).land.terrain!;
  const field = await loadHeightfield(terrainId), costs: number[] = [];
  for (let i = 0; i < times; i++) {
    const started = performance.now();
    createBattleLandscape(oceanMap(map), { field, offset: offset() }, settings.terrain).dispose();
    costs.push(performance.now() - started);
  }
  return costs;
}

/** The tree impostor atlas as a PNG data URL, on a mid grey so its edges show. */
async function atlas(): Promise<string> {
  const source = treeAtlasCanvas()!, canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#8a9aa0'; g.fillRect(0, 0, canvas.width, canvas.height); g.drawImage(source, 0, 0);
  return canvas.toDataURL('image/png');
}

Object.assign(window, { terrainReview: { art: ART, atlas, maps: TERRAIN_MAPS, presets: Object.keys(PRESETS), show, capture, debug, bench, buildCost, game,
  current: () => current } });
review.ready = true; review.stage = 'ready'; output.textContent = '';

/** Account-free harness: the real `<App/>` without `AccountGate`, for browser verification.
 *
 * With no account the ship library falls back to IndexedDB, which this page seeds from the saved
 * designs cached by `bun run harness:designs`, so nothing here touches the accounts service.
 * Parameters and the `window.review` handle are documented in `docs/browser-verification.md`;
 * `scripts/browser/harness.ts` drives this page from Playwright. */
import ReactDOM from 'react-dom/client';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '../../src/ui/styles.css';
import { Game, type CameraPin } from '../../src/game/Game';
import { formationSpawns, type BattleSetup, type BotSelection } from '../../src/game/session/battleSetup';
import { isShipAiLevel } from '../../src/game/session/aiLevels';
import type { GameCallbacks } from '../../src/game/types';
import { CONSTRUCTION_DATABASE, openConstructionStore } from '../../src/ships/constructionStore';
import { restoreLocalShips } from '../../src/ships/constructionLibrary';
import { localShips } from '../../src/ships/localShips';
import { shipPresets } from '../../src/ships/presets';
import { SORTIE_BOARD_STORAGE_KEY } from '../../src/ui/battle/battleModes';
import { App } from '../../src/ui/App';
import type { HarnessDesigns } from '../browser/designs';
import { cameraPin, type CameraPose } from '../browser/cameraPoses';

export interface HarnessReview {
  /** The port is loaded and every seeded design has been compiled or reported. */
  ready: boolean;
  inBattle: boolean;
  game?: Game;
  errors: string[];
  /** Seeded designs: `shipId` is the battle id once compiled, `issue` says why one is not launchable. */
  designs: { name: string; sourceId: string; shipId?: string; issue?: string }[];
  battle?: BattleSetup;
  /** What the page is doing now: seeding or compiling designs, a loading-screen stage or a battle-dialog step. */
  stage: string;
  /** The game's own `three/webgpu` and `three/tsl`; `import('three/webgpu')` from a Playwright evaluate does not resolve. */
  three: typeof THREE;
  tsl: typeof TSL;
  /** Hold the camera on a hull (`scripts/browser/cameraPoses.ts`: a preset, an eye and target, or an orbit), or give it back
   * to the player's rig with no pose. Returns the pin it holds. */
  placeCamera(pose?: CameraPose): CameraPin | undefined;
  /** Hold every presentation clock at `time` seconds of sea (default 60) after replaying `history` seconds (default 30), so two
   * runs draw the same sea and pose (`Game.freezeScene`); `false` lets them run again. Place the camera first: smoke detail follows it. */
  freezeScene(options?: { time?: number; history?: number } | false): Promise<void>;
  /** Resolve once no camera glide, zoom or orbit is easing (an optics glide takes about 0.42 s), then `frames` rendered frames later. */
  settle(options?: { frames?: number; timeoutMs?: number }): Promise<void>;
  /** Show or hide every page layer over the 3D view (instruments, port panels, labels) and the torpedo sheets drawn on the sea. */
  setHud(visible: boolean): void;
}
declare global { interface Window { review: HarnessReview } }

const params = new URLSearchParams(location.search);
const review: HarnessReview = window.review = { ready: false, inBattle: false, errors: [], designs: [], stage: 'loading', three: THREE, tsl: TSL,
  placeCamera, freezeScene, settle, setHud };
window.addEventListener('error', event => review.errors.push(event.message));
window.addEventListener('unhandledrejection', event => review.errors.push(String(event.reason?.message ?? event.reason)));

// A headed test window loses focus to whatever else is running; the game pauses on blur and nothing resumes it.
if (params.get('focus') !== 'real') {
  addEventListener('blur', event => event.stopImmediatePropagation(), true);
  document.addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true);
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
}
// Automation cannot grant pointer lock, so battle input that waits for it never arms.
if (params.get('pointerlock') !== 'real') {
  let locked: Element | null = null;
  const change = (element: Element | null) => { locked = element; document.dispatchEvent(new Event('pointerlockchange')); };
  Object.defineProperty(document, 'pointerLockElement', { get: () => locked, configurable: true });
  Element.prototype.requestPointerLock = function () { change(this); return Promise.resolve(); };
  document.exitPointerLock = () => change(null);
}
if (params.get('sortie') !== 'board') try { localStorage.setItem(SORTIE_BOARD_STORAGE_KEY, 'skip'); } catch { /* private window */ }

/** `designs=all` (default), `none`, `keep` (leave the local library alone) or a comma list of names/ids. */
async function seedDesigns() {
  const wanted = params.get('designs') ?? 'all';
  review.stage = 'seeding saved designs';
  if (wanted === 'keep') return;
  const cache = await fetch('/__harness/designs.json').then(response => response.json() as Promise<HarnessDesigns>).catch(() => undefined);
  const picks = wanted.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
  const chosen = (cache?.designs ?? []).filter(({ head }) => wanted === 'all' || picks.some(pick => head.name.toLowerCase().includes(pick) || (head.sourceId ?? head.id) === pick));
  const store = await openConstructionStore({ name: CONSTRUCTION_DATABASE });
  try {
    const present = new Map((await store.list()).map(head => [head.id, head]));
    // The seeded library mirrors the chosen set; designs made in the harness survive under `designs=keep`.
    if (cache?.fetchedAt || wanted === 'none') for (const head of present.values()) if (!chosen.some(({ revision }) => (revision.sourceId ?? revision.designId) === head.id)) await store.remove(head.id, head.revisionId);
    for (const { head, revision } of chosen) {
      const id = revision.sourceId ?? head.sourceId ?? head.id, current = present.get(id);
      review.designs.push({ name: head.name, sourceId: id });
      if (current && (await store.load(id)).revision.sourceJson === revision.sourceJson) continue;
      await store.save({ designId: id, name: head.name, source: JSON.parse(revision.sourceJson), schemaVersion: revision.schemaVersion, catalogRevision: revision.catalogRevision, expectedRevisionId: current?.revisionId ?? null });
    }
  } finally { store.close(); }
}

/** A preset id, a local ship id, or a saved design's name; `:easy|normal|hard` sets a bot's AI. */
function ship(token: string): BotSelection {
  const [name, level] = token.trim().split(':');
  const key = name.toLowerCase();
  const local = localShips().find(entry => entry.definition.id === name || entry.source.id === name || entry.source.name.toLowerCase() === key)
    ?? localShips().find(entry => entry.source.name.toLowerCase().includes(key));
  const shipId = Object.hasOwn(shipPresets, key) ? key : local?.definition.id;
  if (!shipId) throw new Error(`Harness: no preset or compiled design matches "${name}".`);
  return level && isShipAiLevel(level) ? { shipId, aiLevel: level } : shipId;
}
const shipId = (selection: BotSelection) => typeof selection === 'string' ? selection : selection.shipId;

/** `battle=player;friend,friend;enemy,enemy` plus `range` (m), `bearing` (deg), `map`, `time`, `weather`, `hours`, `cloud`, `wind`, `formation`, `seed`. */
function battleSetup(): BattleSetup {
  const [player = '', friends = '', enemies = ''] = (params.get('battle') ?? '').split(';');
  const list = (value: string) => value.split(',').filter(token => token.trim()).map(ship);
  const number = (key: string) => params.has(key) ? Number(params.get(key)) : undefined;
  const friendlyBots = list(friends), foes = list(enemies), range = number('range') ?? 5000, bearing = (number('bearing') ?? 0) * Math.PI / 180;
  // The default line puts the enemy dead ahead, outside most torpedo and broadside arcs; `bearing` (degrees
  // clockwise from the player's bow) swings the enemy line around the player instead.
  const spawns = formationSpawns(friendlyBots.length + 1, foes.length, range, (params.get('formation') ?? undefined) as BattleSetup['formation']);
  if (bearing) spawns.enemy = spawns.enemy.map(({ x, z, heading }) => ({ x: x * Math.cos(bearing) - z * Math.sin(bearing), z: z * Math.cos(bearing) + x * Math.sin(bearing), heading: heading + bearing }));
  return { playerShipId: shipId(ship(player)), friendlyBots, enemies: foes, spawnDistance: range, ...(bearing ? { spawns } : {}),
    mapId: (params.get('map') ?? 'north-atlantic') as BattleSetup['mapId'], timeOfDay: (params.get('time') ?? undefined) as BattleSetup['timeOfDay'],
    weather: (params.get('weather') ?? undefined) as BattleSetup['weather'], formation: (params.get('formation') ?? undefined) as BattleSetup['formation'],
    timeHours: number('hours'), cloudCover: number('cloud'), windSpeed: number('wind'), seed: number('seed') };
}

function game(): Game {
  if (!review.game) throw new Error('Harness: the game has not started yet.');
  return review.game;
}

function placeCamera(pose?: CameraPose): CameraPin | undefined {
  if (!pose) { game().placeCamera(); return undefined; }
  const simulation = game().simulation, ship = typeof pose === 'object' ? pose.ship : undefined;
  const actor = ship ? simulation.actors.find(entry => entry.motion.id === ship) : simulation.player;
  if (!actor) throw new Error(`Harness: no ship "${ship}"; ships are ${simulation.actors.map(entry => entry.motion.id).join(', ')}.`);
  const pin = cameraPin(pose, actor.definition.hull.length);
  game().placeCamera(pin);
  return pin;
}

async function freezeScene(options: { time?: number; history?: number } | false = {}): Promise<void> {
  if (options === false) return game().freezeScene();
  await game().freezeScene(options.time ?? 60, options.history ?? 30);
}

async function settle({ frames = 4, timeoutMs = 10_000 }: { frames?: number; timeoutMs?: number } = {}): Promise<void> {
  for (const deadline = performance.now() + timeoutMs; !game().cameraSettled;) {
    if (performance.now() > deadline) throw new Error(`Harness: the camera was still moving after ${timeoutMs / 1000} s.`);
    await game().nextFrame();
  }
  for (let i = 0; i < frames; i++) await game().nextFrame();
}

// The torpedo sheets and aim lines are drawn in the scene and follow the instrument switch App writes on the viewport,
// so while the HUD is hidden that attribute is held at false; App's own value comes back with the HUD.
let hudStyle: HTMLStyleElement | undefined, hudHold: MutationObserver | undefined, appShipLabels: string | undefined;
function setHud(visible: boolean): void {
  const viewport = document.querySelector<HTMLElement>('.ocean-viewport');
  if (visible) {
    hudStyle?.remove(); hudHold?.disconnect(); hudStyle = hudHold = undefined;
    if (viewport && appShipLabels !== undefined) viewport.dataset.shipLabels = appShipLabels;
    return;
  }
  if (hudStyle) return;
  hudStyle = document.head.appendChild(document.createElement('style'));
  hudStyle.textContent = '.game-shell > :not(.ocean-viewport), .ocean-viewport > :not(canvas) { visibility: hidden !important; }';
  if (!viewport) return;
  const hold = () => { if (viewport.dataset.shipLabels !== 'false') { appShipLabels = viewport.dataset.shipLabels; viewport.dataset.shipLabels = 'false'; } };
  hold();
  hudHold = new MutationObserver(hold); hudHold.observe(viewport, { attributes: true, attributeFilter: ['data-ship-labels'] });
}

/** `battery=main|secondary|torpedo|…`: the weapon group a battle opens on (destroyers otherwise open on torpedoes). */
function selectBattery(): void {
  const battery = params.get('battery');
  if (!battery) return;
  const group = game().weaponGroups.find(entry => entry.battery === battery);
  if (!group) throw new Error(`Harness: ${game().definition.name} has no ${battery} battery; it has ${game().weaponGroups.map(entry => entry.battery).join(', ')}.`);
  game().selectWeaponGroup(group.id);
}

let loaded = false, berthing = 0;
const start = Game.prototype.start, prepare = Game.prototype.prepareBattle, begin = Game.prototype.beginBattle, setPort = Game.prototype.setInPort, swap = Game.prototype.switchShip;
Game.prototype.start = function (this: Game) {
  review.game = this;
  const callbacks = (this as unknown as { callbacks: Pick<GameCallbacks, 'ready' | 'error' | 'progress'> }).callbacks, { ready, error, progress } = callbacks;
  callbacks.ready = () => { ready(); loaded = true; };
  // Also on the console, where the Playwright driver reports it if a launch stage runs out of time.
  callbacks.error = message => { review.errors.push(message); console.error(`Harness: game error: ${message}`); error(message); };
  callbacks.progress = (label, fraction) => { review.stage = `${label} (${Math.round(fraction * 100)}%)`; progress(label, fraction); };
  return start.call(this);
};
// The dialog is driven for real so the battle UI mounts exactly as it does for a player; only the roster is replaced.
Game.prototype.prepareBattle = function (this: Game, setup, progress, trial) {
  const replaced = params.has('battle') && !trial ? battleSetup() : setup;
  review.battle = replaced;
  return prepare.call(this, replaced, tracked(progress), trial);
};
Game.prototype.beginBattle = async function (this: Game, progress) {
  await begin.call(this, tracked(progress));
  if (params.has('battle')) try { selectBattery(); } catch (error) { review.errors.push((error as Error).message); }
  if (params.get('hud') === 'off') setHud(false);
  review.stage = 'in battle'; review.inBattle = true;
};
function tracked(progress?: (label: string, fraction: number) => void) {
  return progress && ((label: string, fraction: number) => { review.stage = `${label} (${Math.round(fraction * 100)}%)`; progress(label, fraction); });
}
Game.prototype.switchShip = async function (this: Game, definition) { berthing++; try { await swap.call(this, definition); } finally { berthing--; } };
Game.prototype.setInPort = function (this: Game, port: boolean) { setPort.call(this, port); if (port) review.inBattle = false; };

const wait = async (predicate: () => unknown, label: string, timeout = 180_000) => {
  review.stage = `waiting for ${label}`;
  for (const deadline = performance.now() + timeout; !predicate();) {
    if (performance.now() > deadline) throw new Error(`Harness: timed out waiting for ${label}.`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
const button = (text: string) => [...document.querySelectorAll('button')].find(element => element.textContent?.toLowerCase().includes(text) && !element.disabled);

async function run() {
  await seedDesigns();
  review.stage = 'compiling saved designs';
  // Compile the library here rather than waiting on the garage's own restore (a no-op once these are registered),
  // so a design that cannot launch reports its real reason instead of stalling readiness.
  const issues = await restoreLocalShips();
  for (const design of review.designs) {
    const compiled = localShips().find(entry => entry.source.id === design.sourceId);
    if (compiled) design.shipId = compiled.definition.id;
    else design.issue = issues.find(issue => issue.startsWith(`${design.name}: `))?.slice(design.name.length + 2) ?? 'Not launchable.';
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
  await wait(() => loaded, 'the port');
  // The garage berths its first design only after the port loads: until then a capture shows an empty quay or the wrong hull,
  // and a battle dialog driven meanwhile finds the port busy. Settled means no swap for half a second.
  let still = 0;
  const berthed = () => !berthing && !document.querySelector('.garage-spinner') && (!review.designs.some(design => design.shipId) || !!document.querySelector('section.port-identity'));
  await wait(() => berthed() ? performance.now() - (still ||= performance.now()) > 500 : still = 0, 'the berthed ship');
  review.stage = 'in port'; review.ready = true;
  if (!params.has('battle')) { if (params.get('hud') === 'off') setHud(false); return; }
  battleSetup(); // Fail on an unknown ship before any clicking.
  await wait(() => button('battle'), 'the BATTLE button'); button('battle')!.click();
  await wait(() => button('custom battle') || document.querySelector('button.ship-card-pick'), 'the battle dialog'); button('custom battle')?.click();
  await wait(() => document.querySelector('button.ship-card-pick'), 'ship cards'); document.querySelector<HTMLButtonElement>('button.ship-card-pick')!.click();
  await wait(() => document.querySelector('section.fleet-lane.enemy.is-accepting'), 'the enemy lane'); document.querySelector<HTMLElement>('section.fleet-lane.enemy')!.click();
  await wait(() => button('deploy fleet'), 'Deploy fleet'); button('deploy fleet')!.click();
  await wait(() => button('start battle'), 'Start battle'); button('start battle')!.click();
  await wait(() => review.inBattle, 'the battle to begin');
}
run().catch(error => { review.errors.push(String(error?.message ?? error)); console.error(error); });

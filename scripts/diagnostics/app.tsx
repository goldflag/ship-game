/** Account-free harness: the real `<App/>` without `AccountGate`, for browser verification.
 *
 * With no account the ship library falls back to IndexedDB, which this page seeds from the saved
 * designs cached by `bun run harness:designs`, so nothing here touches the accounts service.
 * Parameters and the `window.review` handle are documented in `docs/browser-verification.md`;
 * `scripts/browser/harness.ts` drives this page from Playwright. */
import ReactDOM from 'react-dom/client';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '../../src/ui/styles.css';
import { Game } from '../../src/game/Game';
import { formationSpawns, type BattleSetup, type BotSelection } from '../../src/game/session/battleSetup';
import { isShipAiLevel } from '../../src/game/session/aiLevels';
import { CONSTRUCTION_DATABASE, openConstructionStore } from '../../src/ships/constructionStore';
import { restoreLocalShips } from '../../src/ships/constructionLibrary';
import { localShips } from '../../src/ships/localShips';
import { shipPresets } from '../../src/ships/presets';
import { SORTIE_BOARD_STORAGE_KEY } from '../../src/ui/battle/battleModes';
import { App } from '../../src/ui/App';
import type { HarnessDesigns } from '../browser/designs';

export interface HarnessReview {
  /** The port is loaded and every seeded design has been compiled or reported. */
  ready: boolean;
  inBattle: boolean;
  game?: Game;
  errors: string[];
  /** Seeded designs: `shipId` is the battle id once compiled, `issue` says why one is not launchable. */
  designs: { name: string; sourceId: string; shipId?: string; issue?: string }[];
  battle?: BattleSetup;
}
declare global { interface Window { review: HarnessReview } }

const params = new URLSearchParams(location.search);
const review: HarnessReview = window.review = { ready: false, inBattle: false, errors: [], designs: [] };
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

/** `battle=player;friend,friend;enemy,enemy` plus `range` (m), `bearing` (deg), `map`, `time`, `weather`, `hours`, `cloud`, `wind`, `formation`. */
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
    timeHours: number('hours'), cloudCover: number('cloud'), windSpeed: number('wind') };
}

let loaded = false;
const start = Game.prototype.start, prepare = Game.prototype.prepareBattle, begin = Game.prototype.beginBattle, setPort = Game.prototype.setInPort;
Game.prototype.start = function (this: Game) {
  review.game = this;
  const callbacks = (this as unknown as { callbacks: { ready(): void; error(message: string): void } }).callbacks, { ready, error } = callbacks;
  callbacks.ready = () => { ready(); loaded = true; };
  callbacks.error = message => { review.errors.push(message); error(message); };
  return start.call(this);
};
// The dialog is driven for real so the battle UI mounts exactly as it does for a player; only the roster is replaced.
Game.prototype.prepareBattle = function (this: Game, setup, progress, trial) {
  const replaced = params.has('battle') && !trial ? battleSetup() : setup;
  review.battle = replaced;
  return prepare.call(this, replaced, progress, trial);
};
Game.prototype.beginBattle = async function (this: Game, progress) { await begin.call(this, progress); review.inBattle = true; };
Game.prototype.setInPort = function (this: Game, port: boolean) { setPort.call(this, port); if (port) review.inBattle = false; };

const wait = async (predicate: () => unknown, label: string, timeout = 180_000) => {
  for (const deadline = performance.now() + timeout; !predicate();) {
    if (performance.now() > deadline) throw new Error(`Harness: timed out waiting for ${label}.`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
const button = (text: string) => [...document.querySelectorAll('button')].find(element => element.textContent?.toLowerCase().includes(text) && !element.disabled);

async function run() {
  await seedDesigns();
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
  review.ready = true;
  if (!params.has('battle')) return;
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

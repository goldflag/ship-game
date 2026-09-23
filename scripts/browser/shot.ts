/** `bun run ui:shot -- --help` lists every flag. One command, one image: the real App in a headed Chromium, no account,
 * saved designs seeded. Arguments are read before `multiplayer:prepare:dev` runs, so a typo or `--help` costs nothing. */
import { parseArgs } from 'node:util';
import { designsCacheStatus, STALE_DESIGNS_HOURS } from './designs';
import { CAMERA_PRESETS, parseCameraPose, parseVec3, type CameraPose } from './cameraPoses';
import { berth, designCheck, designs, freezeScene, openEditor, placeCamera, ROOT, setHud, settle, settleCamera, shot, withHarness } from './harness';

const USAGE = `bun run ui:shot -- [flags]

  --state port|editor|battle   what to capture (default port)
  --design <name>              berth this saved design in port, or open it in the editor
  --battle "<player>;<friends>;<enemies>"  battle roster (default fletcher;;bismarck); ships are preset ids or design names, :easy etc. set a bot's AI
  --range <m>                  spawn distance (default 5000)
  --param key=value            any harness page parameter, e.g. bearing=90, wind=15, time=dusk (repeatable)
  --out <file.png>             default .build/shots/<state>.png
  --viewport WxH               default 1728x1030
  --wait <s>                   real time before the capture (default 2)
  --list                       print the saved designs and their battle ids (or why one cannot launch)
  --settle                     editor: wait for the design check, then print its status, findings and ledger

  --camera <preset|az,el[,m]>  hold the camera on the hull: ${Object.keys(CAMERA_PRESETS).join(', ')}, or azimuth (degrees
                               clockwise from the bow), elevation (degrees) and distance (m) about her centre
  --eye x,y,z --target x,y,z   hold the camera at a ship-local eye (m; +X starboard, +Y up, -Z bow) looking at target
  --fov <deg>  --ship <id>     lens for the held camera; the ship it is held on (default the player's)
  --freeze <s>                 hold the berth, sea, clouds, smoke and battle at this sea time, after replaying
  --history <s>                this many seconds of sea first (default 30), so two runs render the same frame
  --hud on|off                 off hides instruments, port panels and labels (and the torpedo sheets) for the capture
  --battery <name>             the weapon group a battle opens on, e.g. main (destroyers otherwise open on torpedoes)

  --eval "<js>"                run in the page before the capture (review.game is the live Game)
  --url http://127.0.0.1:5200  reuse a running dev server
  --deadline <s>               kill the browser and exit 1 past this (default 900)
  --allow-gpu-errors           report WebGPU validation errors without failing
  --no-prepare                 skip multiplayer:prepare:dev (content and dev WASM already built)
  --help`;

let values;
try {
  ({ values } = parseArgs({ options: {
    state: { type: 'string', default: 'port' }, design: { type: 'string' }, battle: { type: 'string' }, range: { type: 'string' },
    out: { type: 'string' }, viewport: { type: 'string', default: '1728x1030' }, wait: { type: 'string', default: '2' },
    param: { type: 'string', multiple: true, default: [] }, url: { type: 'string' }, eval: { type: 'string' }, list: { type: 'boolean', default: false },
    settle: { type: 'boolean', default: false }, camera: { type: 'string' }, eye: { type: 'string' }, target: { type: 'string' }, fov: { type: 'string' },
    ship: { type: 'string' }, freeze: { type: 'string' }, history: { type: 'string', default: '30' }, hud: { type: 'string', default: 'on' },
    battery: { type: 'string' }, deadline: { type: 'string', default: '900' }, 'allow-gpu-errors': { type: 'boolean', default: false },
    'no-prepare': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
  } }));
} catch (error) { console.error(`${(error as Error).message}\n\n${USAGE}`); process.exit(2); }
if (values.help) { console.log(USAGE); process.exit(0); }

const fail = (message: string): never => { console.error(message); process.exit(2); };
const number = (flag: string, text: string) => Number.isFinite(Number(text)) ? Number(text) : fail(`--${flag} takes a number; got "${text}".`);
if (!['port', 'editor', 'battle'].includes(values.state!)) fail(`--state is port, editor or battle; got "${values.state}".`);
if (values.settle && values.state !== 'editor') fail('--settle waits for the ship editor’s design check; use it with --state editor.');
if (values.state === 'editor' && !values.design && !values.list) fail('--state editor needs --design <name>; run with --list to see the saved designs.');
if (!['on', 'off'].includes(values.hud!)) fail(`--hud is on or off; got "${values.hud}".`);
const [width, height] = values.viewport!.split('x').map(Number);
if (!(width > 0 && height > 0)) fail(`--viewport takes WxH; got "${values.viewport}".`);
const wait = number('wait', values.wait!), freeze = values.freeze === undefined ? undefined : number('freeze', values.freeze), history = number('history', values.history!);
let pose: CameraPose | undefined;
try {
  const common = { ...(values.target ? { target: parseVec3(values.target, '--target') } : {}), ...(values.fov ? { fov: number('fov', values.fov) } : {}), ...(values.ship ? { ship: values.ship } : {}) };
  if (values.eye) pose = { eye: parseVec3(values.eye, '--eye'), ...common };
  else if (values.camera) { const parsed = parseCameraPose(values.camera); pose = typeof parsed === 'string' ? { preset: parsed, ...common } : { ...parsed, ...common }; }
  else if (values.target || values.fov || values.ship) fail('--target, --fov and --ship shape a held camera; add --camera or --eye.');
} catch (error) { fail((error as Error).message); }
if (values.state === 'editor' && (pose || freeze !== undefined || values.hud === 'off')) fail('--camera, --eye, --freeze and --hud apply to the game view (port or battle), not the editor.');

const params: Record<string, string> = Object.fromEntries(values.param!.map(entry => entry.split(/=(.*)/s).slice(0, 2) as [string, string]));
// A fixed seed: the same combat sea every run (`--param seed=…` picks another).
if (values.state === 'battle') { params.battle = values.battle ?? 'fletcher;;bismarck'; params.seed ??= '1941'; }
if (values.range) params.range = values.range;
if (values.battery) params.battery = values.battery;

// A design reviewed from a stale cache is an old revision: say which one this is.
const cache = designsCacheStatus(ROOT), wanted = values.design?.toLowerCase();
const cached = wanted ? cache?.designs.find(design => design.name.toLowerCase() === wanted) ?? cache?.designs.find(design => design.name.toLowerCase().includes(wanted)) : undefined;
if (cached) console.error(`${cached.name}: revision ${cached.revisionId.slice(0, 8)} saved ${new Date(cached.savedAt).toLocaleString()}, cached ${cache!.ageHours.toFixed(1)} h ago${
  cache!.ageHours > STALE_DESIGNS_HOURS ? ` (older than ${STALE_DESIGNS_HOURS} h: \`bun run harness:designs\` fetches the latest)` : ''}`);

if (!values['no-prepare']) {
  const prepared = Bun.spawnSync(['bun', 'run', 'multiplayer:prepare:dev'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  if (prepared.exitCode) { console.error(`multiplayer:prepare:dev failed:\n${prepared.stdout}${prepared.stderr}`); process.exit(prepared.exitCode ?? 1); }
}

await withHarness({ params, viewport: { width, height }, url: values.url, deadline: number('deadline', values.deadline!), allowGpuErrors: values['allow-gpu-errors'] }, async ({ page }) => {
  if (values.list) { for (const design of await designs(page)) console.log(`${design.name}\t${design.shipId ?? design.issue}`); return; }
  if (values.state === 'editor') await openEditor(page, values.design!);
  else if (values.state === 'port' && values.design) await berth(page, values.design);
  // Runs in the page with `review.game` in reach, for poses a flag cannot express.
  if (values.eval) console.log(JSON.stringify(await page.evaluate(values.eval)));
  // The image is worth little while the design check is still running: the ledger then shows the
  // previous revision's readings and the chip says "Checking design…".
  if (values.settle) console.log(JSON.stringify(await designCheck(page), null, 1));
  if (pose) console.error(`camera pin: ${JSON.stringify(await placeCamera(page, pose))}`);
  if (freeze !== undefined) {
    const started = performance.now();
    await freezeScene(page, { time: freeze, history });
    console.error(`scene held at ${freeze} s of sea after a ${history} s replay (${((performance.now() - started) / 1000).toFixed(1)} s)`);
  }
  if (values.hud === 'off') await setHud(page, false);
  if (values.state !== 'editor') await settleCamera(page);
  await settle(page, wait);
  console.log(await shot(page, values.out ?? `.build/shots/${values.state}.png`));
});

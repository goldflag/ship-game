/** `bun run ship:sweep <id>`: acceptance check 4, turret and barrel clearance through articulation.
 *
 * Blender poses every mount through its installed traverse, elevation and recoil against the fixed
 * ship and the other mounts at rest, then poses neighbouring mounts independently against each other
 * (scripts/ships/articulation_sweep.py). Each contact is then replayed through the simulation's own
 * installation resolver (the WASM `preview_articulation_json`): a contact the interlocks stop before
 * it is reached is covered; one the mount can reach is a failure. Evidence, not a certificate: the
 * sweep is sampled, and a blocked firing path is not a clearance pass. */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBlender } from '../build/blender';

const root = join(import.meta.dir, '../..');
const argv = process.argv.slice(2);
const usage = `bun run ship:sweep <id> [--glb] [--mounts id,prefix*,...] [--step 5] [--elevation-step 15] [--neighbour-step 15]
                        [--no-neighbours] [--ignore substring,...] [--no-interlock] [--report-only]

  --glb             sweep the published public/models/<id>.glb instead of the retained generated/source.blend
                    (construction ships have no retained scene and always use the GLB)
  --mounts          only these mount IDs; a trailing * matches a prefix (main-*)
  --step            traverse spacing in degrees (default 5); elevation every --elevation-step (default 15)
  --neighbour-step  traverse spacing for mount-against-mount poses (default 15); --no-neighbours skips them
  --ignore          skip meshes whose names contain these substrings (rigging wires, for example)
  --no-interlock    report every contact without asking the simulation's interlocks
  --report-only     exit 0 even when a reachable contact is found

Writes .build/ships/<id>/sweep.json (raw contacts) and sweep-report.json (classified).`;
const id = argv.find(a => !a.startsWith('--') && !isValue(a));
function isValue(a: string) { const i = argv.indexOf(a); return i > 0 && ['--mounts', '--step', '--elevation-step', '--neighbour-step', '--ignore'].includes(argv[i - 1]); }
if (!id || argv.includes('--help')) { console.log(usage); process.exit(id ? 0 : 1); }
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const definitionPath = join(root, 'public/models', `${id}.json`);
if (!existsSync(definitionPath)) throw new Error(`No published definition at ${definitionPath}; build the ship first.`);
const source = join(root, 'assets/ships', id, 'generated/source.blend');
const model = flag('--glb') || !existsSync(source) ? join(root, 'public/models', `${id}.glb`) : source;
const stage = join(root, '.build/ships', id);
await mkdir(stage, { recursive: true });
const out = join(stage, 'sweep.json');
const passthrough = ['--mounts', '--step', '--elevation-step', '--neighbour-step', '--ignore'].flatMap(k => (value(k) ? [k, value(k)!] : []));
console.log(`Sweeping ${id} from ${model.slice(root.length + 1)} …`);
const started = performance.now();
await runBlender(join(root, 'scripts/ships/articulation_sweep.py'), {}, {
  cwd: root, log: join(stage, 'sweep.log'),
  args: ['--model', model, '--definition', definitionPath, '--out', out, ...passthrough, ...(flag('--no-neighbours') ? ['--no-neighbours'] : [])],
});
type Pose = { train: number; elevation: number; recoil: number };
type Sweep = {
  mounts: { id: string; samples: number; clashes: { moving: string; fixed: string; fixedAssembly?: string; poses: [number, number, number][] }[] }[];
  neighbours: { a: string; b: string; poses: number[][] }[];
};
const sweep = JSON.parse(await readFile(out, 'utf8')) as Sweep;
const definition = JSON.parse(await readFile(definitionPath, 'utf8')) as { mounts: { id: string; initialElevationDeg?: number }[] };
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const index = new Map(definition.mounts.map((m, i) => [m.id, i]));
const rest: Pose[] = definition.mounts.map(m => ({ train: 0, elevation: rad(m.initialElevationDeg ?? 1), recoil: 0 }));

let resolve: ((current: Pose[], requested: Pose[]) => { pose: Pose; blocked: boolean; obstructionId: string | null }[]) | undefined;
if (!flag('--no-interlock')) {
  const wasm = await import('../../src/generated/naval-wasm/naval_wasm');
  await wasm.default({ module_or_path: await Bun.file(join(root, 'src/generated/naval-wasm/naval_wasm_bg.wasm')).arrayBuffer() });
  const text = JSON.stringify(definition);
  resolve = (current, requested) => JSON.parse(wasm.preview_articulation_json(text, JSON.stringify(current), JSON.stringify(requested)));
}
const close = (a: Pose, b: Pose) => Math.abs(a.train - b.train) < rad(.25) && Math.abs(a.elevation - b.elevation) < rad(.25) && Math.abs(a.recoil - b.recoil) < .02;
/** Move mount `i` along `path` from its pose in `current`; the pose where it ends and whether it got there. */
function travel(i: number, path: Pose[], current: Pose[]): { pose: Pose; reached: boolean } {
  const poses = structuredClone(current);
  for (const step of path) {
    const requested = structuredClone(poses);
    requested[i] = step;
    poses[i] = resolve!(poses, requested)[i].pose;
    if (!close(poses[i], step)) return { pose: poses[i], reached: false };
  }
  return { pose: poses[i], reached: true };
}
const intervals = new Map<string, { lo: number; hi: number } | null>();
const reached = new Map<string, boolean>();
/** Can mount `i` reach `target` from `current` (every other mount at rest unless given)? The simulation's
 * interlocks stop a mount at the first contact along its move, so a pose is reachable when the mount can
 * elevate at its neutral train and then train to it, or train at its current elevation and then elevate. */
function reachable(i: number, target: Pose, current: Pose[] = rest): { reached: boolean; stop?: Pose } {
  if (!resolve) return { reached: true };
  const others = current === rest ? 'rest' : JSON.stringify(current);
  const key = `${i}|${target.train.toFixed(5)}|${target.elevation.toFixed(5)}|${target.recoil}|${others}`;
  const band = `${i}|${target.elevation.toFixed(5)}|${target.recoil}|${others}`;
  if (!intervals.has(band)) {
    const raised = travel(i, [{ train: current[i].train, elevation: target.elevation, recoil: target.recoil }], current);
    if (!raised.reached) intervals.set(band, null);
    else {
      const at = structuredClone(current);
      at[i] = raised.pose;
      const far = rad(400);
      const hi = travel(i, [{ ...raised.pose, train: far }], at).pose.train;
      const lo = travel(i, [{ ...raised.pose, train: -far }], at).pose.train;
      intervals.set(band, { lo, hi });
    }
  }
  const interval = intervals.get(band);
  if (interval && target.train >= interval.lo - rad(.25) && target.train <= interval.hi + rad(.25)) return { reached: true };
  if (!reached.has(key)) {
    const trainFirst = travel(i, [{ ...current[i], train: target.train }, target], current);
    reached.set(key, trainFirst.reached);
    if (!trainFirst.reached && interval) stops.set(key, { ...target, train: target.train > 0 ? interval.hi : interval.lo });
  }
  return { reached: reached.get(key)!, stop: stops.get(key) };
}
const stops = new Map<string, Pose>();
const pose = (t: number, e: number, r: number): Pose => ({ train: rad(t), elevation: rad(e), recoil: r });
const span = (values: number[]) => (Math.min(...values) === Math.max(...values) ? `${Math.min(...values)}` : `${Math.min(...values)}…${Math.max(...values)}`);

type Row = { mount: string; against: string; kind: 'fixed' | 'mount'; poses: number; reachable: number; train: string; elevation: string; stopsAt?: string; example?: number[] };
const rows: Row[] = [];
for (const mount of sweep.mounts) {
  const i = index.get(mount.id)!;
  const byFixed = new Map<string, [number, number, number][]>();
  for (const clash of mount.clashes) {
    const key = clash.fixedAssembly && clash.fixedAssembly !== clash.fixed ? `${clash.fixed} (${clash.fixedAssembly})` : clash.fixed;
    const list = byFixed.get(key) ?? [];
    for (const p of clash.poses) if (!list.some(q => q[0] === p[0] && q[1] === p[1] && q[2] === p[2])) list.push(p);
    byFixed.set(key, list);
  }
  for (const [against, poses] of byFixed) {
    let reach = 0, example: number[] | undefined, stopsAt: string | undefined;
    for (const [t, e, r] of poses) {
      const result = reachable(i, pose(t, e, r));
      if (result.reached) { reach++; example ??= [t, e, r]; }
      else if (result.stop && !stopsAt) stopsAt = `train ${deg(result.stop.train).toFixed(1)}°, elevation ${deg(result.stop.elevation).toFixed(1)}°`;
    }
    rows.push({ mount: mount.id, against, kind: 'fixed', poses: poses.length, reachable: reach, train: span(poses.map(p => p[0])), elevation: span(poses.map(p => p[1])), stopsAt, example });
  }
}
for (const pair of sweep.neighbours) {
  const a = index.get(pair.a)!, b = index.get(pair.b)!;
  let reach = 0, example: number[] | undefined;
  for (const [ta, ea, ra, tb, eb, rb] of pair.poses) {
    // Either mount may be the one that moves into the other, which is already where it can reach.
    const pa = pose(ta, ea, ra), pb = pose(tb, eb, rb);
    const withB = structuredClone(rest); withB[b] = pb;
    const withA = structuredClone(rest); withA[a] = pa;
    const bThere = reachable(b, pb).reached, aThere = reachable(a, pa).reached;
    if ((bThere && reachable(a, pa, withB).reached) || (aThere && reachable(b, pb, withA).reached)) { reach++; example ??= [ta, ea, ra, tb, eb, rb]; }
  }
  rows.push({ mount: pair.a, against: pair.b, kind: 'mount', poses: pair.poses.length, reachable: reach,
    train: span(pair.poses.map(p => p[0])), elevation: span(pair.poses.map(p => p[1])), example });
}

const failing = rows.filter(r => r.reachable > 0);
console.log(`\n${sweep.mounts.length} mounts, ${sweep.mounts.reduce((n, m) => n + m.samples, 0)} poses, ${sweep.neighbours.length} neighbouring pairs in contact; ${((performance.now() - started) / 1000).toFixed(0)} s`);
for (const r of rows.sort((x, y) => Number(y.reachable > 0) - Number(x.reachable > 0) || x.mount.localeCompare(y.mount))) {
  const status = !resolve ? 'CONTACT  ' : r.reachable ? 'REACHABLE' : 'stopped  ';
  const where = r.kind === 'mount' ? `against ${r.against} (posed independently)` : `touches ${r.against}`;
  // Only reachable rows carry an example pose.
  const example = () => r.kind === 'mount'
    ? `${r.mount} ${r.example!.slice(0, 3).join('/')} with ${r.against} ${r.example!.slice(3).join('/')}`
    : `train ${r.example![0]}°, elevation ${r.example![1]}°, recoil ${r.example![2]}`;
  const detail = r.reachable
    ? `${r.reachable}/${r.poses} contact poses reachable, e.g. ${example()}`
    : `interlock stops first${r.stopsAt ? ` (at ${r.stopsAt})` : ''}`;
  console.log(`${status} ${r.mount} ${where}; train ${r.train}°, elevation ${r.elevation}°; ${detail}`);
}
if (!rows.length) console.log('No contacts: every swept mount clears the ship and its neighbours.');
await Bun.write(join(stage, 'sweep-report.json'), JSON.stringify({ model, interlock: !!resolve, rows }, null, 1));
console.log(`\n${failing.length ? `${failing.length} reachable contact group(s)` : 'No reachable contacts'}; details in .build/ships/${id}/sweep-report.json`);
if (failing.length && !flag('--report-only')) process.exit(1);

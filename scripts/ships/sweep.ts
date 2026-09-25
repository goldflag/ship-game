/** `bun run ship:sweep <id>`: acceptance check 4, turret and barrel clearance through articulation.
 *
 * Blender poses every mount through its installed traverse, elevation and recoil against the fixed ship and the
 * other mounts at rest, then poses neighbouring mounts independently against each other
 * (scripts/ships/articulation_sweep.py). Each contact is then replayed through the simulation's own installation
 * resolver (the WASM `ArticulationPreview`, one per worker, sweepWorker.ts): a contact the interlocks stop before
 * it is reached is covered; one the mount can reach is a failure unless assets/ships/<id>/sweep-accepted.json
 * accepts it. A rotating base touching the structure it stands on is a seat contact, counted apart and not
 * replayed. Evidence, not a certificate: the sweep is sampled, and a blocked firing path is not a clearance pass. */
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { runBlender } from '../build/blender';
import { ACCEPTED_FILE, applyAccepted, groupContacts, parseAccepted, selectMounts, splitPatterns, type AcceptedContact, type ContactKey, type Sweep } from './sweepContacts';
import { createReplay, type ReplayCache, type ReplayResult, type ReplayUnit } from './sweepInterlock';
import type { WorkerRequest } from './sweepWorker';

const root = join(import.meta.dir, '../..');
const argv = process.argv.slice(2);
const valued = ['--mounts', '--step', '--elevation-step', '--neighbour-step', '--ignore', '--jobs'];
const usage = `bun run ship:sweep <id> [--glb] [--mounts glob,...] [--step 5] [--elevation-step 15] [--neighbour-step 15]
                        [--no-neighbours] [--ignore substring,...] [--no-interlock] [--jobs N] [--reuse] [--report-only]

  --glb             sweep the published public/models/<id>.glb instead of the retained generated/source.blend
                    (construction ships have no retained scene and always use the GLB)
  --mounts          only mounts whose IDs match these globs (* ? [ab] {a,b}), e.g. main-* or 'casemate-[ps]1';
                    a pattern that matches no mount is an error that lists the IDs
  --step            traverse spacing in degrees (default 5); elevation every --elevation-step (default 15)
  --neighbour-step  traverse spacing for mount-against-mount poses (default 15); --no-neighbours skips them
  --ignore          skip meshes whose names contain these substrings (rigging wires, for example)
  --no-interlock    report every contact without asking the simulation's interlocks
  --jobs            interlock replay workers (default: every core)
  --reuse           skip Blender and replay the last sweep.json when the model, definition and options are unchanged
                    (after editing ${ACCEPTED_FILE}, for example)
  --report-only     exit 0 even when a reachable contact is found

Reachable contacts listed in assets/ships/<id>/${ACCEPTED_FILE} ({ "accepted": [{ "mount", "against", "reason" }] },
globs; "against" is the touched part's assembly ID or mesh name, or the other mount) are reported as accepted and
do not fail; an entry that accepts nothing is reported as stale. A rotating base touching the structure it stands
on is a seat contact, counted apart from clashes.

Writes .build/ships/<id>/sweep.json (raw contacts) and sweep-report.json (classified).`;
const id = argv.find(a => !a.startsWith('--') && !isValue(a));
function isValue(a: string) { const i = argv.indexOf(a); return i > 0 && valued.includes(argv[i - 1]); }
if (!id || argv.includes('--help')) { console.log(usage); process.exit(id ? 0 : 1); }
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const definitionPath = join(root, 'public/models', `${id}.json`);
if (!existsSync(definitionPath)) throw new Error(`No published definition at ${definitionPath}; build the ship first.`);
const definition = JSON.parse(await readFile(definitionPath, 'utf8')) as { mounts: { id: string; parentMountId?: string; initialElevationDeg?: number }[] };
const sweepable = definition.mounts.filter(m => !m.parentMountId).map(m => m.id);
let mounts: string[] | undefined;
if (value('--mounts') !== undefined) {
  const patterns = splitPatterns(value('--mounts')!);
  const { selected, unmatched } = selectMounts(sweepable, patterns);
  if (!patterns.length || unmatched.length) {
    console.error(`--mounts ${unmatched.length ? `${unmatched.map(p => `'${p}'`).join(', ')} matched no mount` : 'is empty'}. ${id} mounts:\n  ${sweepable.join(' ')}`);
    process.exit(1);
  }
  mounts = selected;
}
const acceptedPath = join(root, 'assets/ships', id, ACCEPTED_FILE);
const acceptedEntries: AcceptedContact[] = existsSync(acceptedPath) ? parseAccepted(await readFile(acceptedPath, 'utf8'), `assets/ships/${id}/${ACCEPTED_FILE}`) : [];

const source = join(root, 'assets/ships', id, 'generated/source.blend');
const model = flag('--glb') || !existsSync(source) ? join(root, 'public/models', `${id}.glb`) : source;
const stage = join(root, '.build/ships', id);
await mkdir(stage, { recursive: true });
const out = join(stage, 'sweep.json');
const passthrough = ['--step', '--elevation-step', '--neighbour-step', '--ignore'].flatMap(k => (value(k) ? [k, value(k)!] : []));
const blenderArgs = ['--model', model, '--definition', definitionPath, '--out', out, ...passthrough, ...(mounts ? ['--mounts', mounts.join(',')] : []),
  ...(flag('--no-neighbours') ? ['--no-neighbours'] : [])];
// What the Blender pass read; --reuse keeps its sweep.json only while all of it is unchanged.
const { size, mtimeMs } = statSync(model);
const stamp = JSON.stringify({ blenderArgs, size, mtimeMs, definition: statSync(definitionPath).mtimeMs, sweeper: statSync(join(root, 'scripts/ships/articulation_sweep.py')).mtimeMs });
const stampPath = join(stage, 'sweep-stamp.json');
const reuse = flag('--reuse') && existsSync(out) && existsSync(stampPath) && (await readFile(stampPath, 'utf8')) === stamp;
if (flag('--reuse') && !reuse) console.log('--reuse: the last sweep.json was made from another model, definition or options; sweeping again.');
console.log(`${reuse ? 'Replaying the last sweep of' : 'Sweeping'} ${id} from ${model.slice(root.length + 1)}${mounts ? ` (${mounts.length} of ${sweepable.length} mounts)` : ''} …`);
const started = performance.now();
if (!reuse) {
  await rm(stampPath, { force: true });
  await runBlender(join(root, 'scripts/ships/articulation_sweep.py'), {}, { cwd: root, log: join(stage, 'sweep.log'), args: blenderArgs });
  await Bun.write(stampPath, stamp);
}
const blenderSeconds = (performance.now() - started) / 1000;
const sweep = JSON.parse(await readFile(out, 'utf8')) as Sweep;

// Group the contacts: one replay unit per mount and touched part, one per neighbouring pair; seats apart.
type Row = { mount: string; against: string; kind: 'fixed' | 'mount'; poses: number; reachable: number; train: string; elevation: string;
  stopsAt?: string; example?: number[]; accepted?: string; key: ContactKey };
type Seat = { mount: string; against: string; poses: number };
const span = (values: number[]) => (Math.min(...values) === Math.max(...values) ? `${Math.min(...values)}` : `${Math.min(...values)}…${Math.max(...values)}`);
const units: ReplayUnit[] = [], rows: Omit<Row, 'reachable'>[] = [], seats: Seat[] = [];
for (const mount of sweep.mounts) {
  const groups = groupContacts(mount);
  for (const g of groups.seats) seats.push({ mount: mount.id, against: g.against, poses: g.poses.length });
  for (const g of groups.clashes) {
    units.push({ kind: 'fixed', mount: mount.id, poses: g.poses });
    rows.push({ mount: mount.id, against: g.against, kind: 'fixed', poses: g.poses.length, train: span(g.poses.map(p => p[0])), elevation: span(g.poses.map(p => p[1])),
      key: { mount: mount.id, against: [g.assembly, g.fixed].filter((s): s is string => !!s), kind: 'fixed' } });
  }
}
for (const pair of sweep.neighbours) {
  units.push({ kind: 'mount', a: pair.a, b: pair.b, poses: pair.poses });
  rows.push({ mount: pair.a, against: pair.b, kind: 'mount', poses: pair.poses.length, train: span(pair.poses.map(p => p[0])), elevation: span(pair.poses.map(p => p[1])),
    key: { mount: pair.a, against: [pair.b], kind: 'mount' } });
}

// Replay on a pool of workers in rounds: each round answers, one query per task, the distinct cache entries the
// replay still lacks (sweepInterlock.ts), then seeds every worker with them; the replay itself then runs here from
// the caches alone. Answers are pure, so the report is the same for any number of workers.
const interlock = !flag('--no-interlock');
const replayStarted = performance.now();
const main = createReplay(definition, interlock ? () => { throw new Error('the interlock replay asked the main thread to resolve a move'); } : undefined);
let jobs = 0, rounds = 0, queries = 0;
if (interlock && units.length) {
  jobs = Number(value('--jobs') ?? availableParallelism());
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs takes a positive whole number, not ${value('--jobs')}`);
  const workers = await Promise.all(Array.from({ length: jobs }, () => new Promise<Worker>((ready, fail) => {
    const worker = new Worker(new URL('./sweepWorker.ts', import.meta.url));
    worker.onmessage = () => ready(worker);
    worker.onerror = event => fail(new Error(`interlock replay worker: ${event.message}`));
    worker.postMessage({ type: 'init', definitionPath } satisfies WorkerRequest);
  })));
  for (let pending = main.pending(units); pending.length; pending = main.pending(units)) {
    if (++rounds > 12) throw new Error('the interlock replay did not converge');
    queries += pending.length;
    const round: ReplayCache = { intervals: [], reached: [], stops: [] };
    let next = 0;
    // Hand each query to the next idle worker; replies arrive in any order and only fill caches.
    await Promise.all(workers.map(worker => new Promise<void>((done, fail) => {
      const send = () => (next < pending.length ? worker.postMessage({ type: 'answer', id: next, queries: [pending[next++]] } satisfies WorkerRequest) : done());
      worker.onmessage = (event: MessageEvent<{ cache: ReplayCache }>) => {
        const { cache } = event.data;
        round.intervals.push(...cache.intervals); round.reached.push(...cache.reached); round.stops.push(...cache.stops);
        send();
      };
      worker.onerror = event => fail(new Error(`interlock replay worker: ${event.message}`));
      send();
    })));
    main.seed(round);
    console.log(`Interlock round ${rounds}: ${pending.length} queries answered; ${((performance.now() - replayStarted) / 1000).toFixed(0)} s`);
    for (const worker of workers) worker.postMessage({ type: 'seed', cache: round } satisfies WorkerRequest);
  }
  for (const worker of workers) worker.terminate();
}
const results: ReplayResult[] = units.map(unit => main.replayCached(unit));
const replaySeconds = (performance.now() - replayStarted) / 1000;

const all: Row[] = rows.map((row, i) => ({ ...row, ...results[i] }));
const failing = all.filter(r => r.reachable > 0);
const { accepted, stale } = applyAccepted(acceptedEntries, failing.map(r => r.key), sweep.mounts.map(m => m.id));
failing.forEach((row, i) => { if (accepted[i]) row.accepted = accepted[i]!.reason; });
const clashes = failing.filter(r => !r.accepted);

const line = (r: Row) => {
  const status = !interlock ? 'CONTACT  ' : r.accepted ? 'accepted ' : r.reachable ? 'REACHABLE' : 'stopped  ';
  const where = r.kind === 'mount' ? `against ${r.against} (posed independently)` : `touches ${r.against}`;
  // Only reachable rows carry an example pose.
  const example = () => r.kind === 'mount'
    ? `${r.mount} ${r.example!.slice(0, 3).join('/')} with ${r.against} ${r.example!.slice(3).join('/')}`
    : `train ${r.example![0]}°, elevation ${r.example![1]}°, recoil ${r.example![2]}`;
  const detail = r.reachable
    ? `${r.reachable}/${r.poses} contact poses reachable, e.g. ${example()}${r.accepted ? `; accepted: ${r.accepted}` : ''}`
    : `interlock stops first${r.stopsAt ? ` (at ${r.stopsAt})` : ''}`;
  return `${status} ${r.mount} ${where}; train ${r.train}°, elevation ${r.elevation}°; ${detail}`;
};
const byMount = (x: Row, y: Row) => x.mount.localeCompare(y.mount);
const stopped = all.filter(r => !r.reachable);
const posesSwept = sweep.mounts.reduce((n, m) => n + m.samples, 0);
console.log(`\n${sweep.mounts.length} mounts, ${posesSwept} poses, ${sweep.neighbours.length} neighbouring pairs in contact; `
  + `${(blenderSeconds + replaySeconds).toFixed(0)} s (Blender ${blenderSeconds.toFixed(0)} s, interlock replay ${replaySeconds.toFixed(1)} s${jobs ? `: ${queries} queries in ${rounds} rounds on ${jobs} workers` : ''})`);
const section = (title: string, list: Row[]) => {
  if (!list.length) return;
  console.log(`\n${title}`);
  for (const r of list.sort(byMount)) console.log(line(r));
};
section(interlock ? 'Reachable clashes:' : 'Contacts:', clashes);
section(`Accepted in assets/ships/${id}/${ACCEPTED_FILE}:`, failing.filter(r => r.accepted));
section('Covered (the interlocks stop the mount first):', stopped);
if (stale.length) {
  console.log(`\nStale entries in assets/ships/${id}/${ACCEPTED_FILE} (no longer reached; remove them):`);
  for (const e of stale) console.log(`stale     ${e.mount} against ${e.against}; ${e.reason}`);
}
if (seats.length) {
  const seatPoses = seats.reduce((n, s) => n + s.poses, 0);
  console.log(`\nSeated: ${seatPoses} contact poses where ${new Set(seats.map(s => s.mount)).size} mounts' rotating bases touch what they stand on `
    + `(${seats.length} parts); not replayed, listed under "seats" in sweep-report.json`);
}
if (!all.length && !seats.length) console.log('No contacts: every swept mount clears the ship and its neighbours.');
await Bun.write(join(stage, 'sweep-report.json'), JSON.stringify({
  model, interlock,
  // Reachable rows first, then by mount, the order the report had before accepted lists and seats.
  rows: [...all].sort((x, y) => Number(y.reachable > 0) - Number(x.reachable > 0) || byMount(x, y)).map(({ key: _, ...r }) => r), seats,
  stale: stale.map(e => ({ mount: e.mount, against: e.against, reason: e.reason })),
}, null, 1));
console.log(`\n${clashes.length ? `${clashes.length} reachable contact group(s)` : 'No reachable contacts'}`
  + `${failing.length - clashes.length ? `, ${failing.length - clashes.length} accepted` : ''}${stale.length ? `, ${stale.length} stale accepted` : ''}`
  + `${seats.length ? `, ${seats.reduce((n, s) => n + s.poses, 0)} seat contact poses` : ''}; details in .build/ships/${id}/sweep-report.json`);
if (clashes.length && !flag('--report-only')) process.exit(1);

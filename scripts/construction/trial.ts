/**
 * `bun run ship:trial <id> [--vs [ref]] [--published] [--json]`: the native maneuvering trial
 * (crates/naval-sim/examples/maneuvering_trial.rs) as a readable table, for every preset, legacy or
 * construction. `--vs` runs the same trial on the definition published at a git ref and flags a
 * handling change beyond the handling gate. The trial reads only the ship definition: the hydrostatic
 * table serves flotation and sea motion, not the planar surge/sway/yaw solver it measures.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ShipDefinition } from '../../src/ships/blueprint';
import { effectiveHandling } from '../../src/ships/mobility';

/** The handling gate for a hull, draft or screw change: top speed and turning (hard-turn speed as a
 * share of top speed, turn rate, time to turn 90°) stay within 10% of the baseline. It exists to catch
 * regressions. A gain that follows from a corrected hull is kept and explained, never tuned away
 * through `handling.maxYawRate`, which also sets the port's turning display. */
export const HANDLING_GATE = 0.1;

export interface TrialRun {
  scenario: 'ahead' | 'half' | 'turn' | 'coast' | 'crash-stop';
  speed: number;
  yawRate: number;
  secondsToHalfSpeed: number | null;
  secondsTo90PercentSpeed: number | null;
  secondsTo90DegreeTurn: number | null;
  secondsToStop: number | null;
}
/** One line of the example's output. */
export interface TrialReport {
  ship: string;
  estimatedSpeed: number;
  powerKw: number;
  wettedAreaM2: number;
  fullness: number;
  trials: TrialRun[];
}
export interface Metric {
  id: string;
  label: string;
  unit: string;
  value: number | null;
  digits: number;
  /** The direction that is an improvement. */
  better: 'higher' | 'lower';
  /** Part of the handling gate. The other rows are context. */
  gated: boolean;
}

const KNOT = 1852 / 3600;
const DEG = 180 / Math.PI;

/** Table rows from one trial report and the definition it ran. */
export function trialMetrics(report: TrialReport, definition: Pick<ShipDefinition, 'hull' | 'handling' | 'maneuvering'>): Metric[] {
  const run = (scenario: TrialRun['scenario']) => {
    const found = report.trials.find((t) => t.scenario === scenario);
    if (!found) throw new Error(`The maneuvering trial did not report its ${scenario} run.`);
    return found;
  };
  const ahead = run('ahead'),
    half = run('half'),
    turn = run('turn'),
    stop = run('crash-stop');
  const top = ahead.speed;
  const handling = effectiveHandling(definition.handling, !!definition.maneuvering);
  const portCircle = handling.forwardSpeed > 0 && handling.maxYawRate > 0 ? (2 * handling.forwardSpeed) / handling.maxYawRate : null;
  const row = (id: string, label: string, unit: string, value: number | null, digits: number, better: Metric['better'], gated = false): Metric => ({
    id,
    label,
    unit,
    value: value !== null && Number.isFinite(value) ? value : null,
    digits,
    better,
    gated,
  });
  return [
    row('topSpeed', 'Top speed (full ahead, 180 s)', 'kn', top / KNOT, 1, 'higher', true),
    row('toCruise', 'Time to 90% of top speed', 's', ahead.secondsTo90PercentSpeed, 1, 'lower'),
    row('halfSpeed', 'Half-ahead speed', 'kn', half.speed / KNOT, 1, 'higher'),
    row('turnSpeed', 'Hard-turn speed', 'kn', turn.speed / KNOT, 1, 'higher'),
    row('turnShare', 'Hard-turn speed, share of top', '%', top > 0 ? (100 * turn.speed) / top : null, 0, 'higher', true),
    row('yawRate', 'Hard-turn rate', '°/s', Math.abs(turn.yawRate) * DEG, 2, 'higher', true),
    row('turn90', 'Time to turn 90° (world pace)', 's', turn.secondsTo90DegreeTurn, 1, 'lower', true),
    row('circle', 'Turning circle (steady, 2v/ω)', 'm', turn.yawRate ? (2 * turn.speed) / Math.abs(turn.yawRate) : null, 0, 'lower'),
    row('crashStop', 'Crash stop from top speed', 's', stop.secondsToStop, 1, 'lower'),
    row('astern', 'Astern speed (180 s)', 'kn', Math.max(0, -stop.speed) / KNOT, 1, 'higher'),
    row('portCircle', 'Port turning circle (handling.maxYawRate)', 'm', portCircle, 0, 'lower'),
    row('displacement', 'Displacement (hull.massKg)', 't', definition.hull.massKg / 1000, 0, 'lower'),
    row('draft', 'Draft (hull.draft)', 'm', definition.hull.draft, 2, 'lower'),
    row('power', 'Model power (legacy ships: inferred)', 'MW', report.powerKw / 1000, 1, 'higher'),
    row('wetted', 'Wetted area', 'm²', report.wettedAreaM2, 0, 'lower'),
    row('fullness', 'Block fullness', '', report.fullness, 3, 'lower'),
  ];
}

export type Verdict = 'same' | 'within' | 'worse' | 'better' | 'changed';
export interface ComparedRow {
  metric: Metric;
  base: number | null;
  change: number | null;
  verdict: Verdict;
}

/** Each current row against the baseline. A gated row beyond the gate is `worse` or `better`;
 * any other difference is `within` (gated) or `changed` (context). */
export function compareMetrics(base: Metric[], current: Metric[], gate = HANDLING_GATE): ComparedRow[] {
  return current.map((metric) => {
    const before = base.find((m) => m.id === metric.id)?.value ?? null;
    const after = metric.value;
    const change = before !== null && after !== null && before !== 0 ? (after - before) / Math.abs(before) : null;
    let verdict: Verdict;
    if (before === after || (change !== null && Math.abs(change) < 5e-4)) verdict = 'same';
    else if (!metric.gated) verdict = 'changed';
    else if (before === null || after === null)
      // Reaching a mark that was missed is a gain; missing one that was reached is a loss.
      verdict = after === null ? 'worse' : 'better';
    else if (Math.abs(change ?? Infinity) <= gate + 1e-9) verdict = 'within';
    else verdict = (after > before) === (metric.better === 'higher') ? 'better' : 'worse';
    return { metric, base: before, change, verdict };
  });
}

const value = (m: Pick<Metric, 'digits'>, v: number | null) =>
  v === null ? 'never' : v.toLocaleString('en-US', { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits });
const pad = (text: string, width: number, right = false) => (right ? text.padStart(width) : text.padEnd(width));
function table(rows: string[][], rightFrom = 1) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((cell, i) => pad(cell, widths[i], i >= rightFrom && i < r.length - 1)).join('  ').trimEnd()).join('\n');
}

/** One ship's trial as a plain table. */
export function formatTrial(title: string, source: string, metrics: Metric[]): string {
  const rows = [['', 'value', 'unit'], ...metrics.map((m) => [(m.gated ? '* ' : '  ') + m.label, value(m, m.value), m.unit])];
  return `${title}\n${source}\n\n${table(rows)}\n\n* handling gate rows (top speed and turning); compare with --vs after a hull, draft or screw change.`;
}

const percent = (change: number | null) => (change === null ? '' : (change >= 0 ? '+' : '') + (100 * change).toFixed(Math.abs(change) < 0.1 ? 1 : 0) + '%');
const NOTE: Record<Verdict, string> = { same: '', within: '', changed: '', worse: '<< WORSE beyond gate', better: '>> better beyond gate' };

/** Baseline and current side by side, with the change and the gate verdict. */
export function formatComparison(title: string, baseLabel: string, currentLabel: string, rows: ComparedRow[], gate = HANDLING_GATE): string {
  const lines = [
    ['', baseLabel, currentLabel, 'unit', 'change', ''],
    ...rows.map(({ metric, base, change, verdict }) => [
      (metric.gated ? '* ' : '  ') + metric.label,
      value(metric, base),
      value(metric, metric.value),
      metric.unit,
      verdict === 'same' ? '=' : percent(change),
      NOTE[verdict],
    ]),
  ];
  const worse = rows.filter((r) => r.verdict === 'worse'),
    better = rows.filter((r) => r.verdict === 'better');
  const summary = worse.length
    ? `FAIL: ${worse.map((r) => r.metric.label).join('; ')} got worse beyond the ±${gate * 100}% handling gate. Fix it in ship data (steering room or rudder, screws, draft, mass), never through handling.maxYawRate.`
    : `PASS: no handling-gate row got worse by more than ${gate * 100}%.`;
  const gains = better.length
    ? `\nGains beyond the gate (${better.map((r) => r.metric.label).join('; ')}): keep one only when it follows from the corrected hull ` +
      '(a sharper turn beside a failing hard-turn speed is the same stall), and say so in the PR.'
    : '';
  return `${title}\n\n${table(lines, 1)}\n\n* handling gate rows, ±${gate * 100}%.\n${summary}${gains}`;
}

// ---------------------------------------------------------------------------------------------
// Command

interface Options {
  vs?: string;
  published: boolean;
  json: boolean;
}

async function git(root: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(err.trim() || `git ${args.join(' ')} failed`);
  return out;
}

/** The definition the working tree would publish: the compiled blueprint, or the published file with --published. */
async function workingDefinition(root: string, id: string, published: boolean): Promise<{ definition: ShipDefinition; source: string }> {
  const blueprintPath = join(root, 'assets/ships', id, 'blueprint.json');
  const publishedPath = join(root, 'public/models', id + '.json');
  if (published || !existsSync(blueprintPath)) {
    if (!existsSync(publishedPath)) throw new Error(`No ship ${id}: neither assets/ships/${id}/blueprint.json nor public/models/${id}.json exists.`);
    return { definition: JSON.parse(await readFile(publishedPath, 'utf8')), source: `public/models/${id}.json (published)` };
  }
  const blueprint = JSON.parse(await readFile(blueprintPath, 'utf8'));
  if (blueprint.construction && !blueprint.hull) {
    const { readSource } = await import('./files');
    const { compileConstruction } = await import('./compiler');
    const { source } = await readSource(root, id);
    const result = await compileConstruction(root, source);
    if (!result.definition)
      throw new Error('The construction source does not compile to a launchable ship: ' + JSON.stringify(result.diagnostics).slice(0, 2000));
    return { definition: result.definition, source: `assets/ships/${id}/blueprint.json (construction source, compiled natively)` };
  }
  const { compileShip } = await import('../../src/ships/blueprint');
  const catalog = JSON.parse(await readFile(join(root, 'assets/parts/guns.json'), 'utf8'));
  return {
    definition: compileShip(blueprint, catalog),
    source: `assets/ships/${id}/blueprint.json (Blender-recipe blueprint, compiled; no ship:build needed)`,
  };
}

/** Runs the native example on the given definition files, on the fast `test-fast` profile. */
async function runTrials(root: string, files: string[]): Promise<TrialReport[]> {
  const { rustTool } = await import('../multiplayer/toolchain');
  const command = [rustTool('cargo'), 'run', '--quiet', '--locked', '--profile', 'test-fast', '-p', 'naval-sim', '--example', 'maneuvering_trial', '--', ...files];
  console.error('Running the native maneuvering trial (test-fast profile; a cold build takes about 30 s)…');
  const child = Bun.spawn(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error('maneuvering_trial failed:\n' + err.slice(-4000));
  return out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TrialReport);
}

export async function runShipTrial(root: string, id: string, options: Options): Promise<number> {
  const directory = join(root, '.build/ship-trial', id);
  await mkdir(directory, { recursive: true });
  const current = await workingDefinition(root, id, options.published);
  const files = [join(directory, 'working.json')];
  await writeFile(files[0], JSON.stringify(current.definition));
  let base: { definition: ShipDefinition; label: string; source: string } | undefined;
  if (options.vs !== undefined) {
    const ref = options.vs;
    const commit = (await git(root, ['rev-parse', '--short', '--verify', ref + '^{commit}']).catch(() => {
      throw new Error(`Unknown git ref ${JSON.stringify(ref)}. Fetch it first (git fetch origin) or name a commit.`);
    })).trim();
    const text = await git(root, ['show', `${commit}:public/models/${id}.json`]).catch(() => {
      throw new Error(`public/models/${id}.json does not exist at ${ref} (${commit}); the ship was not published there.`);
    });
    base = { definition: JSON.parse(text), label: ref === commit ? commit : `${ref} (${commit})`, source: `public/models/${id}.json at ${ref} (${commit})` };
    files.push(join(directory, 'baseline.json'));
    await writeFile(files[1], text);
  }
  const [report, baseReport] = await runTrials(root, files);
  const metrics = trialMetrics(report, current.definition);
  const name = `${current.definition.name ?? id} (${id})`;
  const title = `${name}: maneuvering trial, calm water, dry loading, 180 s per run`;
  if (!base) {
    if (options.json) console.log(JSON.stringify({ id, source: current.source, metrics, report }, null, 2));
    else console.log(formatTrial(title, 'Definition: ' + current.source, metrics));
    return 0;
  }
  const rows = compareMetrics(trialMetrics(baseReport, base.definition), metrics);
  const failed = rows.some((r) => r.verdict === 'worse');
  if (options.json)
    console.log(
      JSON.stringify(
        { id, gate: HANDLING_GATE, pass: !failed, baseline: { ref: base.label, source: base.source, report: baseReport }, current: { source: current.source, report }, rows },
        null,
        2,
      ),
    );
  else
    console.log(
      formatComparison(`${title}\nBaseline: ${base.source}\nCurrent:  ${current.source}`, base.label, options.published ? 'published' : 'working tree', rows),
    );
  return failed ? 1 : 0;
}

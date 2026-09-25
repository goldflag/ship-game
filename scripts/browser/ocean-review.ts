/** `bun scripts/browser/ocean-review.ts --tag <name> [--only near,wide] [--quality high] [--measure] [--param realism=off] [--param renderer=waterpro] [--param wind=15] [--url http://127.0.0.1:5210]
 *    [--baseline origin/master [--rounds 3]]`
 * Renders the fixed scenes of `scripts/diagnostics/ocean-review.html` in a headed Chromium and saves one PNG
 * per scene to `.build/ocean-review/<tag>/`, with `results.json` (errors, optional frame timings).
 * `renderer=waterpro` draws them with the vendored Water Pro library the game's ocean replaced; add `foam=warm` to run
 * its whitecaps up for ten seconds first, as the game ocean's scenes always do.
 * `--baseline <ref>` renders every scene on a bootstrapped worktree of that ref as well (`baseline.ts`), each in its own
 * window: PNGs land in `<tag>/baseline/` and `<tag>/branch/` with the share of pixels that differ, and the timed scenes
 * (near, wide, grazing) are measured `--rounds` times in alternation, baseline then branch, and compared by median. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'playwright';
import { compareSamples, comparisonTable, diagnosticTargets, interleave, type Comparison, type Target } from './baseline';
import { launchDiagnosticBrowser, openDiagnosticPage, type DiagnosticPage } from './diagnosticPage';
import { ROOT } from './harness';

const { values } = parseArgs({ options: {
  tag: { type: 'string', default: 'current' }, only: { type: 'string' }, quality: { type: 'string', default: 'high' },
  measure: { type: 'boolean', default: false }, url: { type: 'string' }, param: { type: 'string', multiple: true, default: [] },
  baseline: { type: 'string' }, rounds: { type: 'string', default: '3' },
} });
const rounds = Number(values.rounds);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds takes a whole number of rounds, 1 or more.');
const out = resolve(ROOT, '.build/ocean-review', values.tag!);
mkdirSync(out, { recursive: true });
const TIMED = ['near', 'wide', 'grazing'];
const measuring = values.measure || !!values.baseline;
const log = (line: string) => console.error(line);
const { targets, close } = await diagnosticTargets({ baseline: values.baseline, url: values.url, log });
const paired = targets.length > 1;
let browser: Browser | undefined;
const pages = new Map<Target, DiagnosticPage>();
type Timing = { mean: number; median: number; p90: number; calls: number; triangles: number };
const review = {
  scenes: (page: Page) => page.evaluate(() => (window as any).oceanReview.scenes as string[]),
  scene: (page: Page, name: string) => page.evaluate(scene => (window as any).oceanReview.scene(scene), name) as Promise<Record<string, unknown>>,
  capture: (page: Page) => page.evaluate(() => (window as any).oceanReview.capture()) as Promise<string>,
  measure: async (page: Page) => ({ stepping: await page.evaluate(() => (window as any).oceanReview.measure(120, true)) as Timing,
    paused: await page.evaluate(() => (window as any).oceanReview.measure(60, false)) as Timing }),
};
try {
  browser = await launchDiagnosticBrowser();
  const query = new URLSearchParams({ quality: values.quality!, ...Object.fromEntries(values.param!.map(entry => entry.split(/=(.*)/s).slice(0, 2))) });
  for (const target of targets) {
    log(`${target.label}: ${target.name} at ${target.url}`);
    pages.set(target, await openDiagnosticPage(browser, `${target.url}/scripts/diagnostics/ocean-review.html?${query}`));
  }
  const branch = targets.at(-1)!, branchPage = pages.get(branch)!.page;
  const available = new Map<Target, string[]>();
  for (const target of targets) available.set(target, await review.scenes(pages.get(target)!.page));
  const wanted = values.only ? values.only.split(',') : available.get(branch)!.filter(name => name !== 'submerged');
  const results: Record<string, unknown> = {}, rows: { label: string; comparison: Comparison }[] = [];
  for (const name of wanted) {
    const entry: Record<string, unknown> = {}, images = new Map<Target, string>();
    for (const target of targets) {
      if (!available.get(target)!.includes(name)) { entry[target.label] = { missing: `${target.name} has no scene ${name}` }; continue; }
      const { page } = pages.get(target)!, started = Date.now();
      await page.bringToFront();
      const info = await review.scene(page, name), image = await review.capture(page);
      images.set(target, image);
      const dir = paired ? resolve(out, target.label) : out;
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
      entry[target.label] = { ...info, seconds: (Date.now() - started) / 1000 };
    }
    if (paired && images.size === 2) entry.pixels = await branchPage.evaluate(pixelDifference, [...images.values()] as [string, string]);
    const sides = targets.filter(target => images.has(target));
    if (measuring && TIMED.includes(name) && sides.length) {
      const timing: Record<string, { stepping: Timing; paused: Timing }[]> = Object.fromEntries(sides.map(target => [target.label, []]));
      for (const { target } of interleave(sides, paired ? rounds : 1)) {
        const { page } = pages.get(target)!;
        await page.bringToFront();
        timing[target.label].push(await review.measure(page));
      }
      entry.timing = timing;
      if (sides.length === 2) {
        const compare = (mode: 'stepping' | 'paused') => compareSamples(timing.baseline.map(run => run[mode].median), timing.branch.map(run => run[mode].median));
        entry.comparison = { stepping: compare('stepping'), paused: compare('paused') };
        rows.push({ label: `${name} stepping`, comparison: compare('stepping') }, { label: `${name} paused`, comparison: compare('paused') });
      }
    }
    // A run without a baseline keeps its old shape: the scene's own fields, then its timing.
    results[name] = paired ? entry : { ...entry.branch as object, ...(entry.timing ? { timing: (entry.timing as Record<string, unknown[]>).branch[0] } : {}) };
    console.log(name, JSON.stringify(paired ? { pixels: entry.pixels, comparison: entry.comparison } : results[name]));
  }
  const pageErrors = paired ? Object.fromEntries(targets.map(target => [target.label, pages.get(target)!.errors])) : pages.get(branch)!.errors;
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ quality: values.quality,
    ...(paired ? { targets: Object.fromEntries(targets.map(target => [target.label, target.name])), rounds } : {}), results, pageErrors }, null, 1));
  if (rows.length) {
    console.log(`\nMedian serialised frame ms over ${rounds} alternating rounds (baseline ${targets[0].name}; branch ${branch.name}):`);
    console.log(comparisonTable(rows));
  }
  for (const target of targets) if (pages.get(target)!.errors.length) console.error(`${paired ? `${target.label} ` : ''}page errors:\n${pages.get(target)!.errors.join('\n')}`);
  console.error(`Results in ${out}`);
} finally {
  await browser?.close().catch(() => undefined);
  await close();
}

/** In the page: the share of pixels whose channels differ by more than two levels between two PNG data URLs, and the largest
 * difference. Two captures of the same frozen frame differ by one level in a few pixels. */
async function pixelDifference([a, b]: [string, string]): Promise<{ differ: number; maxLevel: number } | { sizes: string }> {
  const read = async (url: string) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const [one, two] = await Promise.all([read(a), read(b)]);
  if (one.width !== two.width || one.height !== two.height) return { sizes: `${one.width}x${one.height} against ${two.width}x${two.height}` };
  let differ = 0, maxLevel = 0;
  for (let i = 0; i < one.data.length; i += 4) {
    const level = Math.max(Math.abs(one.data[i] - two.data[i]), Math.abs(one.data[i + 1] - two.data[i + 1]), Math.abs(one.data[i + 2] - two.data[i + 2]));
    if (level > 2) differ++;
    if (level > maxLevel) maxLevel = level;
  }
  return { differ: Math.round(differ / (one.width * one.height) * 1e6) / 1e6, maxLevel };
}

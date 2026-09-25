/** `bun scripts/browser/ocean-waves.ts --tag <name> [--quality high] [--views near,wide] [--seas moderate,storm,15]
 *   [--show shaded|height|slope|foam|variance|jacobian] [--validate] [--timing] [--coverage] [--lattice] [--sea-state off]`
 * Drives `scripts/diagnostics/ocean-waves.html` in a headed Chromium (headless stalls WebGPU): saves one PNG per
 * view and sea to `.build/ocean-waves/<tag>/`; --validate / --timing check every tier, --coverage measures crest foam
 * against Monahan's whitecap fraction from 6 to 30 m/s on --quality, --lattice how strongly whitecaps repeat with each
 * cascade's tile at the same winds; all write `results.json`. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser } from 'playwright';
import { diagnosticTargets } from './baseline';
import { launchDiagnosticBrowser, openDiagnosticPage } from './diagnosticPage';
import { ROOT } from './harness';

const { values } = parseArgs({ options: {
  tag: { type: 'string', default: 'current' }, quality: { type: 'string', default: 'high' },
  views: { type: 'string', default: '' }, seas: { type: 'string', default: 'moderate' }, show: { type: 'string', default: 'shaded' },
  validate: { type: 'boolean', default: false }, timing: { type: 'boolean', default: false }, coverage: { type: 'boolean', default: false },
  lattice: { type: 'boolean', default: false }, winds: { type: 'string', default: '6,9,12,15,18,21,25,30' },
  'sea-state': { type: 'string', default: 'on' },
  url: { type: 'string' },
} });
const out = resolve(ROOT, '.build/ocean-waves', values.tag!);
mkdirSync(out, { recursive: true });
// The server pushes no reloads, so a source edit during a 20-minute sweep leaves the page (and the sweep) alone.
const { targets: [target], close } = await diagnosticTargets({ url: values.url });
let browser: Browser | undefined;
let pageErrors: string[] = [];
const results: Record<string, unknown> = {};
try {
  browser = await launchDiagnosticBrowser();
  // A blurred window pauses requestAnimationFrame-driven timing; the page renders on demand instead.
  const query = new URLSearchParams({ quality: values.quality!, show: values.show!, seaState: values['sea-state']! });
  const opened = await openDiagnosticPage(browser, `${target.url}/scripts/diagnostics/ocean-waves.html?${query}`, { warnings: true });
  const page = opened.page;
  pageErrors = opened.errors;
  results.backend = await page.evaluate(() => (window as any).oceanWaves.backend);
  const views = values.views ? values.views.split(',') : [];
  for (const sea of views.length ? values.seas!.split(',') : []) for (const view of views) {
    const info = await page.evaluate(([v, s]) => (window as any).oceanWaves.view(v, s), [view, sea]);
    const image: string = await page.evaluate(() => (window as any).oceanWaves.capture());
    const name = `${view}-${sea}${values.show === 'shaded' ? '' : `-${values.show}`}`;
    writeFileSync(resolve(out, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
    console.log(name, JSON.stringify(info));
  }
  for (const quality of values.validate || values.timing ? ['low', 'medium', 'high', 'ultra'] : []) {
    await page.evaluate(q => (window as any).oceanWaves.setQuality(q), quality);
    const entry: Record<string, unknown> = {};
    if (values.validate) {
      for (const sea of ['calm', 'moderate', 'storm']) {
        await page.evaluate(s => (window as any).oceanWaves.view('near', s, .1), sea);
        entry[sea] = { transform: await page.evaluate(() => (window as any).oceanWaves.validate()), heights: await page.evaluate(() => (window as any).oceanWaves.heights()) };
      }
      entry.foam = await page.evaluate(() => (window as any).oceanWaves.foamCheck());
    }
    if (values.timing) {
      await page.evaluate(() => (window as any).oceanWaves.view('near', 'moderate', .5));
      entry.timing = [];
      for (let run = 0; run < 3; run++) (entry.timing as unknown[]).push(await page.evaluate(() => (window as any).oceanWaves.timing()));
    }
    results[quality] = entry;
    console.log(quality, JSON.stringify(entry));
  }
  if (values.coverage) {
    await page.evaluate(q => (window as any).oceanWaves.setQuality(q), values.quality);
    results.coverage = [];
    for (const wind of values.winds!.split(',').map(Number)) {
      const entry = await page.evaluate(w => (window as any).oceanWaves.foamCoverage(w), wind);
      (results.coverage as unknown[]).push(entry);
      console.log('coverage', JSON.stringify(entry));
    }
  }
  if (values.lattice) {
    await page.evaluate(q => (window as any).oceanWaves.setQuality(q), values.quality);
    results.lattice = [];
    for (const wind of values.winds!.split(',').map(Number)) {
      const entry = await page.evaluate(w => (window as any).oceanWaves.foamLattice(w), wind);
      (results.lattice as unknown[]).push(entry);
      console.log('lattice', JSON.stringify(entry));
    }
  }
  results.pageErrors = pageErrors;
  writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 1));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  await close();
}

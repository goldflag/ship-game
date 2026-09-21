import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { authoringServer, serverUrl } from './browser';
import { repositoryStore } from './files';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';

// A separate repository root and fresh browser contexts keep checks away from
// authored ships and the user's local/account library, including on failure.
const root = resolve(import.meta.dir, '../..');
/** Registered checks run by default. Any other exported check under `scripts/tests/*-browser.*` runs with
 * `--only <file>#<export>` (for example `--only shipbuilder-placement-browser.tsx#checkShipbuilderPlacement`). */
interface Check { name: string; module: string; check: string; path?: string }
const CHECKS: Check[] = [
  { name: 'compile-cache', module: 'construction-compile-cache-browser.ts', check: 'checkConstructionCompileCache' },
  { name: 'storage', module: 'construction-store-browser.ts', check: 'checkConstructionStore' },
  { name: 'repository-authoring', module: 'construction-authoring-browser.ts', check: 'checkRepositoryAuthoring', path: '/tools/construction/editor.html?ship=authoring-check-browser' },
  { name: 'design-deletion', module: 'design-deletion-browser.tsx', check: 'checkDesignDeletion' },
  { name: 'shipbuilder-editing', module: 'shipbuilder-browser.tsx', check: 'checkShipbuilderEditing' },
  { name: 'internals-selection', module: 'shipbuilder-internals-browser.ts', check: 'checkInternalsSelection' },
  { name: 'mooring-surface-attachment', module: 'shipbuilder-mooring-browser.ts', check: 'checkMastRopeAttachment' },
  { name: 'invalid-part-feedback', module: 'shipbuilder-internals-browser.ts', check: 'checkInvalidPartFeedback' },
  { name: 'equipment-palette-images', module: 'shipbuilder-internals-browser.ts', check: 'checkEquipmentPaletteImages' },
];
/** Checks already failing on master, by name; they are reported but do not fail the run. */
const KNOWN_RED: { name: string; since: string; note?: string }[] = await Bun.file(join(import.meta.dir, 'known-browser-failures.json')).json();
const args = process.argv.slice(2), only: string[] = [];
let headless = false, list = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--headless') headless = true;
  else if (args[i] === '--list') list = true;
  else if (args[i] === '--only' && args[i + 1]) only.push(...args[++i].split(','));
  else throw new Error('Usage: bun run ship:browser:check [--headless] [--list] [--only <name|file#export>[,…]]');
}
if (list) {
  for (const check of CHECKS) console.log(`${check.name}${KNOWN_RED.some(entry => entry.name === check.name) ? '  (known red)' : ''}`);
  console.log('\nUnregistered, run with --only <file>#<export>:');
  for (const file of [...new Bun.Glob('*-browser.{ts,tsx}').scanSync({ cwd: join(root, 'scripts/tests') })].sort()) {
    const exported = [...(await Bun.file(join(root, 'scripts/tests', file)).text()).matchAll(/^export (?:async )?function (check\w+)/gm)].map(match => match[1])
      .filter(name => !CHECKS.some(check => check.module === file && check.check === name));
    for (const name of exported) console.log(`${file}#${name}`);
  }
  process.exit(0);
}
const selected: Check[] = only.length ? only.map(entry => {
  const [module, check] = entry.split('#');
  const found = check ? { name: entry, module, check } : CHECKS.find(candidate => candidate.name === entry);
  if (!found) throw new Error(`Unknown check "${entry}". Run with --list.`);
  return found;
}) : CHECKS;
const scratch = join(root, '.build/construction-browser');
await mkdir(scratch, { recursive: true });
const fixture = await mkdtemp(join(scratch, 'run-'));
let server: Awaited<ReturnType<typeof authoringServer>> | undefined;
let browser: Browser | undefined;
try {
  await mkdir(join(fixture, 'assets/ships'), { recursive: true });
  await symlink(join(root, 'public'), join(fixture, 'public'), 'dir');
  const catalog = parseConstructionCatalog(await Bun.file(join(root, 'public/models/components/catalog.json')).json());
  const source = createStarterSource(catalog, 'blank');
  source.id = 'authoring-check-browser'; source.name = 'Disposable browser check';
  await repositoryStore(fixture).save({ designId: source.id, name: source.name, source, schemaVersion: source.schemaVersion,
    catalogRevision: catalog.revision, expectedRevisionId: null });
  server = await authoringServer(root, 0, false, undefined, fixture);
  browser = await chromium.launch({ headless, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    ...(process.env.CONSTRUCTION_CHROME ? { executablePath: process.env.CONSTRUCTION_CHROME } : {}) });
  const base = serverUrl(server);
  const run = async (name: string, work: (page: Page) => Promise<unknown>, path = '/scripts/diagnostics/construction-check.html') => {
    const context = await browser!.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(120_000);
    console.log(`Checking ${name}…`);
    try {
      await page.goto(base + path, { waitUntil: 'load', timeout: 120_000 });
      const result = await work(page);
      if (errors.length) throw new Error(errors.join('\n'));
      console.log(JSON.stringify({ check: name, result }));
    } catch (cause) {
      const screenshot = join(scratch, name + '-failed.png');
      await page.screenshot({ path: screenshot }).catch(() => {});
      throw new Error(`${name} failed; screenshot: ${screenshot}\n${errors.join('\n')}`, { cause });
    } finally { await context.close(); }
  };
  // Every selected check runs, so one red check does not hide the state of the rest.
  const failed: string[] = [], known: string[] = [];
  for (const check of selected) {
    try {
      await run(check.name, page => page.evaluate(async ([modulePath, name]) => (await import(modulePath))[name](), ['/scripts/tests/' + check.module, check.check]), check.path);
    } catch (error) {
      if (KNOWN_RED.some(entry => entry.name === check.name)) { known.push(check.name); continue; }
      failed.push(check.name);
      console.error(String((error as Error).message).slice(0, 2000), String(((error as Error).cause as Error | undefined)?.message ?? '').slice(0, 2000));
    }
  }
  console.log(`\n${selected.length} browser checks: ${failed.length} new failures${failed.length ? ` (${failed.join(', ')})` : ''}, ${known.length} known red${known.length ? ` (${known.join(', ')})` : ''}`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser?.close();
  (server?.httpServer as Server | undefined)?.closeAllConnections();
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}

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
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--headless')) throw new Error('Usage: bun run ship:browser:check [--headless]');
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
  browser = await chromium.launch({ headless: args.includes('--headless'), args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
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
  await run('storage', page => page.evaluate(async modulePath => {
    const { checkConstructionStore } = await import(modulePath);
    return checkConstructionStore();
  }, '/scripts/tests/construction-store-browser.ts'));
  await run('repository-authoring', page => page.evaluate(async modulePath => {
    const { checkRepositoryAuthoring } = await import(modulePath);
    return checkRepositoryAuthoring();
  }, '/scripts/tests/construction-authoring-browser.ts'), '/tools/construction/editor.html?ship=' + source.id);
  await run('design-deletion', page => page.evaluate(async modulePath => {
    const { checkDesignDeletion } = await import(modulePath);
    return checkDesignDeletion();
  }, '/scripts/tests/design-deletion-browser.tsx'));
  await run('shipbuilder-editing', page => page.evaluate(async modulePath => {
    const { checkShipbuilderEditing } = await import(modulePath);
    return checkShipbuilderEditing();
  }, '/scripts/tests/shipbuilder-browser.tsx'));
  console.log('All construction browser checks passed.');
} finally {
  await browser?.close();
  (server?.httpServer as Server | undefined)?.closeAllConnections();
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}

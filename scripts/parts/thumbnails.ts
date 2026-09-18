import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import type { ConstructionCatalog, ConstructionEquipmentPart } from '../../src/ships/blueprint';

const root = resolve(import.meta.dir, '../..');
const indexPath = join(root, 'src/generated/construction-thumbnails.json');
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// All rendering inputs that can change a component card, including the Three version.
const recipeFiles = ['src/ships/componentMaterials.ts', 'assets/parts/materials.json', 'assets/ships/appearance/finishes.json', 'src/ui/shipbuilding/slotImages.ts', 'src/game/loadShipModel.ts',
  'src/game/constructionPathModel.ts', 'src/ships/constructionPaths.ts', 'assets/parts/construction/path_geometry.ts', 'assets/parts/construction/ladder_geometry.ts', 'src/ships/constructionLadders.ts'];
const threeVersion = JSON.parse(await readFile(join(root, 'node_modules/three/package.json'), 'utf8')).version;
const recipeHash = hash(JSON.stringify([threeVersion, await Promise.all(recipeFiles.map(async path => [path, hash(await readFile(join(root, path)))]))]));
type Thumbnail = { url: string; modelHash: string; imageHash: string };
type Index = { recipeHash: string; images: Record<string, Thumbnail> };
const catalogsRoot = join(root, 'public/models/components/catalogs');
const catalogs: ConstructionCatalog[] = [JSON.parse(await readFile(join(root, 'public/models/components/catalog.json'), 'utf8'))];
for (const revision of await readdir(catalogsRoot)) catalogs.push(JSON.parse(await readFile(join(catalogsRoot, revision, 'catalog.json'), 'utf8')));
const parts = new Map<string, { part: ConstructionEquipmentPart; catalog: ConstructionCatalog }>();
for (const catalog of catalogs) for (const part of catalog.equipment) parts.set(part.modelUrl, { part, catalog });
const previous: Index = JSON.parse(await readFile(indexPath, 'utf8'));
const expected = async (part: ConstructionEquipmentPart) => {
  const modelHash = hash(await readFile(join(root, 'public', part.modelUrl)));
  const key = hash(JSON.stringify([recipeHash, modelHash, part.path]));
  return { url: `/models/components/thumbnails/${key}.png`, modelHash };
};
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: bun run part:thumbnails [--check]');
const images: Index['images'] = {};
const missing: { part: ConstructionEquipmentPart; catalog: ConstructionCatalog; url: string; modelHash: string }[] = [];
for (const { part, catalog } of parts.values()) {
  const entry = await expected(part), old = previous.images[part.modelUrl];
  const bytes = await readFile(join(root, 'public', entry.url)).catch(() => undefined);
  if (previous.recipeHash === recipeHash && old?.url === entry.url && old.modelHash === entry.modelHash && bytes && hash(bytes) === old.imageHash) images[part.modelUrl] = old;
  else missing.push({ part, catalog, ...entry });
}
if (check) {
  if (missing.length) throw new Error(`Missing/stale component thumbnails (${missing.map(item => item.part.id).join(', ')}). Run bun run part:thumbnails.`);
} else if (missing.length) {
  const server = await authoringServer(root);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
      ...(process.env.CONSTRUCTION_CHROME ? { executablePath: process.env.CONSTRUCTION_CHROME } : {}) });
    const page = await browser.newPage();
    await page.goto(serverUrl(server) + '/scripts/diagnostics/construction-check.html');
    // Vite reloads the page once when it first discovers the renderer's dependencies; take that reload before baking.
    await page.evaluate(async () => { const paths = ['/src/ui/shipbuilding/slotImages.ts', '/src/ui/shipbuilding/builderLayers.ts']; for (const path of paths) await import(path); }).catch(() => undefined);
    await page.waitForTimeout(4000); await page.reload(); await page.waitForLoadState('networkidle');
    // A single renderer and model-at-a-time queue keep GPU use bounded.
    for (const { part, catalog, url, modelHash } of missing) {
      const png = await page.evaluate(async ({ part, catalog }) => {
        const rendererPath = '/src/ui/shipbuilding/slotImages.ts', palettePath = '/src/ui/shipbuilding/builderLayers.ts';
        const { SlotImages } = await import(rendererPath);
        const { partSlot } = await import(palettePath);
        const host = window as unknown as { thumbnailBaker?: InstanceType<typeof SlotImages> };
        host.thumbnailBaker ??= new SlotImages();
        return await host.thumbnailBaker.get(partSlot(part, catalog), catalog);
      }, { part, catalog });
      if (!png?.startsWith('data:image/png;base64,')) throw new Error(`No thumbnail: ${part.id}`);
      const bytes = Buffer.from(png.split(',')[1], 'base64'), target = join(root, 'public', url);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target + '.tmp', bytes); await rename(target + '.tmp', target);
      images[part.modelUrl] = { url, modelHash, imageHash: hash(bytes) };
      console.log(`Baked ${part.id}`);
    }
    await writeFile(indexPath + '.tmp', JSON.stringify({ recipeHash, images } satisfies Index, null, 2) + '\n');
    await rename(indexPath + '.tmp', indexPath);
  } finally { await browser?.close(); await server.close(); }
}
console.log(`Component thumbnails: ${parts.size} ${check ? 'verified' : 'ready'}`);

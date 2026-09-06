import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { validateAircraftCatalog, validateAircraftShape, type AircraftEntry } from './catalog';
import { aircraftNodeIds, inspectAircraftLods } from './glb';

const root = resolve(import.meta.dir, '../..');
const sourceDir = join(root, 'assets/aircraft');
const recipePath = join(sourceDir, 'build.py');
const detailRecipePath = join(sourceDir, 'detail_bombers.py');
const catalogPath = join(sourceDir, 'catalog.json');
const outputDir = join(root, 'public/models/aircraft');
const [action = 'check', requestedId = 'all'] = process.argv.slice(2);
if (!['build', 'check', 'review', 'publish', 'hash', 'inputs'].includes(action) || (requestedId !== 'all' && !/^[a-z][a-z0-9-]{0,63}$/.test(requestedId))) throw new Error('Usage: bun scripts/aircraft/pipeline.ts build|check|review|publish|hash|inputs <aircraft-id|all>');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const authoringHash = async () => {
  const [catalogBytes, recipeBytes, detailBytes] = await Promise.all([readFile(catalogPath), readFile(recipePath), readFile(detailRecipePath)]);
  const digest = createHash('sha256').update(catalogBytes).update('\0').update(recipeBytes).update('\0detail_bombers.py\0').update(detailBytes);
  const entries = validateAircraftCatalog(JSON.parse(catalogBytes.toString('utf8'))).aircraft;
  const sourceFiles: Record<string, string> = {
    'assets/aircraft/catalog.json': hash(catalogBytes), 'assets/aircraft/build.py': hash(recipeBytes),
    'assets/aircraft/detail_bombers.py': hash(detailBytes),
  };
  for (const entry of [...entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const shapePath = `assets/aircraft/shapes/${entry.id}.json`, shapeBytes = await readFile(join(root, shapePath));
    const shape = validateAircraftShape(JSON.parse(shapeBytes.toString('utf8')), entry.id);
    const referencePath = resolve(root, shape.reference.imagePath);
    if (!referencePath.startsWith(join(root, 'assets') + sep)) throw new Error(`${entry.id}: reference.imagePath must stay under assets/`);
    const referenceBytes = await readFile(referencePath);
    if (!referenceBytes.length) throw new Error(`${entry.id}: reference image is empty`);
    sourceFiles[shapePath] = hash(shapeBytes);
    sourceFiles[shape.reference.imagePath] = hash(referenceBytes);
    digest.update('\0').update(entry.id).update('\0').update(shapeBytes);
  }
  return { catalogBytes, sourceFiles, contentHash: digest.digest('hex') };
};
const { catalogBytes, contentHash, sourceFiles } = await authoringHash();
const catalog = validateAircraftCatalog(JSON.parse(catalogBytes.toString('utf8')));
const selected = requestedId === 'all' ? catalog.aircraft : catalog.aircraft.filter(entry => entry.id === requestedId);
if (!selected.length) throw new Error(`Unknown aircraft ${requestedId}`);
const coordinates = { units: 'meters', right: '+X', up: '+Y', forward: '-Z' };
const lodFiles = ['model.glb', 'model-lod1.glb', 'model-lod2.glb'] as const;
const runtimePaths = (id: string) => [`${id}.glb`, `LOD1/${id}-lod1.glb`, `LOD2/${id}-lod2.glb`] as const;
const switchDistancesM = [120, 400] as const;
const runtimeCatalog = {
  schemaVersion: 1, contentHash, coordinates,
  aircraft: catalog.aircraft.map(({ id, name, nation, role, year, length, wingspan }) => ({
    id, name, nation, role, year, length, wingspan,
    modelUrl: `/models/aircraft/${id}.glb`, contentHash, nodeIds: aircraftNodeIds,
    switchDistancesM,
    lods: runtimePaths(id).map((path, level) => ({ level, modelUrl: `/models/aircraft/${path}`, switchDistanceM: level === 0 ? 0 : switchDistancesM[level - 1], contentHash })),
  })),
};
const reviewNames = ['quarter', 'top', 'side', 'front', 'rear', 'articulated'] as const;
const generatedDir = (id: string) => join(sourceDir, id, 'generated');
const reportPath = (id: string) => join(sourceDir, id, 'reports/export.json');
const stageDir = (id: string) => join(root, '.build/aircraft', id);
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

async function writeAtomic(path: string, bytes: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', bytes);
  await rename(path + '.tmp', path);
}
async function copyAtomic(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to + '.tmp');
  await rename(to + '.tmp', to);
}
async function assertInputsCurrent() {
  const current = await authoringHash();
  if (current.contentHash !== contentHash || JSON.stringify(current.sourceFiles) !== JSON.stringify(sourceFiles)) throw new Error('Aircraft catalog, recipes, shapes or reference files changed during this command. Run aircraft:build all again.');
}
async function inspectReview(directory: string, aircraftId: string) {
  const images: Record<string, { sha256: string; width: number; height: number }> = {};
  for (const name of reviewNames) {
    const bytes = await readFile(join(directory, `${name}.png`));
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Missing or invalid ${name} review PNG`);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width < 256 || height < 256) throw new Error(`${name} review PNG is too small to inspect`);
    images[name] = { sha256: hash(bytes), width, height };
  }
  const cameras = await readFile(join(directory, 'cameras.json'));
  const metadata = JSON.parse(cameras.toString('utf8'));
  if (metadata.aircraftId !== aircraftId || metadata.contentHash !== contentHash || metadata.projection !== 'orthographic' || !Array.isArray(metadata.views) || reviewNames.some(name => !metadata.views.some((view: { name: string }) => view.name === name))) throw new Error(`${aircraftId}: stale or incomplete review camera metadata`);
  return { images, camerasHash: hash(cameras) };
}
async function inspectAuthoring(directory: string, aircraftId: string) {
  const bytes = await readFile(join(directory, 'authoring.json'));
  const metadata = JSON.parse(bytes.toString('utf8'));
  if (metadata.schemaVersion !== 1 || metadata.aircraftId !== aircraftId || metadata.contentHash !== contentHash || metadata.originalGeometry !== true || !['blender-mcp', 'local-blender'].includes(metadata.method) || typeof metadata.blenderVersion !== 'string') throw new Error(`${aircraftId}: stale or invalid authoring metadata`);
  return { method: metadata.method as string, blenderVersion: metadata.blenderVersion as string, metadataHash: hash(bytes) };
}
async function inspectProducts(entry: AircraftEntry, directory: string) {
  const [models, source] = await Promise.all([Promise.all(lodFiles.map(name => readFile(join(directory, name)))), readFile(join(directory, 'source.blend'))]);
  if (source.length < 1024) throw new Error(`${entry.id}: missing or invalid retained Blender source`);
  const reports = inspectAircraftLods(models as [Buffer, Buffer, Buffer], entry, contentHash, { requireTexturedSurface: true });
  const textures: Record<string, { sha256: string; width: number; height: number }> = {};
  for (const name of ['airframe-basecolor.png', 'airframe-roughness.png']) {
    const bytes = await readFile(join(directory, name));
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${entry.id}: missing or invalid retained ${name}`);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width < 256 || height < 256 || width > 4096 || height > 4096) throw new Error(`${entry.id}: retained ${name} must be between 256 and 4096 pixels per axis`);
    textures[name] = { sha256: hash(bytes), width, height };
  }
  return {
    ...reports[0], modelHash: hash(models[0]), sourceBlendHash: hash(source), sourceFiles, textures,
    lods: reports.map((report, level) => ({ level, ...report, modelHash: hash(models[level]), triangleRatio: report.triangles / reports[0].triangles })),
    authoring: await inspectAuthoring(directory, entry.id), review: await inspectReview(join(directory, 'review'), entry.id),
  };
}
async function runBlender(entry: AircraftEntry) {
  const stage = stageDir(entry.id);
  await mkdir(stage, { recursive: true });
  const executable = process.env.BLENDER_BIN ?? (existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender');
  console.log(`Building ${entry.id} with local Blender (${contentHash.slice(0, 12)})`);
  const child = Bun.spawn([executable, '--background', '--factory-startup', '--python-exit-code', '1', '--python', recipePath], {
    cwd: root, env: {
      ...process.env, AIRCRAFT_ROOT: root, AIRCRAFT_ID: entry.id, AIRCRAFT_OUTPUT: stage,
      AIRCRAFT_CONTENT_HASH: contentHash, AIRCRAFT_REVIEW: '1', AIRCRAFT_METHOD: 'local-blender',
    }, stdout: 'pipe', stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  await writeFile(join(stage, 'build.log'), stdout + stderr);
  if (code !== 0) throw new Error(`Blender failed for ${entry.id} (${code}):\n${(stdout + stderr).slice(-6000)}`);
  await assertInputsCurrent();
  return stage;
}
async function publish(entry: AircraftEntry, directory: string) {
  const report = await inspectProducts(entry, directory);
  await assertInputsCurrent();
  const destination = generatedDir(entry.id);
  for (const name of ['source.blend', ...lodFiles, 'airframe-basecolor.png', 'airframe-roughness.png', 'authoring.json']) if (resolve(directory) !== resolve(destination)) await copyAtomic(join(directory, name), join(destination, name));
  for (const name of reviewNames) if (resolve(directory) !== resolve(destination)) await copyAtomic(join(directory, 'review', `${name}.png`), join(destination, 'review', `${name}.png`));
  if (resolve(directory) !== resolve(destination)) await copyAtomic(join(directory, 'review/cameras.json'), join(destination, 'review/cameras.json'));
  for (const [level, path] of runtimePaths(entry.id).entries()) await copyAtomic(join(directory, lodFiles[level]), join(outputDir, path));
  await writeAtomic(reportPath(entry.id), json(report));
  await writeAtomic(join(destination, 'review/manifest.json'), json({ schemaVersion: 1, contentHash, modelHash: report.modelHash, ...report.review }));
  console.log(`${entry.id}: LOD triangles ${report.lods.map(lod => lod.triangles.toLocaleString()).join(' / ')}, ${(report.bytes / 1024).toFixed(0)} KiB base, UV textures and ${report.joints.length} articulated controls passed at every LOD`);
}
async function check(entry: AircraftEntry) {
  const [runtimeModels, storedReport, reviewManifest, report] = await Promise.all([
    Promise.all(runtimePaths(entry.id).map(path => readFile(join(outputDir, path)))), readFile(reportPath(entry.id), 'utf8'),
    readFile(join(generatedDir(entry.id), 'review/manifest.json'), 'utf8'),
    inspectProducts(entry, generatedDir(entry.id)),
  ]);
  for (const [level, model] of runtimeModels.entries()) if (hash(model) !== report.lods[level].modelHash) throw new Error(`${entry.id}: retained and runtime LOD${level} GLBs differ`);
  if (JSON.stringify(JSON.parse(storedReport)) !== JSON.stringify(report)) throw new Error(`${entry.id}: retained export report is stale. Run aircraft:build ${entry.id}.`);
  const manifest = { schemaVersion: 1, contentHash, modelHash: report.modelHash, ...report.review };
  if (JSON.stringify(JSON.parse(reviewManifest)) !== JSON.stringify(manifest)) throw new Error(`${entry.id}: review manifest is stale. Run aircraft:review ${entry.id}.`);
  console.log(`${entry.id}: passed (LOD triangles ${report.lods.map(lod => lod.triangles.toLocaleString()).join(' / ')}, ${(report.bytes / 1024).toFixed(0)} KiB base)`);
}

if (action === 'hash') {
  console.log(contentHash);
} else if (action === 'inputs') {
  console.log(`${catalog.aircraft.length} catalog entries and measured shape/reference inputs passed (${contentHash})`);
} else if (action === 'check') {
  const published = JSON.parse(await readFile(join(outputDir, 'catalog.json'), 'utf8'));
  if (JSON.stringify(published) !== JSON.stringify(runtimeCatalog)) throw new Error('Runtime aircraft catalog is stale. Run aircraft:build all.');
  for (const entry of selected) await check(entry);
} else {
  const lock = join(root, '.build/aircraft/pipeline.lock');
  await mkdir(dirname(lock), { recursive: true });
  try { await mkdir(lock); } catch { throw new Error(`Another aircraft command owns ${lock}; confirm its process has stopped before removing an interrupted lock.`); }
  try {
    await writeFile(join(lock, 'owner.json'), json({ pid: process.pid, action, requestedId, started: new Date().toISOString() }));
    for (const entry of selected) {
      // publish adopts outputs authored through Blender MCP without rerunning Blender.
      // review rebuilds with the same durable recipe, retaining all six fixed views.
      const directory = action === 'publish' ? generatedDir(entry.id) : await runBlender(entry);
      await publish(entry, directory);
    }
    await assertInputsCurrent();
    await writeAtomic(join(outputDir, 'catalog.json'), json(runtimeCatalog));
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

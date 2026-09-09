import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { barrelIds } from '../../src/ships/blueprint';
import { readLibrary, componentHash, recipeInputs } from './library';

const root = resolve(import.meta.dir, '../..');
const [action = 'list', id = 'all'] = process.argv.slice(2);
if (!['list', 'inputs', 'build', 'check'].includes(action)) throw new Error('Usage: bun run part:list | part:inputs|build|check <part-id|all>');
const { library, catalog } = await readLibrary(root);
const entries = library.components.filter(e => id === 'all' ? action === 'list' || !!e.builder : e.partId === id);
if (!entries.length) throw new Error(`Unknown component: ${id}`);
for (const entry of entries) {
  if (action === 'list') { console.log(`${entry.partId}\t${entry.family}\t${entry.builder ? 'reusable recipe' : 'installed preview only'}\t${entry.review}`); continue; }
  if (!entry.builder) throw new Error(`${entry.partId}: installed preview only; extract original source before building`);
  if (action === 'inputs') { console.log(JSON.stringify({ version: 1, files: recipeInputs(library, entry) }, null, 2)); continue; }
  const part = catalog.parts.find(p => p.id === entry.partId)!;
  const hash = await componentHash(root, library, entry, part);
  const output = join(root, '.build/parts', entry.partId);
  const stage = output + '.staging';
  if (action === 'build') {
    await mkdir(join(root, '.build/parts'), { recursive: true });
    try { await mkdir(stage); } catch { throw new Error(`Build already running or interrupted: ${stage}. Inspect before removing it.`); }
    try {
      const definition = { schemaVersion: 1, contentHash: hash, mounts: [{ id: 'component', name: part.name, partId: part.id, battery: 'main', weapon: part, position: [0, 0, 0], bearingDeg: 0, rangefinder: false }] };
      const definitionFile = join(stage, 'definition.json');
      await writeFile(definitionFile, JSON.stringify(definition));
      const blender = process.env.BLENDER_BIN ?? (existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender');
      const child = Bun.spawn([blender, '--background', '--factory-startup', '--python-exit-code', '1', '--python', join(root, 'scripts/parts/build.py')], { env: { ...process.env, SHIP_OUTPUT: stage, SHIP_DEFINITION: definitionFile }, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      await writeFile(join(stage, 'build.log'), stdout + stderr);
      if (code) throw new Error(`Blender failed (${code}); see ${stage}/build.log`);
      const latest = await readLibrary(root);
      const latestEntry = latest.library.components.find(e => e.partId === entry.partId)!;
      if (await componentHash(root, latest.library, latestEntry, latest.catalog.parts.find(p => p.id === entry.partId)!) !== hash) throw new Error('Inputs changed during build; retry');
      await inspect(join(stage, 'model.glb'), hash, barrelIds(part));
      await mkdir(output, { recursive: true });
      for (const file of ['definition.json', 'source.blend', 'build.log', 'model.glb']) await rename(join(stage, file), join(output, file));
      await rm(stage, { recursive: true });
    } catch (e) { throw new Error(`${String(e)}. Interrupted staging retained at ${stage}`); }
  }
  await inspect(join(output, 'model.glb'), hash, barrelIds(part));
  console.log(`${entry.partId}: ${action} passed (geometry review: ${entry.review})`);
}
async function inspect(file: string, hash: string, barrels: readonly string[]) {
  const bytes = await readFile(file).catch(() => { throw new Error(`Missing preview ${file}; run bun run part:build ${id}`); });
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid component GLB');
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  if (doc.scenes[doc.scene ?? 0].extras?.definitionHash !== hash) throw new Error(`Stale component ${file}; rebuild`);
  const nodes = new Set(doc.nodes.map((n: { extras?: { nodeId?: string } }) => n.extras?.nodeId));
  for (const suffix of ['yaw', ...barrels.flatMap(b => [`${b}.elevation`, `${b}.recoil`, `${b}.muzzle`])]) if (!nodes.has(`component.${suffix}`)) throw new Error(`Missing joint/socket: ${suffix}`);
  if (!doc.meshes?.length) throw new Error('Component has no meshes');
}

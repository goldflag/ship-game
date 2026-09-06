import { mkdir, readFile, writeFile, copyFile, rename, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { barrelIds, compileShip, type ShipDefinition } from '../../src/ships/blueprint';

const root = resolve(import.meta.dir, '../..');
const [action = 'check', shipId = 'bismarck'] = process.argv.slice(2);
if (!['build', 'check', 'compile', 'review', 'thumbnail'].includes(action) || !/^[a-z][a-z0-9-]{0,63}$/.test(shipId)) throw new Error('Usage: bun scripts/ships/pipeline.ts build|check|compile|review|thumbnail <ship-id>');
const sourceDir = join(root, 'assets/ships', shipId);
const stage = join(root, '.build/ships', shipId);
const catalog = JSON.parse(await readFile(join(root, 'assets/parts/guns.json'), 'utf8'));
const blueprint = JSON.parse(await readFile(join(sourceDir, 'blueprint.json'), 'utf8'));
const definition = compileShip(blueprint, catalog);
if (definition.id !== shipId || definition.modelUrl !== `/models/${shipId}.glb`) throw new Error('Ship ID, directory and model URL must agree');
const pythonRecipes = (await readdir(join(root, 'scripts/ships'))).filter(p => p.endsWith('.py')).sort().map(p => `scripts/ships/${p}`);
// Optional versioned original components are shared only by their declared consumers.
// Include the register itself so adding/removing dependencies also invalidates exports.
const inputRegister = `assets/ships/${shipId}/recipe-inputs.json`;
async function recipeInputs() {
  if (!existsSync(join(root, inputRegister))) return [];
  const register = JSON.parse(await readFile(join(root, inputRegister), 'utf8'));
  if (register.version !== 1 || !Array.isArray(register.files) || register.files.some((p: unknown) => typeof p !== 'string' || !/^assets\/[a-zA-Z0-9_./-]+$/.test(p) || p.split('/').includes('..') || p.includes('/baseline/') || p.includes('/references/'))) throw new Error('Invalid original recipe input register');
  return [inputRegister, ...register.files as string[]];
}
async function readRecipes() {
  return Promise.all(['src/ships/blueprint.ts', ...pythonRecipes, `assets/ships/${shipId}/build.py`, ...await recipeInputs()].map(p => readFile(join(root, p), 'utf8')));
}
const recipe = await readRecipes();
const contentHash = createHash('sha256').update(JSON.stringify([definition, ...recipe])).digest('hex');
const published = { ...definition, contentHash };
const outputDir = join(root, 'public/models');
// Presentation recipes have their own hash; changing a thumbnail does not change ship geometry.
const thumbnailRecipe = join(root, 'assets/ships/thumbnail.py');
const thumbnailRecipeHash = createHash('sha256').update(await readFile(thumbnailRecipe)).digest('hex');
const thumbnailDir = join(sourceDir, 'generated/thumbnail');
const thumbnailOutput = join(outputDir, `${shipId}-thumbnail.png`);

async function bakeThumbnail() {
  await runBlender(thumbnailRecipe);
  if (createHash('sha256').update(await readFile(thumbnailRecipe)).digest('hex') !== thumbnailRecipeHash) throw new Error('Thumbnail recipe changed during rendering. Re-run ship:thumbnail.');
  const bytes = await readFile(join(stage, 'thumbnail.png'));
  const report = {
    contentHash, recipeHash: thumbnailRecipeHash,
    imageHash: createHash('sha256').update(bytes).digest('hex'),
    ...JSON.parse(await readFile(join(stage, 'thumbnail-camera.json'), 'utf8')),
  };
  await mkdir(thumbnailDir, { recursive: true });
  await writeFile(join(thumbnailDir, 'render.json.tmp'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(thumbnailOutput + '.tmp', bytes);
  await rename(thumbnailOutput + '.tmp', thumbnailOutput);
  await rename(join(thumbnailDir, 'render.json.tmp'), join(thumbnailDir, 'render.json'));
  console.log(`Baked port thumbnail: ${thumbnailOutput}`);
}

async function checkThumbnail() {
  const report = JSON.parse(await readFile(join(thumbnailDir, 'render.json'), 'utf8'));
  const imageHash = createHash('sha256').update(await readFile(thumbnailOutput)).digest('hex');
  if (report.contentHash !== contentHash || report.recipeHash !== thumbnailRecipeHash || report.imageHash !== imageHash) throw new Error(`Thumbnail is stale. Run bun run ship:thumbnail ${shipId}`);
}

interface GltfNode { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: Record<string, unknown>; }
interface Gltf {
  nodes: GltfNode[]; scenes: { nodes: number[]; extras?: Record<string, unknown> }[]; scene?: number;
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  accessors: { min?: number[]; max?: number[]; count: number }[];
}
function inspectGlb(bytes: Buffer, def: ShipDefinition) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid GLB header');
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as Gltf;
  const scene = gltf.scenes[gltf.scene ?? 0];
  if (scene.extras?.definitionHash !== contentHash) throw new Error('GLB definition hash does not match its blueprint/recipe');
  const byId = new Map<string, number>();
  gltf.nodes.forEach((n, i) => {
    const key = n.extras?.nodeId;
    if (typeof key === 'string') { if (byId.has(key)) throw new Error(`Duplicate node ID ${key}`); byId.set(key, i); }
  });
  const frames = (overrides = new Map<number, Matrix4>()) => {
    const worlds = new Map<number, Matrix4>();
    const walk = (index: number, parent: Matrix4, ancestry: Set<number>) => {
      if (ancestry.has(index) || worlds.has(index)) throw new Error('Cyclic or multiply-parented GLB hierarchy');
      const n = gltf.nodes[index];
      if (!n) throw new Error(`Missing node ${index}`);
      const local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3().fromArray(n.translation ?? [0, 0, 0]), new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]), new Vector3().fromArray(n.scale ?? [1, 1, 1]));
      if (overrides.has(index)) {
        const p = new Vector3().setFromMatrixPosition(local);
        local.copy(overrides.get(index)!); local.setPosition(p);
      }
      const world = parent.clone().multiply(local);
      if (!world.elements.every(Number.isFinite)) throw new Error('Nonfinite GLB transform');
      worlds.set(index, world);
      const ancestors = new Set(ancestry).add(index);
      n.children?.forEach(c => walk(c, world, ancestors));
    };
    scene.nodes.forEach(n => walk(n, new Matrix4(), new Set()));
    return worlds;
  };
  const worlds = frames();
  const getIndex = (id: string) => { const index = byId.get(id); if (index === undefined) throw new Error(`Missing required export node ${id}`); return index; };
  if (def.submarine) for (const id of Object.values(def.submarine.appendages).flat()) {
    const node = gltf.nodes[getIndex(id)];
    if (node.mesh !== undefined || !node.children?.length) throw new Error(`Appendage ${id} must retain an independent pivot empty and moving geometry`);
  }
  const hullIndex = getIndex('hull.surface');
  const hull = gltf.nodes[hullIndex];
  const bounds = [new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity)];
  gltf.meshes[hull.mesh!].primitives.forEach(p => {
    const accessor = gltf.accessors[p.attributes.POSITION];
    if (!accessor.min || !accessor.max) throw new Error('Hull positions require bounds');
    for (let corner = 0; corner < 8; corner++) {
      const v = new Vector3(...[0, 1, 2].map(i => (corner & (1 << i) ? accessor.max! : accessor.min!)[i]) as [number, number, number]).applyMatrix4(worlds.get(hullIndex)!);
      bounds[0].min(v); bounds[1].max(v);
    }
  });
  const near = (a: number, b: number, label: string, tolerance = .025) => { if (Math.abs(a - b) > tolerance) throw new Error(`${label}: measured ${a}, expected ${b} ± ${tolerance} m`); };
  near(bounds[1].z - bounds[0].z, def.hull.length, 'Hull length');
  near(bounds[1].x - bounds[0].x, def.hull.beam, 'Hull beam');
  near(bounds[0].y, -def.hull.draft, 'Keel datum');
  const mounts = def.mounts.map(m => {
    const index = getIndex(`${m.id}.yaw`);
    const center = new Vector3().setFromMatrixPosition(worlds.get(index)!);
    m.position.forEach((n, i) => near(center.getComponent(i), n, `${m.id} pivot ${i}`));
    const sides = barrelIds(m.weapon);
    for (const [barrel, side] of sides.entries()) {
      const pitch = getIndex(`${m.id}.${side}.elevation`), recoil = getIndex(`${m.id}.${side}.recoil`), socket = getIndex(`${m.id}.${side}.muzzle`);
      if (!gltf.nodes[index].children?.includes(pitch) || !gltf.nodes[pitch].children?.includes(recoil) || !gltf.nodes[recoil].children?.includes(socket)) throw new Error(`${m.id}: broken joint chain`);
      for (const [train, elevation] of [[0, 0], [-40, 12], [40, 25]]) {
        const bearing = (m.bearingDeg + train) * Math.PI / 180, angle = elevation * Math.PI / 180;
        const updated = frames(new Map([[index, new Matrix4().makeRotationY(-bearing)], [pitch, new Matrix4().makeRotationX(angle)]]));
        const actual = new Vector3().setFromMatrixPosition(updated.get(socket)!);
        const length = m.weapon.muzzleForward - m.weapon.trunnionForward;
        const forward = m.weapon.trunnionForward + length * Math.cos(angle);
        const lateral = m.weapon.barrelSpacing * (barrel - (sides.length - 1) / 2);
        const expected = new Vector3(m.position[0] + Math.cos(bearing) * lateral + Math.sin(bearing) * forward, m.position[1] + m.weapon.pivotHeight + length * Math.sin(angle), m.position[2] + Math.sin(bearing) * lateral - Math.cos(bearing) * forward);
        near(actual.distanceTo(expected), 0, `${m.id}.${side} muzzle at ${train}/${elevation}`);
      }
    }
    return { id: m.id, measuredPivot: center.toArray(), barrels: sides.length, articulationChecks: sides.length * 3 };
  });
  const torpedoTubes = (def.torpedoTubes ?? []).map(tube => {
    const frame = worlds.get(getIndex(`${tube.id}.muzzle`))!;
    const position = new Vector3().setFromMatrixPosition(frame);
    tube.position.forEach((n, i) => near(position.getComponent(i), n, `${tube.id} muzzle ${i}`));
    const direction = new Vector3(0, 0, -1).transformDirection(frame);
    const bearing = tube.bearingDeg * Math.PI / 180;
    near(direction.distanceTo(new Vector3(Math.sin(bearing), 0, -Math.cos(bearing))), 0, `${tube.id} direction`, .001);
    if (tube.launcherId) {
      const launcher = def.torpedoLaunchers!.find(l => l.id === tube.launcherId)!;
      const yaw = getIndex(`${launcher.id}.yaw`), socket = getIndex(`${tube.id}.muzzle`);
      if (!gltf.nodes[yaw].children?.includes(socket)) throw new Error(`${tube.id}: broken launcher joint chain`);
      const pivot = new Vector3().setFromMatrixPosition(worlds.get(yaw)!);
      near(pivot.distanceTo(new Vector3(...launcher.position)), 0, `${launcher.id} pivot`);
      for (const angle of [-140, -90, 90, 140]) {
        const rotation = new Matrix4().makeRotationY(-angle * Math.PI / 180);
        const updated = frames(new Map([[yaw, rotation]]));
        const expected = new Vector3(...tube.position).sub(pivot).applyMatrix4(rotation).add(pivot);
        near(new Vector3().setFromMatrixPosition(updated.get(socket)!).distanceTo(expected), 0, `${tube.id} trained muzzle ${angle}`);
      }
    }
    return { id: tube.id, measuredMuzzle: position.toArray(), direction: direction.toArray() };
  });
  const depthChargeLaunchers = (def.depthChargeLaunchers ?? []).map(l => {
    const actual = new Vector3().setFromMatrixPosition(worlds.get(getIndex(`${l.id}.release`))!);
    near(actual.distanceTo(new Vector3(...l.position)), 0, `${l.id} release socket`);
    return { id: l.id, measuredRelease: actual.toArray() };
  });
  const triangles = gltf.meshes.reduce((total, m) => total + m.primitives.reduce((n, p) => n + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0);
  if (triangles > 500000 || bytes.length > 30 * 1024 * 1024) throw new Error('Ship exceeds initial 500k triangle / 30 MiB export guardrails');
  return { contentHash, hullBounds: bounds.map(b => b.toArray()), mounts, torpedoTubes, depthChargeLaunchers, meshes: gltf.meshes.length, primitives: gltf.meshes.reduce((n, m) => n + m.primitives.length, 0), triangles, bytes: bytes.length, result: 'passed', historicalAccuracy: 'not certified; see reference register and discrepancy report' };
}

async function runEvidence(action: 'compare' | 'check') {
  if (!existsSync(join(sourceDir, 'modeling-spec.json'))) return;
  const child = Bun.spawn(['bun', join(root, 'scripts/reference/pipeline.ts'), action, shipId], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (action === 'compare') await writeFile(join(stage, 'evidence.log'), out + err);
  if (code) throw new Error(`Ship evidence failed:\n${out}${err}`);
  console.log(out.trim());
}

async function runBlender(script: string, extraEnv: Record<string, string> = {}) {
  const executable = process.env.BLENDER_BIN ?? (existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender');
  // Original authoring recipes cannot read the reference cache, raw game model formats or baseline scenes.
  // This audit supplements the full cache-unavailable rebuild; it does not inspect native Blender internals.
  const expression = `import sys, os, json, runpy
reads=set()
def audit(event,args):
 if event=='socket.connect': raise RuntimeError('Network access is not an authoring dependency')
 if event=='open' and isinstance(args[0],(str,bytes)):
  p=os.path.realpath(os.fsdecode(args[0]))
  if '/reference-cache' in p or p.endswith(('.model','.geometry')) or '/bismarck/baseline/' in p:
   raise RuntimeError('Reference/baseline geometry is forbidden in original authoring: '+p)
  if p.startswith(${JSON.stringify(root)}): reads.add(os.path.relpath(p,${JSON.stringify(root)}))
sys.addaudithook(audit)
runpy.run_path(${JSON.stringify(script)},run_name='__main__')
with open(${JSON.stringify(join(stage, 'authoring-reads.json'))},'w') as f: json.dump(sorted(reads),f,indent=2)
`;
  const pythonArgs = script === join(sourceDir, 'build.py') ? ['--python-expr', expression] : ['--python', script];
  const child = Bun.spawn([executable, '--background', '--factory-startup', '--python-exit-code', '1', ...pythonArgs], {
    cwd: root, env: { ...process.env, SHIP_OUTPUT: stage, SHIP_DEFINITION: join(stage, 'definition.json'), BISMARCK_SKIP_RENDER: '1', ...extraEnv }, stdout: 'pipe', stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  await writeFile(join(stage, script.endsWith('export.py') ? 'export.log' : 'build.log'), stdout + stderr);
  if (code !== 0) throw new Error(`Blender failed (${code}):\n${(stdout + stderr).slice(-6000)}`);
  console.log(`${script.split('/').at(-1)} completed; log in ${stage}`);
}

if (action === 'check') {
  const current = JSON.parse(await readFile(join(outputDir, `${shipId}.json`), 'utf8'));
  if (JSON.stringify(current) !== JSON.stringify(published)) throw new Error('Compiled definition is stale. Run bun run ship:build ' + shipId);
  const report = inspectGlb(await readFile(join(outputDir, `${shipId}.glb`)), definition);
  await checkThumbnail();
  await runEvidence('check');
  console.log(JSON.stringify(report, null, 2));
} else {
  await mkdir(resolve(stage, '..'), { recursive: true });
  const lock = stage + '.lock';
  try { await mkdir(lock); } catch { throw new Error(`Another pipeline command owns ${lock}. If a previous process was interrupted, remove that directory after confirming it has stopped.`); }
  try {
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, action, started: new Date().toISOString() }));
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, 'definition.json'), JSON.stringify(published, null, 2) + '\n');
  if (action === 'compile') {
    console.log(`Validated blueprint and compiled ${join(stage, 'definition.json')}`);
  } else if (action === 'thumbnail') {
    const bytes = await readFile(join(outputDir, `${shipId}.glb`));
    inspectGlb(bytes, definition);
    await writeFile(join(stage, 'model.glb'), bytes);
    await bakeThumbnail();
  } else if (action === 'review') {
    await copyFile(join(sourceDir, 'generated/source.blend'), join(stage, 'source.blend'));
    await runBlender(join(root, 'scripts/ships/review.py'));
    const reviewDir = join(sourceDir, 'generated/review');
    await mkdir(reviewDir, { recursive: true });
    for (const file of await readdir(join(stage, 'renders'))) if (file.endsWith('.png') || file === 'cameras.json') await copyFile(join(stage, 'renders', file), join(reviewDir, file));
    console.log(`Orthographic review views: ${reviewDir}`);
  } else {
  console.log(`Building ${shipId} (${contentHash.slice(0, 12)})`);
  await runBlender(join(sourceDir, 'build.py'));
  await runBlender(join(root, 'scripts/ships/export.py'));
  const report = inspectGlb(await readFile(join(stage, 'model.glb')), definition);
  const latestDefinition = compileShip(JSON.parse(await readFile(join(sourceDir, 'blueprint.json'), 'utf8')), JSON.parse(await readFile(join(root, 'assets/parts/guns.json'), 'utf8')));
  const latestRecipes = await readRecipes();
  if (createHash('sha256').update(JSON.stringify([latestDefinition, ...latestRecipes])).digest('hex') !== contentHash) throw new Error('Authoring inputs changed during the build. Re-run ship:build before publishing.');
  // Publish only validated output. Rename temporary siblings to avoid partial file writes.
  const products = [[join(stage, 'model.glb'), join(outputDir, `${shipId}.glb`)], [join(stage, 'definition.json'), join(outputDir, `${shipId}.json`)], [join(stage, 'source.blend'), join(sourceDir, 'generated/source.blend')]];
  for (const [from, to] of products) { await mkdir(resolve(to, '..'), { recursive: true }); await copyFile(from, to + '.tmp'); }
  for (const [, to] of products) await rename(to + '.tmp', to);
  await mkdir(join(sourceDir, 'reports'), { recursive: true });
  await writeFile(join(sourceDir, 'reports/export.json'), JSON.stringify(report, null, 2) + '\n');
  await bakeThumbnail();
  await runEvidence('compare');
  console.log(JSON.stringify(report, null, 2));
  }
  } finally { await rm(lock, { recursive: true, force: true }); }
}

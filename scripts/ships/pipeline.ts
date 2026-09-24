import { mkdir, readFile, writeFile, copyFile, rename, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { barrelOffset, barrelHeightOffset, barrelIds, compileShip, type ShipDefinition } from '../../src/ships/blueprint';
import { gunTraverseAtFraction } from '../../src/ships/armament';
import { fingerprints, geometryDefinition, fileHash, validFile } from './fingerprints';
import { mountFrame } from '../../src/game/mountFrames';
import { runBlender as runSharedBlender } from '../build/blender';

const root = resolve(import.meta.dir, '../..');
const started = performance.now();
const timings: Record<string, number | string> = {};
const force = process.argv.includes('--force');
const [action = 'check', shipId = 'bismarck'] = process.argv.slice(2);
if (!['build', 'check', 'compile', 'review', 'thumbnail'].includes(action) || !/^[a-z][a-z0-9-]{0,63}$/.test(shipId))
  throw new Error('Usage: bun scripts/ships/pipeline.ts build|check|compile|review|thumbnail <ship-id>');
if (shipId === 'all') {
  const { runFleet } = await import('./fleet');
  process.exit(await runFleet(action));
}
const sourceDir = join(root, 'assets/ships', shipId);
const stage = join(root, '.build/ships', shipId);
const catalog = JSON.parse(await readFile(join(root, 'assets/parts/guns.json'), 'utf8'));
const blueprint = JSON.parse(await readFile(join(sourceDir, 'blueprint.json'), 'utf8'));
if (blueprint.construction && !blueprint.hull) {
  const { constructionPipeline } = await import('../construction/pipeline');
  try {
    console.log(JSON.stringify(await constructionPipeline(root, action, shipId, force), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  }
  process.exit(0);
}
const definition = compileShip(blueprint, catalog);
if (definition.id !== shipId || definition.modelUrl !== `/models/${shipId}.glb`)
  throw new Error('Ship ID, directory and model URL must agree');
const inputs = await fingerprints(root, shipId, definition);
const contentHash = inputs.content;
timings.compileAndFingerprint = (performance.now() - started) / 1000;
const published = { ...definition, contentHash };
const outputDir = join(root, 'public/models');
// Presentation recipes have their own hash; changing a thumbnail does not change ship geometry.
const thumbnailRecipe = join(root, 'assets/ships/thumbnail.py');
const thumbnailRecipeHash = inputs.thumbnail;
const thumbnailDir = join(sourceDir, 'generated/thumbnail');
const thumbnailOutput = join(outputDir, `${shipId}-thumbnail.png`);

async function bakeThumbnail() {
  await runBlender(thumbnailRecipe);
  if ((await fingerprints(root, shipId, definition)).thumbnail !== thumbnailRecipeHash)
    throw new Error('Thumbnail recipe changed during rendering. Re-run ship:thumbnail.');
  const bytes = await readFile(join(stage, 'thumbnail.png'));
  const report = {
    modelHash: inputs.model,
    recipeHash: thumbnailRecipeHash,
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
  const imageHash = createHash('sha256')
    .update(await readFile(thumbnailOutput))
    .digest('hex');
  if (report.modelHash !== inputs.model || report.recipeHash !== thumbnailRecipeHash || report.imageHash !== imageHash)
    throw new Error(`Thumbnail is stale. Run bun run ship:thumbnail ${shipId}`);
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: Record<string, unknown>;
}
interface Gltf {
  nodes: GltfNode[];
  scenes: { nodes: number[]; extras?: Record<string, unknown> }[];
  scene?: number;
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  accessors: { min?: number[]; max?: number[]; count: number }[];
}
function inspectGlb(bytes: Buffer, def: ShipDefinition) {
  if (
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length ||
    bytes.readUInt32LE(16) !== 0x4e4f534a
  )
    throw new Error('Invalid GLB header');
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as Gltf;
  const scene = gltf.scenes[gltf.scene ?? 0];
  if (scene.extras?.definitionHash !== contentHash) throw new Error('GLB definition hash does not match its blueprint/recipe');
  const byId = new Map<string, number>();
  gltf.nodes.forEach((n, i) => {
    const key = n.extras?.nodeId;
    if (typeof key === 'string') {
      if (byId.has(key)) throw new Error(`Duplicate node ID ${key}`);
      byId.set(key, i);
    }
  });
  const frames = (overrides = new Map<number, Matrix4>(), recoilOffsets = new Map<number, number>()) => {
    const worlds = new Map<number, Matrix4>();
    const walk = (index: number, parent: Matrix4, ancestry: Set<number>) => {
      if (ancestry.has(index) || worlds.has(index)) throw new Error('Cyclic or multiply-parented GLB hierarchy');
      const n = gltf.nodes[index];
      if (!n) throw new Error(`Missing node ${index}`);
      const local = n.matrix
        ? new Matrix4().fromArray(n.matrix)
        : new Matrix4().compose(
            new Vector3().fromArray(n.translation ?? [0, 0, 0]),
            new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
            new Vector3().fromArray(n.scale ?? [1, 1, 1]),
          );
      if (overrides.has(index)) {
        const p = new Vector3().setFromMatrixPosition(local);
        local.copy(overrides.get(index)!);
        local.setPosition(p);
      }
      local.elements[14] += recoilOffsets.get(index) ?? 0;
      const world = parent.clone().multiply(local);
      if (!world.elements.every(Number.isFinite)) throw new Error('Nonfinite GLB transform');
      worlds.set(index, world);
      const ancestors = new Set(ancestry).add(index);
      n.children?.forEach((c) => walk(c, world, ancestors));
    };
    scene.nodes.forEach((n) => walk(n, new Matrix4(), new Set()));
    return worlds;
  };
  const worlds = frames();
  const getIndex = (id: string) => {
    const index = byId.get(id);
    if (index === undefined) throw new Error(`Missing required export node ${id}`);
    return index;
  };
  if (def.submarine)
    for (const id of Object.values(def.submarine.appendages).flat()) {
      const node = gltf.nodes[getIndex(id)];
      if (node.mesh !== undefined || !node.children?.length)
        throw new Error(`Appendage ${id} must retain an independent pivot empty and moving geometry`);
    }
  const hullIndex = getIndex('hull.surface');
  const hull = gltf.nodes[hullIndex];
  const bounds = [new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity)];
  gltf.meshes[hull.mesh!].primitives.forEach((p) => {
    const accessor = gltf.accessors[p.attributes.POSITION];
    if (!accessor.min || !accessor.max) throw new Error('Hull positions require bounds');
    for (let corner = 0; corner < 8; corner++) {
      const v = new Vector3(
        ...([0, 1, 2].map((i) => (corner & (1 << i) ? accessor.max! : accessor.min!)[i]) as [number, number, number]),
      ).applyMatrix4(worlds.get(hullIndex)!);
      bounds[0].min(v);
      bounds[1].max(v);
    }
  });
  const near = (a: number, b: number, label: string, tolerance = 0.025) => {
    if (Math.abs(a - b) > tolerance) throw new Error(`${label}: measured ${a}, expected ${b} ± ${tolerance} m`);
  };
  near(bounds[1].z - bounds[0].z, def.hull.length, 'Hull length');
  near(bounds[1].x - bounds[0].x, def.hull.beam, 'Hull beam');
  near(bounds[0].y, -def.hull.draft, 'Keel datum');
  const mounts = def.mounts.map((m, mountIndex) => {
    const index = getIndex(`${m.id}.yaw`);
    if (m.parentMountId) {
      const descendants = (index: number): number[] => [index, ...(gltf.nodes[index].children ?? []).flatMap(descendants)];
      if (!descendants(getIndex(`${m.parentMountId}.yaw`)).includes(index))
        throw new Error(`${m.id}: carried mount must descend from its parent's yaw joint`);
    }
    const center = new Vector3().setFromMatrixPosition(worlds.get(index)!);
    m.position.forEach((n, i) => near(center.getComponent(i), n, `${m.id} pivot ${i}`));
    const sides = barrelIds(m.weapon);
    for (const [barrel, side] of sides.entries()) {
      const pitch = getIndex(`${m.id}.${side}.elevation`),
        recoil = getIndex(`${m.id}.${side}.recoil`),
        socket = getIndex(`${m.id}.${side}.muzzle`);
      if (
        !gltf.nodes[index].children?.includes(pitch) ||
        !gltf.nodes[pitch].children?.includes(recoil) ||
        !gltf.nodes[recoil].children?.includes(socket)
      )
        throw new Error(`${m.id}: broken joint chain`);
      for (const [fraction, elevation] of [
        [0, 0],
        [-0.4, 12],
        [0.4, 25],
      ]) {
        const train = (gunTraverseAtFraction(m, fraction) * 180) / Math.PI;
        const bearing = ((m.bearingDeg + train) * Math.PI) / 180,
          angle = (elevation * Math.PI) / 180;
        const updated = frames(
          new Map([
            [index, new Matrix4().makeRotationY(-bearing)],
            [pitch, new Matrix4().makeRotationX(angle)],
          ]),
        );
        const actual = new Vector3().setFromMatrixPosition(updated.get(socket)!);
        const length = m.weapon.muzzleForward - m.weapon.trunnionForward;
        const forward = m.weapon.trunnionForward + length * Math.cos(angle) - barrelHeightOffset(m.weapon, barrel) * Math.sin(angle);
        const lateral = barrelOffset(m.weapon, barrel);
        const expected = new Vector3(
          m.position[0] + Math.cos(bearing) * lateral + Math.sin(bearing) * forward,
          m.position[1] + m.weapon.pivotHeight + barrelHeightOffset(m.weapon, barrel) * Math.cos(angle) + length * Math.sin(angle),
          m.position[2] + Math.sin(bearing) * lateral - Math.cos(bearing) * forward,
        );
        near(actual.distanceTo(expected), 0, `${m.id}.${side} muzzle at ${train}/${elevation}`);
      }
      if (m.parentMountId)
        for (const fraction of [-0.73, 0.38, 1]) {
          const trains = def.mounts.map((mount, i) => gunTraverseAtFraction(mount, (i % 2 ? -1 : 1) * fraction));
          const overrides = new Map(
            def.mounts.map((mount, i) => [
              getIndex(`${mount.id}.yaw`),
              new Matrix4().makeRotationY(-((mount.bearingDeg * Math.PI) / 180 + trains[i])),
            ]),
          );
          const angle = ((m.weapon.elevationMinDeg + 0.63 * (m.weapon.elevationMaxDeg - m.weapon.elevationMinDeg)) * Math.PI) / 180;
          overrides.set(pitch, new Matrix4().makeRotationX(angle));
          const recoilM = m.weapon.recoilM * 0.8;
          const updated = frames(overrides, new Map([[recoil, recoilM]]));
          const actual = new Vector3().setFromMatrixPosition(updated.get(socket)!);
          const pose = mountFrame(def, mountIndex, trains),
            length = m.weapon.muzzleForward - m.weapon.trunnionForward - recoilM;
          const vertical = barrelHeightOffset(m.weapon, barrel),
            lateral = barrelOffset(m.weapon, barrel);
          const forward = m.weapon.trunnionForward + length * Math.cos(angle) - vertical * Math.sin(angle);
          const expected = new Vector3(
            pose.x + Math.cos(pose.heading) * lateral + Math.sin(pose.heading) * forward,
            pose.y + m.weapon.pivotHeight + vertical * Math.cos(angle) + length * Math.sin(angle),
            pose.z + Math.sin(pose.heading) * lateral - Math.cos(pose.heading) * forward,
          );
          near(actual.distanceTo(expected), 0, `${m.id}.${side} carried muzzle at ${fraction}`);
        }
    }
    return {
      id: m.id,
      measuredPivot: center.toArray(),
      barrels: sides.length,
      articulationChecks: sides.length * (m.parentMountId ? 6 : 3),
    };
  });
  const torpedoTubes = (def.torpedoTubes ?? []).map((tube) => {
    const frame = worlds.get(getIndex(`${tube.id}.muzzle`))!;
    const position = new Vector3().setFromMatrixPosition(frame);
    tube.position.forEach((n, i) => near(position.getComponent(i), n, `${tube.id} muzzle ${i}`));
    const direction = new Vector3(0, 0, -1).transformDirection(frame);
    const bearing = (tube.bearingDeg * Math.PI) / 180;
    near(direction.distanceTo(new Vector3(Math.sin(bearing), 0, -Math.cos(bearing))), 0, `${tube.id} direction`, 0.001);
    if (tube.launcherId) {
      const launcher = def.torpedoLaunchers!.find((l) => l.id === tube.launcherId)!;
      const yaw = getIndex(`${launcher.id}.yaw`),
        socket = getIndex(`${tube.id}.muzzle`);
      if (!gltf.nodes[yaw].children?.includes(socket)) throw new Error(`${tube.id}: broken launcher joint chain`);
      const pivot = new Vector3().setFromMatrixPosition(worlds.get(yaw)!);
      near(pivot.distanceTo(new Vector3(...launcher.position)), 0, `${launcher.id} pivot`);
      for (const angle of [-140, -90, 90, 140]) {
        const rotation = new Matrix4().makeRotationY((-angle * Math.PI) / 180);
        const updated = frames(new Map([[yaw, rotation]]));
        const expected = new Vector3(...tube.position).sub(pivot).applyMatrix4(rotation).add(pivot);
        near(new Vector3().setFromMatrixPosition(updated.get(socket)!).distanceTo(expected), 0, `${tube.id} trained muzzle ${angle}`);
      }
    }
    return { id: tube.id, measuredMuzzle: position.toArray(), direction: direction.toArray() };
  });
  const depthChargeLaunchers = (def.depthChargeLaunchers ?? []).map((l) => {
    const actual = new Vector3().setFromMatrixPosition(worlds.get(getIndex(`${l.id}.release`))!);
    near(actual.distanceTo(new Vector3(...l.position)), 0, `${l.id} release socket`);
    return { id: l.id, measuredRelease: actual.toArray() };
  });
  for (const flag of def.rig?.ensigns ?? []) {
    const at = new Vector3().setFromMatrixPosition(worlds.get(getIndex(`${flag.id}.hoist`))!);
    near(at.distanceTo(new Vector3(...flag.position)), 0, `${flag.id} hoist`);
  }
  for (const radar of def.rig?.radars ?? []) {
    const index = getIndex(radar.nodeId);
    if (!gltf.nodes[index].children?.length) throw new Error(`${radar.id}: radar joint has no moving assembly`);
  }
  const triangles = gltf.meshes.reduce(
    (total, m) => total + m.primitives.reduce((n, p) => n + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0),
    0,
  );
  if (triangles > 500000 || bytes.length > 30 * 1024 * 1024)
    throw new Error('Ship exceeds initial 500k triangle / 30 MiB export guardrails');
  return {
    contentHash,
    hullBounds: bounds.map((b) => b.toArray()),
    mounts,
    torpedoTubes,
    depthChargeLaunchers,
    meshes: gltf.meshes.length,
    primitives: gltf.meshes.reduce((n, m) => n + m.primitives.length, 0),
    triangles,
    bytes: bytes.length,
    result: 'passed',
    historicalAccuracy: 'not certified; see ship README',
  };
}

async function runBlender(script: string, extraEnv: Record<string, string> = {}) {
  const begin = performance.now();
  const label = script.split('/').at(-1)!;
  // Original authoring recipes cannot read the reference cache, raw game model formats or baseline scenes.
  // This audit supplements the full cache-unavailable rebuild; it does not inspect native Blender internals.
  const prelude = `import os, json, time
print("SHIP_STARTUP_SECONDS",time.time()-float(os.environ["SHIP_PROCESS_START"]),flush=True)
profile=None
if os.environ.get('SHIP_PROFILE')=='1':
 import cProfile
 profile=cProfile.Profile();profile.enable()
script_start=time.perf_counter()
`;
  const epilogue = `if profile:
 profile.disable()
 profile.dump_stats(${JSON.stringify(join(stage, label + '.prof'))})
 texture_seconds=sum(entry.totaltime for entry in profile.getstats() if hasattr(entry.code,'co_name') and entry.code.co_name in {'apply_appearance','apply_paint','consolidate_finish_uvs'})
 with open(${JSON.stringify(join(stage, label + '.profile.json'))},'w') as f: json.dump({'scriptSeconds':time.perf_counter()-script_start,'textureSeconds':texture_seconds},f)
`;
  const { stdout, version } = await runSharedBlender(
    script,
    {
      SHIP_PROCESS_START: String(Date.now() / 1000),
      SHIP_OUTPUT: stage,
      SHIP_DEFINITION: join(
        stage,
        script === join(sourceDir, 'build.py') || action === 'review' ? 'geometry-definition.json' : 'definition.json',
      ),
      BISMARCK_SKIP_RENDER: '1',
      ...extraEnv,
    },
    { cwd: root, audit: { root, readsFile: join(stage, label + '.reads.json') }, prelude, epilogue, log: join(stage, label + '.log') },
  );
  timings.blenderVersion = version;
  timings[label] = (performance.now() - begin) / 1000;
  timings[label + '.startup'] = Number(stdout.match(/SHIP_STARTUP_SECONDS ([\d.]+)/)?.[1] ?? 0);
  if (script === join(sourceDir, 'build.py')) {
    const reads = JSON.parse(await readFile(join(stage, label + '.reads.json'), 'utf8')) as string[];
    const missing = reads.filter((path) => /^(assets|scripts)\//.test(path) && !(path in inputs.sources));
    if (missing.length) throw new Error(`Undeclared authoring inputs: ${missing.join(', ')}. Declare them in recipe-inputs.json.`);
  }
  console.log(`${script.split('/').at(-1)} completed; log in ${stage}`);
}

if (action === 'check') {
  const current = JSON.parse(await readFile(join(outputDir, `${shipId}.json`), 'utf8'));
  const manifest = JSON.parse(await readFile(join(sourceDir, 'generated/build.json'), 'utf8'));
  // build.json keeps one hash per stage, not per input file, so staleness names the stage whose inputs changed.
  const fields = Object.keys({ ...current, ...published }).filter(
    (key) => key !== 'contentHash' && JSON.stringify(current[key]) !== JSON.stringify((published as Record<string, unknown>)[key]),
  );
  const why = fields.length
    ? `definition fields changed: ${fields.join(', ')}`
    : manifest.geometry !== inputs.geometry
      ? 'geometry recipe inputs changed: build.py or a file listed in recipe-inputs.json'
      : 'export recipe changed: scripts/ships/export.py or a module it imports';
  if (
    JSON.stringify(current) !== JSON.stringify(published) ||
    manifest.contentHash !== contentHash ||
    manifest.geometry !== inputs.geometry
  )
    throw new Error(`${fields.length ? 'Compiled definition' : 'Published model'} is stale (${why}). Run bun run ship:build ${shipId}`);
  if (!(await validFile(join(outputDir, `${shipId}.glb`), manifest.glbHash)))
    throw new Error(
      `Published model is corrupt: public/models/${shipId}.glb does not match glbHash in build.json. Run bun run ship:build ${shipId}`,
    );
  const report = inspectGlb(await readFile(join(outputDir, `${shipId}.glb`)), definition);
  await checkThumbnail();
  console.log(JSON.stringify(report, null, 2));
} else {
  await mkdir(resolve(stage, '..'), { recursive: true });
  const lock = stage + '.lock';
  try {
    await mkdir(lock);
  } catch {
    throw new Error(
      `Another pipeline command owns ${lock}. If a previous process was interrupted, remove that directory after confirming it has stopped.`,
    );
  }
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, action, started: new Date().toISOString() }));
    await mkdir(stage, { recursive: true });
    await writeFile(
      join(stage, 'geometry-definition.json'),
      JSON.stringify({ ...geometryDefinition(definition), contentHash: inputs.geometry }),
    );
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
      for (const file of await readdir(join(stage, 'renders')))
        if (file.endsWith('.png') || file === 'cameras.json') await copyFile(join(stage, 'renders', file), join(reviewDir, file));
      console.log(`Orthographic review views: ${reviewDir}`);
    } else {
      console.log(`Building ${shipId} (${contentHash.slice(0, 12)})${force ? ' [forced: no stage reuse]' : ''}`);
      const manifestPath = join(sourceDir, 'generated/build.json');
      let cache: { geometry?: string; sourceHash?: string; contentHash?: string; glbHash?: string } = {};
      try {
        cache = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch {}
      const source = join(sourceDir, 'generated/source.blend');
      const sourceHit = !force && cache.geometry === inputs.geometry && (await validFile(source, cache.sourceHash));
      const modelHit = !force && cache.contentHash === contentHash && (await validFile(join(outputDir, `${shipId}.glb`), cache.glbHash));
      if (sourceHit) {
        await copyFile(source, join(stage, 'source.blend'));
        timings.geometry = 'cached';
      } else {
        await runBlender(join(sourceDir, 'build.py'));
        timings.geometry = 'executed';
      }
      if (modelHit) {
        await copyFile(join(outputDir, `${shipId}.glb`), join(stage, 'model.glb'));
        timings.export = 'cached';
      } else {
        await runBlender(join(root, 'scripts/ships/export.py'));
        timings.export = 'executed';
      }
      const validationStart = performance.now();
      const report = inspectGlb(await readFile(join(stage, 'model.glb')), definition);
      timings.validation = (performance.now() - validationStart) / 1000;
      const latestDefinition = compileShip(
        JSON.parse(await readFile(join(sourceDir, 'blueprint.json'), 'utf8')),
        JSON.parse(await readFile(join(root, 'assets/parts/guns.json'), 'utf8')),
      );
      if ((await fingerprints(root, shipId, latestDefinition)).content !== contentHash)
        throw new Error('Authoring inputs changed during the build. Re-run ship:build before publishing.');
      // Publish only validated output. Rename temporary siblings to avoid partial file writes.
      const products = [
        [join(stage, 'model.glb'), join(outputDir, `${shipId}.glb`)],
        [join(stage, 'definition.json'), join(outputDir, `${shipId}.json`)],
        [join(stage, 'source.blend'), join(sourceDir, 'generated/source.blend')],
      ];
      for (const [from, to] of products) {
        await mkdir(resolve(to, '..'), { recursive: true });
        await copyFile(from, to + '.tmp');
      }
      for (const [, to] of products) await rename(to + '.tmp', to);
      await writeFile(join(stage, 'export.json'), JSON.stringify(report, null, 2) + '\n');
      await writeFile(
        manifestPath + '.tmp',
        JSON.stringify(
          {
            version: 1,
            geometry: inputs.geometry,
            contentHash,
            sourceHash: await fileHash(source),
            glbHash: await fileHash(join(outputDir, `${shipId}.glb`)),
          },
          null,
          2,
        ) + '\n',
      );
      await rename(manifestPath + '.tmp', manifestPath);
      let thumbnailHit = false;
      if (!force)
        try {
          await checkThumbnail();
          thumbnailHit = true;
        } catch {}
      if (thumbnailHit) timings.thumbnail = 'cached';
      else {
        await bakeThumbnail();
        timings.thumbnail = 'executed';
      }
      timings.total = (performance.now() - started) / 1000;
      await writeFile(join(stage, 'timings.json'), JSON.stringify(timings, null, 2) + '\n');
      if (process.env.SHIP_TIMINGS_DIR) {
        const directory = resolve(root, process.env.SHIP_TIMINGS_DIR);
        if (!directory.startsWith(join(root, '.build') + '/')) throw new Error('SHIP_TIMINGS_DIR must be below .build/');
        await mkdir(directory, { recursive: true });
        const detail: Record<string, unknown> = { shipId, force, ...timings };
        if (timings.export === 'executed') detail.exportStages = JSON.parse(await readFile(join(stage, 'export-timings.json'), 'utf8'));
        if (process.env.SHIP_PROFILE === '1')
          for (const label of ['build.py', 'export.py', 'thumbnail.py']) {
            if (label in timings) detail[label + '.profile'] = JSON.parse(await readFile(join(stage, label + '.profile.json'), 'utf8'));
          }
        await writeFile(join(directory, shipId + '.json'), JSON.stringify(detail, null, 2) + '\n');
      }
      console.log(JSON.stringify(timings));
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

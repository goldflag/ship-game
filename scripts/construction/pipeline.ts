import { readFile, writeFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { barrelIds, type ShipDefinition } from '../../src/ships/blueprint';
import { digest, readSource, readCatalog } from './files';
import { compileConstruction } from './compiler';
import { withConstructionBrowser } from './browser';
import type { ReviewView } from '../../tools/construction/review';

export const REVIEW_VIEWS: ReviewView[] = ['profile', 'plan', 'bow', 'stern', 'quarter'];
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const producerFiles = ['src/game/constructionModel.ts', 'src/game/constructionPropellerModel.ts', 'src/game/constructionShading.ts', 'src/ships/constructionEquipment.ts', 'src/ships/constructionPaints.ts', 'src/ships/constructionHullPaint.ts', 'src/game/loadShipModel.ts', 'tools/construction/review.ts', 'scripts/construction/pipeline.ts', 'assets/ships/appearance/finishes.json', 'crates/naval-wasm/src/lib.rs', 'crates/naval-sim/src/catalog.rs', 'crates/naval-sim/src/mount_clearance.rs'];
export async function constructionProducerHash(root: string) {
  const files = [...producerFiles, ...((await readdir(join(root, 'crates/naval-sim/src'))).filter(n => n.startsWith('construction') && n.endsWith('.rs')).map(n => 'crates/naval-sim/src/' + n))];
  const parts = await Promise.all(files.map(async file => file + ':' + digest(await readFile(join(root, file)))));
  return digest(parts.join('\n'));
}
/** Read-only GLB integrity checks never trust a stored success flag. */
export function inspectConstructionGlb(bytes: Buffer, definition: ShipDefinition) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid construction GLB.');
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  if (gltf.scenes?.[gltf.scene ?? 0]?.extras?.definitionHash !== definition.contentHash) throw new Error('Construction GLB/definition hash mismatch.');
  const nodes = new Map<string, number>();
  gltf.nodes.forEach((node: { extras?: { nodeId?: string }; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }, i: number) => {
    const id = node.extras?.nodeId;
    if (id) { if (nodes.has(id)) throw new Error('Duplicate construction node ' + id); nodes.set(id, i); }
    if ([...node.matrix ?? [], ...node.translation ?? [], ...node.rotation ?? [], ...node.scale ?? []].some(n => !Number.isFinite(n))) throw new Error('Nonfinite construction transform.');
  });
  const required = (id: string) => { const index = nodes.get(id); if (index === undefined) throw new Error('Missing construction joint/socket ' + id); return index; };
  for (const mount of definition.mounts) {
    const yaw = required(mount.id + '.yaw');
    for (const barrel of barrelIds(mount.weapon)) {
      const chain = [yaw, ...['elevation', 'recoil', 'muzzle'].map(k => required(mount.id + '.' + barrel + '.' + k))];
      for (let i = 1; i < chain.length; i++) if (!gltf.nodes[chain[i - 1]].children?.includes(chain[i])) throw new Error('Broken construction articulation chain: ' + mount.id);
    }
  }
  if (!gltf.meshes?.length || gltf.buffers?.some((b: { uri?: string }) => b.uri)) throw new Error('Construction models must contain embedded mesh buffers.');
  return { nodes: nodes.size, meshes: gltf.meshes.length };
}

export async function constructionPipeline(root: string, action: string, id: string, force = false) {
  const sourceFile = await readSource(root, id), { source } = sourceFile;
  const result = await compileConstruction(root, source);
  const stage = join(root, '.build/ships', id), sourceDir = join(root, 'assets/ships', id), output = join(root, 'public/models');
  if (!result.definition || result.diagnostics.some(d => d.severity === 'error')) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const producer = await constructionProducerHash(root);
  const catalog = await readCatalog(root, source.construction.catalogRevision);
  // Verify exact retained component bytes; never substitute the current catalog.
  for (const partId of new Set(source.construction.equipment.map(p => p.partId))) {
    const part = catalog.equipment.find(p => p.id === partId)!;
    const path = join(root, 'public', part.modelUrl);
    const manifest = JSON.parse(await readFile(join(dirname(path), 'manifest.json'), 'utf8'));
    if (manifest.contentHash !== part.contentHash || manifest.modelSha256 !== digest(await readFile(path))) throw new Error('Published component integrity failure: ' + partId);
  }
  const contentHash = digest(result.contentHash + ':' + producer);
  const definition: ShipDefinition = { ...result.definition, id, modelUrl: '/models/' + id + '.glb', contentHash };
  // Derived convex geometry is large; indentation can triple this runtime asset.
  // Keep editable source and small manifests readable, but ship compact JSON.
  const definitionJson = JSON.stringify(definition) + '\n';
  const paths = { model: join(output, id + '.glb'), definition: join(output, id + '.json'), thumbnail: join(output, id + '-thumbnail.png'), manifest: join(sourceDir, 'generated/build.json') };
  const check = async (includeThumbnail = true) => {
    const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
    if (manifest.format !== 'construction-v1' || manifest.contentHash !== contentHash || manifest.sourceHash !== sourceFile.hash) throw new Error('Constructed ship is stale. Run bun run ship:build ' + id);
    const [model, def] = await Promise.all([readFile(paths.model), readFile(paths.definition)]);
    if (digest(model) !== manifest.modelHash || digest(def) !== manifest.definitionHash) throw new Error('Constructed ship output changed. Run bun run ship:build ' + id);
    if (includeThumbnail) {
      const thumbnail = await readFile(paths.thumbnail).catch(() => undefined);
      if (!thumbnail || digest(thumbnail) !== manifest.thumbnailHash) throw new Error('Constructed thumbnail changed or is missing. Run bun run ship:thumbnail ' + id);
    }
    if (def.toString() !== definitionJson) throw new Error('Published construction definition differs from the native compiler.');
    inspectConstructionGlb(model, definition);
    return manifest;
  };
  if (action === 'check') { await check(); return { id, action, contentHash }; }
  await mkdir(stage, { recursive: true });
  if (action === 'compile') {
    await writeFile(join(stage, 'definition.json'), definitionJson);
    await writeFile(join(stage, 'construction-result.json'), json(result));
    return { id, action, contentHash, path: join(stage, 'definition.json'), diagnostics: result.diagnostics };
  }
  const lock = stage + '.lock';
  try { await mkdir(lock); } catch { throw new Error('Another pipeline owns ' + id + '. Wait for it to finish.'); }
  try {
    if (action === 'build' && !force) { try { await check(); return { id, action, reused: true, contentHash }; } catch { /* Rebuild genuinely stale output. */ } }
    if (action !== 'build') await check(action !== 'thumbnail');
    const assertCurrent = async () => {
      if ((await readSource(root, id)).hash !== sourceFile.hash || (await constructionProducerHash(root)) !== producer) throw new Error('Authoring inputs changed during build. Re-run ship:' + action + '.');
    };
    const atomic = async (path: string, bytes: string | Uint8Array) => { await mkdir(dirname(path), { recursive: true }); const temporary = path + '.tmp'; await writeFile(temporary, bytes); await rename(temporary, path); };
    const input = { source, result, definition };
    const captured = await withConstructionBrowser(root, action === 'build' ? input : { ...input, modelUrl: definition.modelUrl }, async page => {
      if (action === 'build') {
        const glb = await page.evaluate(() => window.constructionReview!.exportGlb());
        const bytes = Buffer.from(glb.slice(glb.indexOf(',') + 1), 'base64');
        inspectConstructionGlb(bytes, definition);
        await writeFile(join(stage, 'model.glb'), bytes);
        await writeFile(join(stage, 'definition.json'), definitionJson);
        await assertCurrent();
        await page.evaluate(async modelUrl => {
          window.constructionReview!.dispose();
          window.constructionReview = await window.constructionReviewModule!.openReview({ ...window.constructionReviewInput!, modelUrl });
        }, '/@fs' + join(stage, 'model.glb'));
      }
      const articulation = await page.evaluate(() => window.constructionReview!.sweep());
      if (articulation.maxMuzzleErrorM > .025) throw new Error('Exported articulation diverges from CPU poses.');
      const thumbnail = await page.evaluate(() => window.constructionReview!.render('profile', { width: 600, height: 180, transparent: true }));
      const views = [];
      if (action !== 'thumbnail') for (const name of REVIEW_VIEWS) views.push(await page.evaluate(name => window.constructionReview!.render(name), name));
      return { articulation, thumbnail, views };
    });
    await assertCurrent();
    if (action === 'build') {
      await atomic(paths.model, await readFile(join(stage, 'model.glb')));
      await atomic(paths.definition, definitionJson);
    }
    const png = (data: string) => Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    if (action !== 'review') {
      await atomic(paths.thumbnail, png(captured.thumbnail.png));
      await atomic(join(sourceDir, 'generated/thumbnail/render.json'), json({ contentHash, imageHash: digest(png(captured.thumbnail.png)), camera: captured.thumbnail.camera }));
    }
    if (captured.views.length) {
      for (const view of captured.views) await atomic(join(sourceDir, 'generated/review', view.camera.name + '.png'), png(view.png));
      await atomic(join(sourceDir, 'generated/review/cameras.json'), json({ contentHash, views: captured.views.map(v => v.camera) }));
    }
    await writeFile(join(stage, 'articulation.json'), json(captured.articulation));
    const manifest = { format: 'construction-v1', sourceHash: sourceFile.hash, producerHash: producer, contentHash, sourceRevision: source.revision,
      modelHash: digest(await readFile(paths.model)), definitionHash: digest(await readFile(paths.definition)), thumbnailHash: digest(await readFile(paths.thumbnail)) };
    await atomic(paths.manifest, json(manifest));
    await check();
    return { id, action, contentHash, diagnostics: result.diagnostics, articulation: { samples: captured.articulation.samples, maxMuzzleErrorM: captured.articulation.maxMuzzleErrorM, blockedSamples: captured.articulation.blocked.length }, model: paths.model };
  } finally { await rm(lock, { recursive: true, force: true }); }
}

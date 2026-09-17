import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { barrelIds, type ShipDefinition } from '../../src/ships/blueprint';
import { digest, readSource, readCatalog } from './files';
import { compileConstruction } from './compiler';
import { withConstructionBrowser } from './browser';
import { constructionFingerprints } from './fingerprints';
import { canonical, definitionData, hash, modelPayloadHash, publishedDefinition, sealModel } from './artifacts';
import type { ReviewView } from '../../tools/construction/review';

export const REVIEW_VIEWS: ReviewView[] = ['profile', 'plan', 'bow', 'stern', 'quarter'];
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
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

export async function constructionPipeline(root: string, action: string, id: string, force = false, services = { compileConstruction, withConstructionBrowser }) {
  const sourceFile = await readSource(root, id), { source } = sourceFile;
  const result = await services.compileConstruction(root, source);
  const stage = join(root, '.build/ships', id), sourceDir = join(root, 'assets/ships', id), output = join(root, 'public/models');
  if (!result.definition || result.diagnostics.some(d => d.severity === 'error')) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const inputs = await constructionFingerprints(root, source, result);
  const catalog = await readCatalog(root, source.construction.catalogRevision);
  // Verify exact retained component bytes; never substitute the current catalog.
  for (const partId of new Set(source.construction.equipment.map(p => p.partId))) {
    const part = catalog.equipment.find(p => p.id === partId)!;
    const path = join(root, 'public', part.modelUrl);
    const manifest = JSON.parse(await readFile(join(dirname(path), 'manifest.json'), 'utf8'));
    if (manifest.contentHash !== part.contentHash || manifest.modelSha256 !== digest(await readFile(path))) throw new Error('Published component integrity failure: ' + partId);
  }
  // Compile has a provisional definition identity. Publication combines the
  // actual exported visual payload with definition data, never tool source bytes.
  let definition: ShipDefinition = { ...definitionData(result.definition, id), contentHash: inputs.definition };
  const paths = { model: join(output, id + '.glb'), definition: join(output, id + '.json'), thumbnail: join(output, id + '-thumbnail.png'), manifest: join(sourceDir, 'generated/build.json') };
  const readManifest = () => readFile(paths.manifest, 'utf8').then(JSON.parse);
  const imageInput = (payloadHash: string) => hash([payloadHash, inputs.presentation, source.revision,
    definition.mounts.map(m => [m.id, m.initialElevationDeg ?? 0])]);
  const intact = async (path: string, expected?: string) => !!expected && await readFile(path).then(bytes => digest(bytes) === expected, () => false);
  const checkImages = async (manifest: any, review = true) => {
    if (manifest.imageInput !== imageInput(manifest.payloadHash) || !await intact(paths.thumbnail, manifest.thumbnailHash) || !await intact(join(sourceDir, 'generated/thumbnail/render.json'), manifest.thumbnailMetadataHash)) throw new Error('Constructed thumbnail is stale. Run bun run ship:thumbnail ' + id);
    if (review && (manifest.reviewInput !== imageInput(manifest.payloadHash) || !await intact(join(sourceDir, 'generated/review/cameras.json'), manifest.reviewMetadataHash) || !(await Promise.all(REVIEW_VIEWS.map(name => intact(join(sourceDir, 'generated/review', name + '.png'), manifest.reviewHashes?.[name])))).every(Boolean))) throw new Error('Constructed review is stale. Run bun run ship:review ' + id);
  };
  const checkModel = async () => {
    const manifest = await readManifest();
    if (manifest.format !== 'construction-v2' || manifest.inputs?.definition !== inputs.definition || manifest.inputs?.model !== inputs.model) throw new Error('Constructed ship is stale. Run bun run ship:build ' + id);
    const [model, def] = await Promise.all([readFile(paths.model), readFile(paths.definition)]);
    if (digest(model) !== manifest.modelHash || digest(def) !== manifest.definitionHash) throw new Error('Constructed ship output changed. Run bun run ship:build ' + id);
    definition = publishedDefinition(result.definition!, id, model);
    if (manifest.contentHash !== definition.contentHash || manifest.payloadHash !== modelPayloadHash(model) || def.toString() !== canonical(definition) + '\n') throw new Error('Published construction definition differs from the native compiler or model.');
    inspectConstructionGlb(model, definition);
    return manifest;
  };
  if (action === 'check') { const manifest = await checkModel(); await checkImages(manifest); return { id, action, contentHash: definition.contentHash }; }
  await mkdir(stage, { recursive: true });
  if (action === 'compile') {
    await writeFile(join(stage, 'definition.json'), canonical(definition) + '\n');
    await writeFile(join(stage, 'construction-result.json'), json(result));
    return { id, action, definitionInput: inputs.definition, path: join(stage, 'definition.json'), diagnostics: result.diagnostics };
  }
  const lock = stage + '.lock';
  try { await mkdir(lock); } catch { throw new Error('Another pipeline owns ' + id + '. Wait for it to finish.'); }
  try {
    let modelValid = false;
    try { await checkModel(); modelValid = true; } catch (error) { if (action !== 'build') throw error; }
    const previous = await readManifest().catch(() => undefined);
    if (action === 'build' && modelValid && !force) {
      try { await checkImages(previous); return { id, action, reused: true, contentHash: definition.contentHash }; } catch { /* Refresh only stale image stages. */ }
    }
    const exportNeeded = action === 'build' && (!modelValid || force);
    const assertCurrent = async () => {
      const current = await readSource(root, id);
      if (current.hash !== sourceFile.hash || canonical(await readCatalog(root, source.construction.catalogRevision)) !== canonical(catalog)
        || canonical(await constructionFingerprints(root, current.source, await services.compileConstruction(root, current.source))) !== canonical(inputs)) throw new Error('Authoring inputs changed during build. Re-run ship:' + action + '.');
      // Components are immutable inputs; detect changes during the browser work.
      for (const partId of new Set(source.construction.equipment.map(p => p.partId))) {
        const part = catalog.equipment.find(p => p.id === partId)!;
        const path = join(root, 'public', part.modelUrl);
        const manifest = JSON.parse(await readFile(join(dirname(path), 'manifest.json'), 'utf8'));
        if (manifest.contentHash !== part.contentHash || manifest.modelSha256 !== digest(await readFile(path))) throw new Error('Published component changed during build: ' + partId);
      }
    };
    const atomic = async (path: string, bytes: string | Uint8Array) => {
      const existing = await readFile(path).catch(() => undefined);
      if (existing?.equals(Buffer.from(bytes))) return;
      await mkdir(dirname(path), { recursive: true }); const temporary = path + '.tmp'; await writeFile(temporary, bytes); await rename(temporary, path);
    };
    let payloadHash = previous?.payloadHash as string;
    const input = { source, result, definition };
    const captured = await services.withConstructionBrowser(root, exportNeeded ? input : { ...input, modelUrl: definition.modelUrl }, async page => {
      if (exportNeeded) {
        const glb = await page.evaluate(() => window.constructionReview!.exportGlb());
        const candidate = Buffer.from(glb.slice(glb.indexOf(',') + 1), 'base64');
        inspectConstructionGlb(candidate, definition);
        definition = publishedDefinition(result.definition!, id, candidate);
        // Seal only this freshly exported candidate, then reload and verify its
        // exact bytes before publication. Retained stale outputs are never patched.
        const bytes = sealModel(candidate, definition.contentHash!);
        payloadHash = modelPayloadHash(bytes);
        inspectConstructionGlb(bytes, definition);
        await writeFile(join(stage, 'model.glb'), bytes);
        await writeFile(join(stage, 'definition.json'), canonical(definition) + '\n');
        await page.evaluate(async stageUrl => {
          window.constructionReview!.dispose();
          const definition = await fetch(stageUrl + '/definition.json').then(r => r.json());
          window.constructionReview = await window.constructionReviewModule!.openReview({ ...window.constructionReviewInput!, definition, modelUrl: stageUrl + '/model.glb' });
        }, '/@fs' + stage);
      }
      const articulation = await page.evaluate(() => window.constructionReview!.sweep());
      if (articulation.maxMuzzleErrorM > .025) throw new Error('Exported articulation diverges from CPU poses.');
      const imagesMatch = previous?.format === 'construction-v2' && previous.imageInput === imageInput(payloadHash);
      const thumbnailNeeded = action !== 'review' && (force || action === 'thumbnail' || !imagesMatch || !await intact(paths.thumbnail, previous?.thumbnailHash) || !await intact(join(sourceDir, 'generated/thumbnail/render.json'), previous?.thumbnailMetadataHash));
      const reviewNeeded = action !== 'thumbnail' && (force || action === 'review' || previous?.reviewInput !== imageInput(payloadHash) || !await intact(join(sourceDir, 'generated/review/cameras.json'), previous?.reviewMetadataHash)
        || !(await Promise.all(REVIEW_VIEWS.map(name => intact(join(sourceDir, 'generated/review', name + '.png'), previous?.reviewHashes?.[name])))).every(Boolean));
      const thumbnail = thumbnailNeeded ? await page.evaluate(() => window.constructionReview!.render('profile', { width: 600, height: 180, transparent: true })) : undefined;
      const views = [];
      if (reviewNeeded) for (const name of REVIEW_VIEWS) views.push(await page.evaluate(name => window.constructionReview!.render(name), name));
      return { articulation, thumbnail, views };
    });
    await assertCurrent();
    if (!exportNeeded) await checkModel();
    if (exportNeeded) {
      await atomic(paths.model, await readFile(join(stage, 'model.glb')));
      await atomic(paths.definition, canonical(definition) + '\n');
    }
    const contentHash = definition.contentHash!;
    const png = (data: string) => Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    if (captured.thumbnail) {
      await atomic(paths.thumbnail, png(captured.thumbnail.png));
      await atomic(join(sourceDir, 'generated/thumbnail/render.json'), json({ contentHash, imageHash: digest(png(captured.thumbnail.png)), camera: captured.thumbnail.camera }));
    } else if (action !== 'review') {
      const path = join(sourceDir, 'generated/thumbnail/render.json');
      const retained = JSON.parse(await readFile(path, 'utf8'));
      await atomic(path, json({ ...retained, contentHash, camera: { ...retained.camera, contentHash } }));
    }
    if (captured.views.length) {
      for (const view of captured.views) await atomic(join(sourceDir, 'generated/review', view.camera.name + '.png'), png(view.png));
      await atomic(join(sourceDir, 'generated/review/cameras.json'), json({ contentHash, views: captured.views.map(v => v.camera) }));
    } else if (action !== 'thumbnail') {
      const path = join(sourceDir, 'generated/review/cameras.json');
      const retained = JSON.parse(await readFile(path, 'utf8'));
      await atomic(path, json({ ...retained, contentHash, views: retained.views.map((v: object) => ({ ...v, contentHash })) }));
    }
    await writeFile(join(stage, 'articulation.json'), json(captured.articulation));
    const manifest = { format: 'construction-v2', inputs: { definition: inputs.definition, model: inputs.model }, contentHash, sourceRevision: source.revision, payloadHash,
      imageInput: captured.thumbnail ? imageInput(payloadHash) : previous?.imageInput,
      reviewInput: captured.views.length ? imageInput(payloadHash) : previous?.reviewInput,
      modelHash: digest(await readFile(paths.model)), definitionHash: digest(await readFile(paths.definition)), thumbnailHash: captured.thumbnail ? digest(png(captured.thumbnail.png)) : previous?.thumbnailHash,
      thumbnailMetadataHash: action !== 'review' ? digest(await readFile(join(sourceDir, 'generated/thumbnail/render.json'))) : previous?.thumbnailMetadataHash,
      reviewMetadataHash: action !== 'thumbnail' ? digest(await readFile(join(sourceDir, 'generated/review/cameras.json'))) : previous?.reviewMetadataHash,
      reviewHashes: captured.views.length ? Object.fromEntries(captured.views.map(view => [view.camera.name, digest(png(view.png))])) : previous?.reviewHashes };
    await atomic(paths.manifest, json(manifest));
    await checkModel();
    if (action === 'build') await checkImages(manifest);
    return { id, action, contentHash, exported: exportNeeded, renderedThumbnail: !!captured.thumbnail, renderedViews: captured.views.length,
      diagnostics: result.diagnostics, articulation: { samples: captured.articulation.samples, maxMuzzleErrorM: captured.articulation.maxMuzzleErrorM, blockedSamples: captured.articulation.blocked.length }, model: paths.model };
  } finally { await rm(lock, { recursive: true, force: true }); }
}

import { ConstructionClient } from '../../src/ships/constructionClient';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createConstructionHistory, editConstruction } from '../../src/ships/constructionHistory';
import { openConstructionStore } from '../../src/ships/constructionStore';
import type { ConstructionCatalog, ConstructionSource } from '../../src/ships/blueprint';

/** Explicit source fixture; every physical result is derived by native compilation.
 * The large hull is a synthetic rectangular cargo envelope, not a fidelity claim. */
export function constructionPerformanceSources(catalog: ConstructionCatalog): ConstructionSource[] {
  const small = createStarterSource(catalog);
  const large = createStarterSource(catalog);
  large.name = 'Large synthetic cargo envelope';
  large.construction.defaultThicknessMm = 300;
  large.construction.primitives = [
    { id: 'hull', kind: 'box', size: [48, 30, 250], position: [0, -12.5, -101], rotationDeg: 0 },
    { id: 'bow', kind: 'wedge', size: [48, 30, 32], position: [0, -12.5, -242], rotationDeg: 180 },
  ];
  large.construction.surfaces = [];
  large.construction.boundaries.push({ id: 'machinery-deck', axis: 'y', offset: -2.5, thicknessMm: 12 });
  large.construction.equipment.find(part => part.id === 'rudder')!.position[1] -= 25;
  large.construction.equipment.find(part => part.id === 'screw')!.position[1] = -26;
  return [small, large];
}

/** Browser-only timings for source edits, worker compilation and transactional saves.
 * Includes the first worker/WASM load; excludes 3D composition, launch and battles. */
export async function measureConstructionEditing() {
  const catalog = await loadConstructionCatalog();
  const client = new ConstructionClient();
  const databaseName = `construction-perf-${crypto.randomUUID()}`;
  const store = await openConstructionStore({ name: databaseName });
  const samples = [];
  try {
    for (const source of constructionPerformanceSources(catalog)) {
      const before = performance.now();
      const result = await client.compile(source);
      const compileMs = performance.now() - before;
      if (!result.definition || !result.loading) throw new Error(`${source.name}: ${result.diagnostics.map(diagnostic => diagnostic.message).join('; ')}`);
      let history = createConstructionHistory(source);
      const editStart = performance.now();
      for (let edit = 0; edit < 50; edit++) history = editConstruction(history, 'Rename fixture', draft => { draft.name = `${source.name} ${edit}`; });
      const sourceEditMeanMs = (performance.now() - editStart) / 50;
      const savedAt = performance.now();
      const revision = await store.save({ designId: source.id, source, name: source.name, schemaVersion: source.schemaVersion, catalogRevision: catalog.revision, expectedRevisionId: null });
      const saveMs = performance.now() - savedAt;
      const reloadAt = performance.now();
      const reloaded = await store.load(source.id);
      const reloadMs = performance.now() - reloadAt;
      if (reloaded.revision.sourceJson !== revision.sourceJson) throw new Error('Source changed on save/reload');
      const edit = structuredClone(source); edit.revision = crypto.randomUUID(); edit.name += ' revised';
      const recompileAt = performance.now();
      await client.compile(edit);
      samples.push({ name: source.name, primitives: source.construction.primitives.length, equipment: source.construction.equipment.length,
        boundaries: source.construction.boundaries.length, nativeSurfacePatches: result.surfaces.length,
        nativeMassTonnes: result.loading ? result.loading.massKg / 1000 : null,
        launchable: !!result.definition, diagnostics: result.diagnostics,
        sourceBytes: new TextEncoder().encode(revision.sourceJson).length, compileMs, warmRecompileMs: performance.now() - recompileAt,
        sourceEditMeanMs, saveMs, reloadMs });
    }
    return { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      catalogRevision: catalog.revision, scope: 'Source edit/history, real module worker/WASM compilation and IndexedDB transaction; no render/launch/battle timings', samples };
  } finally { client.dispose(); store.close(); indexedDB.deleteDatabase(databaseName); }
}

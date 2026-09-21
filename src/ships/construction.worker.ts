import init, { ConstructionCompiler, simulation_build, suggest_construction } from '../generated/naval-wasm/naval_wasm';
import type { ConstructionSource } from './blueprint';
import { loadConstructionCatalog } from './constructionEquipment';
import { cachedConstructionCompile } from './constructionCompileCache';

const ready = init();
let catalog: ReturnType<typeof loadConstructionCatalog> | undefined;
let catalogRevision: string | undefined;
let compiler: ConstructionCompiler | undefined;
// The client sends one request at a time and coalesces superseded revisions.
self.onmessage = async (event: MessageEvent<{ type: 'compile' | 'suggest'; id: number; source: ConstructionSource; partIds?: string[] }>) => {
  const { id, source } = event.data;
  try {
    if (!['compile', 'suggest'].includes(event.data.type)) throw new Error('Unknown compiler request.');
    const revision = source.construction.catalogRevision;
    if (catalogRevision !== revision) { catalogRevision = revision; catalog = loadConstructionCatalog(revision); }
    const [, parts] = await Promise.all([ready, catalog!]);
    if (event.data.type === 'suggest') {
      const suggestion = JSON.parse(suggest_construction(JSON.stringify(source), JSON.stringify(parts), JSON.stringify(event.data.partIds ?? [])));
      self.postMessage({ id, sourceId: source.id, revision: source.revision, suggestion });
    } else {
      const sourceJson = JSON.stringify(source), catalogJson = JSON.stringify(parts);
      const resultJson = await cachedConstructionCompile(simulation_build(), sourceJson, catalogJson, () => {
        compiler ??= new ConstructionCompiler();
        return compiler.compile(sourceJson, catalogJson);
      });
      // WASM already produced JSON. Parsing here would make postMessage clone
      // hundreds of thousands of geometry arrays before the editor can use them.
      self.postMessage({ id, resultJson });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};

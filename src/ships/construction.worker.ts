import init, { compile_construction, suggest_construction } from '../generated/naval-wasm/naval_wasm';
import type { ConstructionSource } from './blueprint';
import { loadConstructionCatalog } from './constructionEquipment';

const ready = init();
let catalog: ReturnType<typeof loadConstructionCatalog> | undefined;
let catalogRevision: string | undefined;
// Dedicated editor worker: replacing a source terminates synchronous native work.
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
      const result = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(parts)));
      self.postMessage({ id, result });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};

import { ConstructionClient } from './constructionClient';
import { decodeConstructionSource } from './constructionEditor';
import { openConstructionStore, readConstructionSource } from './constructionStore';
import { localShips, registerLocalShip, removeLocalShip } from './localShips';

/** Restore launchable revisions from source; missing/corrupt drafts remain in
 * IndexedDB and are listed by the editor's recovery library. */
export async function restoreLocalShips(signal?: AbortSignal): Promise<string[]> {
  const issues: string[] = [], store = await openConstructionStore(), compiler = new ConstructionClient();
  try {
    for (const head of await store.list()) {
      if (signal?.aborted) break;
      try {
        const { revision } = await store.load(head.id);
        const { source } = readConstructionSource(revision, { schemaVersion: 1, catalogRevision: revision.catalogRevision, decode: decodeConstructionSource });
        if (localShips().some(r => r.source.id === source.id && r.source.revision === source.revision)) continue;
        const result = await compiler.compile(source, signal);
        if (result.definition && !result.diagnostics.some(d => d.severity === 'error')) registerLocalShip(source, result);
        else { removeLocalShip(source.id); issues.push(`${head.name}: ${result.diagnostics.find(d => d.severity === 'error')?.message ?? 'Open this draft to finish its hull.'}`); }
      } catch (error) {
        if (signal?.aborted) break;
        removeLocalShip(head.id); issues.push(`${head.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally { compiler.dispose(); store.close(); }
  return issues;
}

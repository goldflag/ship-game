import { decodeConstructionResult } from '../../src/ships/constructionTransport';
import { ConstructionClient } from '../../src/ships/constructionClient';
import { cachedConstructionCompile, CONSTRUCTION_COMPILE_CACHE } from '../../src/ships/constructionCompileCache';
import { loadConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import version from '../../src/generated/naval-version.json';

/** A real WASM worker must leave a reusable result before it can be disposed. */
export async function checkConstructionCompileCache() {
  const catalog = await loadConstructionCatalog();
  const source = createStarterSource(catalog, 'blank');
  // Exercise the browser's real CompressionStream APIs, including corruption repair.
  const large = JSON.stringify({ padding: 'exact coordinates '.repeat(10000) });
  const proof = await caches.open('construction-compression-check');
  const storage = { open: async () => proof };
  try {
    let calls = 0;
    const compile = () => { calls++; return large; };
    await cachedConstructionCompile('test', 'source', 'catalog', compile, storage);
    const [key] = await proof.keys(), entry = (await proof.match(key))!;
    if (entry.headers.get('X-Construction-Compression') !== 'gzip'
      || (await entry.arrayBuffer()).byteLength >= large.length / 4) throw new Error('Result cache did not compress large JSON.');
    if (await cachedConstructionCompile('test', 'source', 'catalog', compile, storage) !== large || calls !== 1) throw new Error('Compressed cache changed output.');
    await proof.put(key, new Response('broken gzip', { headers: { 'X-Construction-Compression': 'gzip' } }));
    if (await cachedConstructionCompile('test', 'source', 'catalog', compile, storage) !== large || Number(calls) !== 2) throw new Error('Corrupt compressed cache was not repaired.');
  } finally { await caches.delete('construction-compression-check'); }

  await caches.delete(CONSTRUCTION_COMPILE_CACHE);
  const first = new ConstructionClient();
  const start = performance.now();
  let cold;
  try { cold = await first.compile(source); } finally { first.dispose(); }
  const coldMs = performance.now() - start;
  if (!cold.definition) throw new Error('Fixture must compile to a launchable ship.');
  const stored = await cachedConstructionCompile(version.simulationBuild, JSON.stringify(source), JSON.stringify(catalog), () => {
    throw new Error('The terminated worker did not persist its result.');
  });
  if (JSON.stringify(decodeConstructionResult(stored)) !== JSON.stringify(cold)) throw new Error('Cached output changed.');
  const second = new ConstructionClient();
  const warmStart = performance.now();
  try {
    const warm = await second.compile(source);
    if (JSON.stringify(warm) !== JSON.stringify(cold)) throw new Error('Fresh worker returned a different ship.');
    // Revision IDs can be retained by imports: exact source content still invalidates the cache.
    const changed = await second.compile({ ...source, name: 'Changed without a new revision ID' });
    if (changed.contentHash === cold.contentHash || changed.definition?.name !== 'Changed without a new revision ID') throw new Error('An edited design reused a stale result.');
    return { coldMs, warmAndEditMs: performance.now() - warmStart };
  } finally { second.dispose(); await caches.delete(CONSTRUCTION_COMPILE_CACHE); }
}

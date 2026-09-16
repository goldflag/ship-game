import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repositoryStore, readSource } from './files';
import type { ConstructionSource } from '../../src/ships/blueprint';
import { constructionFiles } from './server';
import { createServer } from 'vite';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'construction-files-')); roots.push(root);
  const revision = 'a'.repeat(64);
  await mkdir(join(root, 'public/models/components/catalogs', revision), { recursive: true });
  await writeFile(join(root, 'public/models/components/catalogs', revision, 'catalog.json'), JSON.stringify({ ...JSON.parse(await readFile(new URL('../../public/models/components/catalog.json', import.meta.url), 'utf8')), revision }));
  const source: ConstructionSource = { schemaVersion: 1, id: 'example', name: 'Example', revision: 'one', coordinates: 'meters-y-up-bow-negative-z',
    construction: { version: 1, catalogRevision: revision, defaultThicknessMm: 10, primitives: [{ id: 'hull', kind: 'box', position: [0, 0, 0], size: [10, 4, 20], rotationDeg: 0 }], equipment: [], surfaces: [], boundaries: [], loads: [] } };
  const input = { designId: source.id, name: source.name, source, schemaVersion: 1, catalogRevision: revision, expectedRevisionId: null };
  const store = repositoryStore(root), saved = await store.save(input);
  return { root, source, input, store, saved };
}
test('repository saves round-trip exact source and competing writers cannot overwrite one another', async () => {
  const { root, source, input, store, saved } = await fixture();
  expect((await readSource(root, source.id)).source).toEqual(source);
  const results = await Promise.allSettled(['two', 'three'].map(revision => store.save({ ...input, source: { ...source, revision }, expectedRevisionId: saved.id })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  const history = await store.revisions(source.id);
  expect(history.some(r => r.id === saved.id && JSON.parse(r.sourceJson).revision === 'one')).toBe(true);
});
test('external edits with an unchanged logical revision still reject stale autosave', async () => {
  const { root, source, input, store, saved } = await fixture();
  const external = { ...source, name: 'Changed by a file editor' };
  await writeFile(join(root, 'assets/ships/example/blueprint.json'), JSON.stringify(external));
  await expect(store.save({ ...input, source: { ...source, name: 'Stale draft' }, expectedRevisionId: saved.id })).rejects.toThrow('changed');
  expect((await readSource(root, 'example')).source.name).toBe(external.name);
});
test('invalid source, historical files and paths outside ship sources are preserved', async () => {
  const { root, source, input, store, saved } = await fixture();
  await expect(store.save({ ...input, source: { ...source, construction: { ...source.construction, primitives: [{ id: 'bad' }] } }, expectedRevisionId: saved.id })).rejects.toThrow();
  expect((await store.load('example')).head.revisionId).toBe(saved.id);
  await expect(store.load('../example')).rejects.toThrow();
  const outside = await mkdtemp(join(tmpdir(), 'construction-outside-')); roots.push(outside);
  await symlink(outside, join(root, 'assets/ships/escape'));
  await expect(store.save({ ...input, designId: 'escape', source: { ...source, id: 'escape' } })).rejects.toThrow('escapes');
  await mkdir(join(root, 'assets/ships/historical'));
  const historical = JSON.stringify({ schemaVersion: 1, id: 'historical', hull: {} });
  await writeFile(join(root, 'assets/ships/historical/blueprint.json'), historical);
  await expect(store.save({ ...input, designId: 'historical', source: { ...source, id: 'historical' } })).rejects.toThrow();
  expect(await readFile(join(root, 'assets/ships/historical/blueprint.json'), 'utf8')).toBe(historical);
});
test('local API requires same-origin token and preserves CAS conflicts', async () => {
  const { root, source, input, saved } = await fixture();
  const server = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [constructionFiles(root)], server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  try {
    const address = server.httpServer!.address() as { port: number }, base = 'http://127.0.0.1:' + address.port;
    const { token } = await (await fetch(base + '/__construction')).json();
    const body = JSON.stringify({ ...input, source: { ...source, revision: 'two' }, expectedRevisionId: saved.id });
    expect((await fetch(base + '/__construction/example', { method: 'PUT', headers: { 'content-type': 'application/json' }, body })).status).toBe(403);
    expect((await fetch(base + '/__construction/example', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-construction-token': token, origin: 'https://unrelated.invalid' }, body })).status).toBe(403);
    const options = { method: 'PUT', headers: { 'content-type': 'application/json', 'x-construction-token': token }, body };
    expect((await fetch(base + '/__construction/example', options)).status).toBe(200);
    expect((await fetch(base + '/__construction/example', options)).status).toBe(409);
  } finally { await server.close(); }
});

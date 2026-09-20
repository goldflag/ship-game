import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { catalogComparison, decodeReferenceModel, loadComponentReference, referenceModelUrl, type ComponentReference } from './catalog-reference';
const reference: ComponentReference = { partId: 'gun', category: 'gun', match: 'exact', notes: '', resource: 'common/visual/usa/gun/main/example/example' };
const mesh = { position: [0, 0, 0, 1, 0, 0, 0, 1, 0], index: [0, 1, 2], uv: [0, 0, 1, 0, 0, 1] };
const encode = (data: unknown) => Buffer.from(JSON.stringify(data));
test('geometry fetch URLs exclude unsafe paths, alternate domains and non-model assets', () => {
  expect(referenceModelUrl(reference)).toEndWith('/common/visual/usa/gun/main/example/example.model');
  for (const resource of ['../secret', 'common/visual/../secret', 'common/visual/a.png', 'https://example.com/model', 'common/visual//x']) expect(() => referenceModelUrl({ ...reference, resource })).toThrow();
  for (const dataRoot of ['https://example.com/', 'http://gamemodels3d.com/games/worldofwarships/data/current/', 'https://gamemodels3d.com/games/worldofwarships/data/current/../']) expect(() => referenceModelUrl({ ...reference, dataRoot })).toThrow();
});
test('raw and gzipped source preserve all triangles and positions without texture definitions', () => {
  const raw = encode({ version: 4, geometry: { '': mesh, detail: mesh }, materials: { map: 'secret.png' } });
  for (const data of [raw, gzipSync(raw)]) {
    const result = decodeReferenceModel(data);
    expect(result.geometry[''].position).toEqual(mesh.position);
    expect(result.geometry.detail.index).toEqual(mesh.index);
    expect(JSON.stringify(result)).not.toContain('uv');
    expect(JSON.stringify(result)).not.toContain('secret.png');
  }
});
test('invalid meshes, empty resources and unhandled source hierarchies fail explicitly', () => {
  for (const data of [ { version: 3, geometry: {} }, { version: 4, geometry: {} }, { version: 4, geometry: { '': { ...mesh, index: [0, 1, 99] } } }, { version: 4, geometry: { '': mesh }, nodes: {} } ]) expect(() => decodeReferenceModel(encode(data))).toThrow();
});
test('comparison catalog includes published requested kinds only with unique references', async () => {
  const catalog = await catalogComparison(process.cwd());
  expect(catalog.items.length).toBeGreaterThan(0);
  expect(catalog.items.every(item => ['gun', 'torpedo-launcher', 'mast', 'funnel'].includes(item.kind))).toBe(true);
  for (const item of catalog.items.filter(item => ['gun', 'torpedo-launcher'].includes(item.kind))) expect(item.reference?.partId).toBe(item.id);
  // A funnel without a same-variant source model is not published.
  for (const item of catalog.items.filter(item => item.kind === 'funnel')) expect([item.id, item.reference?.match]).toEqual([item.id, 'exact']);
  await expect(loadComponentReference(process.cwd(), '../../arbitrary')).rejects.toThrow('Unknown published');
});

import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { aircraftReferences, aircraftScheme, assembleReference, defaultComponents, vehicleId } from './reference';
import { suggestedAircraft } from './aircraft';
import { loadReference } from './server';
import catalog from '../../public/models/aircraft/catalog.json';

const path = 'common/visual/usa/aircraft/fighter/aaf030_f4f_4/aaf030_f4f_4';
const source = `const misc = ${JSON.stringify({ fighter: { paaf030: { name: 'Grumman F4F-4', scheme: path } } })};`;

test('aircraft discovery preserves source identity and reflection in the shared comparison assembly', () => {
  const [aircraft] = aircraftReferences(source);
  expect(aircraft).toEqual({ id: 'paaf030', name: 'Grumman F4F-4', category: 'fighter', path });
  const scheme = aircraftScheme(aircraft);
  expect(defaultComponents(scheme)).toEqual([]);
  expect(assembleReference(scheme, 'HullDefault', []).nodes).toEqual({ aircraft: {
    visual: path, transform: { matrix: [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
  } });
  expect(() => aircraftReferences('const misc = {"fighter":{"paaf030":{"name":"unsafe","scheme":"common/visual/../../secret"}}};')).toThrow();
  expect(() => aircraftReferences('sign in')).toThrow();
});

test('published aircraft have valid reference suggestions and differing variants are explicit', () => {
  for (const aircraft of catalog.aircraft) {
    expect(vehicleId(suggestedAircraft[aircraft.id].id)).toMatch(/^p[a-z]a[a-z]\d{3}$/);
  }
  expect(suggestedAircraft['sbd-3-dauntless'].note).toContain('SBD-4');
  expect(suggestedAircraft['d4y2-judy'].note).toContain('D4Y3');
});

test('aircraft downloader uses the public misc model, retains materials and reuses its local cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aircraft-overlay-'));
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/misc/fighter')) return new Response(source);
    if (url.endsWith(`${path}.model`)) return new Response(gzipSync(JSON.stringify({ version: 4, geometry: { '': { position: [0, 0, 0, 1, 0, 0, 0, 1, 0], index: [0, 1, 2], uv: [0, 0, 1, 0, 0, 1] } } })));
    if (url.endsWith(`${path}.material`)) return new Response(JSON.stringify({ materials: { '': { default: [{ map: 'common/visual/aircraft.jpg' }] } } }));
    throw new Error(`Unexpected download: ${url}`);
  }) as typeof fetch;
  try {
    const pack = await loadReference(root, 'paaf030');
    expect(pack.kind).toBe('aircraft');
    expect(pack.name).toBe('Grumman F4F-4');
    expect(pack.url).toBe('https://gamemodels3d.com/en/games/worldofwarships/misc/fighter');
    expect(pack.models[path].materials?.['']?.default[0].map).toBe('common/visual/aircraft.jpg');
    expect(await loadReference(root, 'paaf030')).toEqual(pack);
    expect(requests).toHaveLength(3);
    await expect(loadReference(root, 'paaf999')).rejects.toThrow('Unknown WoWS aircraft ID');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

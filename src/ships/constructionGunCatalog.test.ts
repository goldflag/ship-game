import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from './blueprint';
import { createStarterSource } from './constructionStarter';
const catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
const compile = (source: ConstructionSource): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));

test('every catalog gun fits on a deck by its attachment socket and compiles into a mount of its own weapon', () => {
  for (const part of catalog.equipment.filter(entry => entry.kind === 'gun')) {
    const source = createStarterSource(catalog, 'patrol'), gun = source.construction.equipment.find(entry => entry.id === 'gun-forward')!;
    // One block broad and deep enough for the largest turret's barbette and integral magazine; the gun stands alone on it.
    const hull = source.construction.primitives.find(piece => piece.id === 'hull')!; hull.size = [24, 16, 60];
    source.construction.primitives = [hull]; source.construction.surfaces = source.construction.surfaces.filter(surface => surface.primitiveId === hull.id);
    source.construction.equipment = [gun];
    const socket = part.sockets!.find(entry => entry.id === 'attachment')!;
    gun.partId = part.id; gun.position = [0, hull.size[1] / 2 - socket.position[1], 0];
    const result = compile(source);
    expect(result.definition, `${part.id}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
    expect(result.definition!.mounts.map(mount => mount.weapon.id), part.id).toEqual([part.gunPartId!]);
    expect(result.diagnostics.filter(entry => entry.sourceId === gun.id && entry.severity === 'error'), part.id).toEqual([]);
  }
});

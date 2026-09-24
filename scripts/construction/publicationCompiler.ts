import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConstructionResult, ConstructionSource } from '../../src/ships/blueprint';
import { readCatalog } from './files';

type NavalWasm = typeof import('../../src/generated/naval-wasm/naval_wasm');
let loaded: Promise<NavalWasm> | undefined;

/** The compile a published construction ship is built from and checked against: the simulation's WASM build, the one the
 * browser runs. Native builds round the last digit differently by platform (an arm64 Mac and x86_64 Linux disagree on
 * sums and libm calls), so a definition published on one never matched the check on the other; WASM floating point is
 * the same everywhere. Authoring tools keep the faster native compiler, which runs the same Rust. */
export async function compileForPublication(root: string, source: ConstructionSource): Promise<ConstructionResult> {
  loaded ??= (async () => {
    const binary = join(root, 'src/generated/naval-wasm/naval_wasm_bg.wasm');
    if (!existsSync(binary)) throw new Error('Missing src/generated/naval-wasm: run bun run bootstrap (or bun run multiplayer:prepare:dev).');
    const wasm: NavalWasm = await import('../../src/generated/naval-wasm/naval_wasm');
    await wasm.default({ module_or_path: await readFile(binary) });
    return wasm;
  })();
  const wasm = await loaded;
  return JSON.parse(wasm.compile_construction(JSON.stringify(source), JSON.stringify(await readCatalog(root, source.construction.catalogRevision))));
}

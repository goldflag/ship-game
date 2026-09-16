/** Isolated JS admission measurement; not a browser/worker/WASM memory claim. */
import { decodeRuntimeDefinition } from '../../src/ships/runtimeEncoding';
const input = process.argv[2];
if (!input) throw Error('Pass a .nsd file');
Bun.gc(true); const baseline = process.memoryUsage();
const start = performance.now(); const bytes = new Uint8Array(await Bun.file(input).arrayBuffer());
const readMs = performance.now() - start;
const decodeStart = performance.now(); const definition = decodeRuntimeDefinition(bytes);
const decodeMs = performance.now() - decodeStart;
Bun.gc(true); const resident = process.memoryUsage();
console.log(JSON.stringify({ input, runtimeBytes: bytes.length, readMs, decodeMs, baseline, resident, id: definition.id, note: 'Isolated Bun JS heap, OS cache uncontrolled; excludes rendering/worker/WASM. /usr/bin/time -l measures process peak RSS.' }));

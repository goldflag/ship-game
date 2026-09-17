import { encodeRuntimeDefinition, decodeRuntimeDefinition } from '../../src/ships/runtimeEncoding';
import { runtimeProjection } from '../../src/ships/runtimeProjection';
import { gzipSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const id = process.argv[2] ?? 'resolute';
const out = process.argv[3] ?? '.build/runtime-size'; await mkdir(out, { recursive: true });
const start = performance.now(), source = await Bun.file(`public/models/${id}.json`).text(), readMs = performance.now() - start;
let t = performance.now(); const def = JSON.parse(source), parseMs = performance.now() - t;
const sections = Object.entries(def).map(([section, value]) => { const bytes = Buffer.from(JSON.stringify(value)); return { section, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, count: Array.isArray(value) ? value.length : undefined }; });
t = performance.now(); const encoded = encodeRuntimeDefinition(runtimeProjection(def)), encodeMs = performance.now() - t;
t = performance.now(); const decoded = decodeRuntimeDefinition(encoded), decodeMs = performance.now() - t;
// Object-key order is immaterial; exact IEEE numbers, array order and every field must match.
const canonical = (v: any): string => v && typeof v === 'object' ? Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
if (sha(canonical(runtimeProjection(def))) !== sha(canonical(decoded))) throw new Error('Runtime encoding changed definition');
await Bun.write(`${out}/${id}.nsd`, encoded);
const report = { id, sourceSha256: sha(source), runtimeSha256: sha(encoded), bytes: Buffer.byteLength(source), runtimeBytes: encoded.length, gzipBytes: gzipSync(source).length, runtimeGzipBytes: gzipSync(encoded).length, readMs, parseMs, encodeMs, decodeMs, exactRuntimeFields: true, omitted: ['construction.primitives', 'construction.surfaces', 'construction.boundaries', 'construction.loads', 'loading.contributions except equipment power ratings'], sections };
await Bun.write(`${out}/${id}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));

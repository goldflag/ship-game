/** Offline candidate admission through the existing NSD/catalog contract. */
import { encodeRuntimeDefinition, decodeRuntimeDefinition } from '../../src/ships/runtimeEncoding';
import { runtimeProjection } from '../../src/ships/runtimeProjection';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const [input, output, basePath = '.build/naval-content/manifest.json'] = process.argv.slice(2);
if (!input || !output?.startsWith('.build/')) throw Error('Usage: ... definition.json .build/output-prefix [manifest]');
const start = performance.now();
const source = await Bun.file(input).text();
const readMs = performance.now() - start;
const parseStart = performance.now();
const d = JSON.parse(source);
const parseMs = performance.now() - parseStart;
const definition = runtimeProjection(d);
const bytes = encodeRuntimeDefinition(definition);
const decodeStart = performance.now();
const decoded = decodeRuntimeDefinition(bytes);
const decodeMs = performance.now() - decodeStart;
if (JSON.stringify(decoded) !== JSON.stringify(definition)) throw Error('Runtime round-trip differs');
const base = await Bun.file(basePath).json();
const entry = {
  id: d.id,
  contentHash: d.contentHash,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  encoding: 'nsd1-base64',
  json: Buffer.from(bytes).toString('base64'),
};
const manifest = {
  ...base,
  ships: base.ships.map((s: { id: string }) => (s.id === d.id ? entry : s)),
  hydrostatics: base.hydrostatics.filter((s: { id: string }) => s.id !== d.id),
};
await Bun.write(`${output}.manifest.json`, JSON.stringify(manifest));
await Bun.write(`${output}.nsd`, bytes);
const report = {
  input,
  contentHash: d.contentHash,
  runtimeBytes: bytes.length,
  gzipBytes: gzipSync(bytes).length,
  runtimeJsonBytes: Buffer.byteLength(JSON.stringify(definition)),
  readMs,
  jsonParseMs: parseMs,
  nsdDecodeMs: decodeMs,
  processMemory: process.memoryUsage(),
  note: 'Bun process, cold object admission with OS page cache uncontrolled; heap includes full authoring input and codec verification. Native instance/RSS measurements use runtime_bench.',
};
await Bun.write(`${output}.size.json`, JSON.stringify(report, null, 2));
console.log(report);

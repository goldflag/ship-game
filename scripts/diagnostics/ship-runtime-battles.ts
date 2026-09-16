import { mkdir } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
const [binary = 'target/release/examples/runtime_bench', manifest = '.build/naval-content/manifest.json', label = 'current', seconds = '10'] = process.argv.slice(2);
const ticks = Number(seconds) * 60; if (!Number.isInteger(ticks) || ticks < 1) throw new Error('Positive simulated seconds required');
const directory = `.build/runtime-size/${label}`; await mkdir(directory, { recursive: true });
const cases = [
  { id: 'hipper-2', ships: 2, matches: 1, designs: 'admiral-hipper-construction' },
  { id: 'hipper-8', ships: 8, matches: 1, designs: 'admiral-hipper-construction' },
  { id: 'hipper-16', ships: 16, matches: 1, designs: 'admiral-hipper-construction' },
  { id: 'matches-4x8', ships: 8, matches: 4, designs: 'admiral-hipper-construction' },
  { id: 'mixed-8', ships: 8, matches: 1, designs: 'admiral-hipper-construction,bismarck,fletcher,enterprise-cv6' },
];
const results = [];
for (const c of cases) {
  const child = Bun.spawn(['/usr/bin/time', '-l', binary, manifest, String(c.ships), String(c.matches), String(ticks), c.designs], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  await Bun.write(`${directory}/${c.id}.stderr`, stderr);
  if (code) throw new Error(`${c.id}: ${stderr.slice(-2000)}`);
  const result = { id: c.id, ...JSON.parse(stdout), peakRssBytes: Number(stderr.match(/(\d+)\s+maximum resident set size/)?.[1]) || null };
  await Bun.write(`${directory}/${c.id}.json`, JSON.stringify(result, null, 2)); results.push(result); console.log(c.id, result.tickMsAllMatches);
}
await Bun.write(`${directory}/matrix.json`, JSON.stringify({ conditions: { cpu: cpus()[0]?.model, memoryBytes: totalmem(), os: platform(), arch: arch(), seed: 12345, map: 'north-atlantic', weather: 'overcast', separationM: 5000, note: 'Release native, tracked allocator, shared machine; serial scheduler across concurrent resident matches; snapshots excluded from tick timings' }, results }, null, 2));

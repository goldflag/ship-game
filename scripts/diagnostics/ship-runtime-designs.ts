import { mkdir } from 'node:fs/promises';
const [binary = 'target/release/examples/runtime_bench', manifestPath = '.build/naval-content/manifest.json', label = 'current'] = process.argv.slice(2);
const manifest = await Bun.file(manifestPath).json();
const directory = `.build/runtime-size/${label}`;
await mkdir(directory, { recursive: true });
const results = [];
for (const designs of [['resolute'], ['resolute', 'bismarck', 'fletcher', 'enterprise-cv6']]) {
  const path = `${directory}/catalog-${designs.length}.manifest.json`;
  await Bun.write(path, JSON.stringify({ ...manifest,
    ships: manifest.ships.filter((ship: { id: string }) => designs.includes(ship.id)),
    hydrostatics: manifest.hydrostatics.filter((ship: { id: string }) => designs.includes(ship.id)),
  }));
  const child = Bun.spawn([binary, path, '2', '1', '1', designs.join(',')], { stdout: 'pipe', stderr: 'pipe' });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(error);
  results.push(JSON.parse(output));
}
await Bun.write(`${directory}/designs.json`, JSON.stringify(results, null, 2));
console.log(results.map(result => ({ designs: result.designs, loaded: result.loaded, compiled: result.compiled })));

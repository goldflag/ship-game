/** `bun run ship:floating <id>`: acceptance check 1, no floating geometry.
 *
 * Blender searches outward from the hull through touching parts (scripts/ships/floating_check.py): a
 * part is attached when a chain of contacts (intersecting triangles, surfaces within the gap, or a
 * vertex embedded inside another closed part) leads to the hull. Everything else is listed by
 * assembly, including clusters that only touch each other. Evidence, not a certificate: contact is
 * geometric, and a real support must still be a plausible structure. */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBlender } from '../build/blender';

const root = join(import.meta.dir, '../..');
const argv = process.argv.slice(2);
const usage = `bun run ship:floating <id> [--glb] [--gap 0.06] [--ignore substring,...] [--leaf substring,...] [--report-only]

  --glb          check the published public/models/<id>.glb instead of the retained generated/source.blend
                 (construction ships have no retained scene and always use the GLB; the GLB merges each
                 assembly's fixed parts into one mesh, so the retained scene names parts more finely)
  --gap          contact tolerance in metres (default 0.06)
  --ignore       skip meshes whose names contain these substrings
  --leaf         parts that are attached by touching but support nothing (default wires,halyard,rigging)
  --report-only  exit 0 even when unattached parts are found

Writes .build/ships/<id>/floating.json.`;
const id = argv.find((a, i) => !a.startsWith('--') && !['--gap', '--ignore', '--leaf'].includes(argv[i - 1]));
if (!id || argv.includes('--help')) { console.log(usage); process.exit(id ? 0 : 1); }
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const source = join(root, 'assets/ships', id, 'generated/source.blend');
const glb = join(root, 'public/models', `${id}.glb`);
const model = argv.includes('--glb') || !existsSync(source) ? glb : source;
if (!existsSync(model)) throw new Error(`No model at ${model}; build the ship first.`);
const stage = join(root, '.build/ships', id);
await mkdir(stage, { recursive: true });
const out = join(stage, 'floating.json');
console.log(`Checking attachment on ${id} from ${model.slice(root.length + 1)} …`);
await runBlender(join(root, 'scripts/ships/floating_check.py'), {}, {
  cwd: root, log: join(stage, 'floating.log'),
  args: ['--model', model, '--out', out, ...['--gap', '--ignore', '--leaf'].flatMap(k => (value(k) ? [k, value(k)!] : []))],
});
const report = JSON.parse(await readFile(out, 'utf8')) as {
  parts: number; floating: { assembly: string; parts: string[]; runtimeBounds: [number[], number[]]; wholeAssembly: boolean }[];
};
const count = report.floating.reduce((n, f) => n + f.parts.length, 0);
for (const f of report.floating) {
  const [lo, hi] = f.runtimeBounds;
  const at = lo.map((v, i) => ((v + hi[i]) / 2).toFixed(1)).join(', ');
  console.log(`FLOATING ${f.assembly}${f.wholeAssembly ? ' (whole assembly)' : ''}: ${f.parts.length} part(s) around [${at}] ship m, e.g. ${f.parts.slice(0, 3).join('; ')}`);
}
console.log(count ? `\n${count} of ${report.parts} parts are not attached to the hull; details in .build/ships/${id}/floating.json`
  : `\nAll ${report.parts} parts are attached to the hull through touching parts.`);
if (count && !argv.includes('--report-only')) process.exit(1);

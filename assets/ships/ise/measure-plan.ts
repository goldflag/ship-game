// Plan cuts of the cached pjsb526 reference for Ise's measured superstructure blocks: the repository's own
// `ship:slice --plan` (planPolygons) over the hull group, mirrored, gaps up to 1.2 m bridged, features under 0.3 m
// dropped, every 5 cm from 4.57 to 44 m over the whole ship, from one reference load. Measurement only: it writes
// our own traced outlines to ignored .build/, never source triangles; author-blueprint.py --plan reads the file.
//
//   bun assets/ships/ise/measure-plan.ts .build/ise/plan-cuts.json
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readReference } from '../../../scripts/construction/reference';
import { meshView, planPolygons } from '../../../scripts/construction/slice';

const root = resolve(import.meta.dir, '../../..');
const out = process.argv[2] ?? '.build/ise/plan-cuts.json';
const mesh = await readReference(root, 'pjsb526');
const view = meshView(mesh, ['hull']);
const box = { min: [-22, 0, -112] as [number, number, number], max: [22, 50, 113] as [number, number, number] };
const levels: { y: number; polygons: unknown[] }[] = [];
for (let k = 0; ; k++) {
  const y = Math.round((4.57 + k * 0.05) * 1000) / 1000;
  if (y > 44 + 1e-9) break;
  levels.push({ y, polygons: planPolygons(view, y, { box, symmetric: true, close: 0.6, minThickness: 0.3, resolution: 0.04, minArea: 0.15 }) });
}
writeFileSync(resolve(root, out), JSON.stringify({ ship: levels }));
console.log(`${levels.length} levels -> ${out}`);

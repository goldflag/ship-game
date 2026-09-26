/** Plan footprints of the cached `pasc107-b` reference at many heights, in one process, for `structures.py`.
 *
 * bun assets/ships/new-orleans/authoring/plans.ts <out.json> <y0> <y1> <step> [--parts hull] [--res 0.05]
 *   [--min-thickness 0.3] [--close 0.25] [--simplify 0.04] [--min-area 0.3] [--box x0,y0,z0,x1,y1,z1]
 *
 * Each level is the shared `ship:slice --plan … --sym` trace (scripts/construction/slice.ts, `planPolygons`) of the
 * reference's hull group, which carries the superstructure: the cut is rasterised, gaps bridged, enclosed interiors
 * filled and thin features (rails, ladders) dropped. Reference z (not yet shifted to the ship frame). Measurement
 * only: the output belongs in ignored `.build/`. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readReference } from '../../../../scripts/construction/reference';
import { meshView, planPolygons } from '../../../../scripts/construction/slice';

const root = resolve(import.meta.dir, '../../../..');
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const [out, y0s, y1s, steps] = argv;
const parts = (flag('--parts') ?? 'hull').split(',');
const mesh = await readReference(root, flag('--ref') ?? 'pasc107-b');
const view = meshView(mesh, parts);
const y0 = Number(y0s), y1 = Number(y1s), step = Number(steps);
const box = flag('--box')?.split(',').map(Number);
const levels: unknown[] = [];
for (let k = 0; y0 + k * step <= y1 + 1e-9; k++) {
  const y = Math.round((y0 + k * step) * 1000) / 1000;
  const polygons = planPolygons(view, y, {
    symmetric: true,
    resolution: Number(flag('--res') ?? 0.05),
    minThickness: Number(flag('--min-thickness') ?? 0.3),
    close: Number(flag('--close') ?? 0.25),
    simplify: Number(flag('--simplify') ?? 0.04),
    minArea: Number(flag('--min-area') ?? 0.3),
    ...(box ? { box: { min: [box[0], box[1], box[2]], max: [box[3], box[4], box[5]] } } : {}),
  });
  levels.push({ y, polygons });
}
writeFileSync(out, JSON.stringify({ reference: 'pasc107-b', parts, levels }));
console.log(`${levels.length} levels -> ${out}`);

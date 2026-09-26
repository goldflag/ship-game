// Plan cuts of the cached pjsb526 reference for Ise's measured superstructure blocks: the repository's own
// `ship:slice --plan` (planPolygons) over the hull group, mirrored, features under 0.3 m dropped, every 5 cm from 4.57
// to 44 m over the whole ship, from one reference load. Gaps up to 1.2 m are bridged below 15 m, where deckhouse
// doors and embrasures would otherwise open the walls; above it, only 0.5 m, so the pagoda's open galleries between
// its bridge walls and their railings stay open. Measurement only: it writes
// our own traced outlines to ignored .build/, never source triangles; author-blueprint.py --plan reads the file.
//
// With --thin, the towers' walls instead, down to 2 cm thick (the glazed bridge fronts are thin shells), every 5 cm
// from 15 to 36 m over the pagoda and the after tower: measure-windows.py reads them for the depth of each window's
// wall, and author-blueprint.py's glazed-front outlines were read off them.
//
//   bun assets/ships/ise/measure-plan.ts .build/ise/plan-cuts.json
//   bun assets/ships/ise/measure-plan.ts --thin .build/ise/thin-cuts.json
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readReference } from '../../../scripts/construction/reference';
import { meshView, planPolygons } from '../../../scripts/construction/slice';

type Box = { min: [number, number, number]; max: [number, number, number] };
const root = resolve(import.meta.dir, '../../..');
const thin = process.argv.includes('--thin');
const out = process.argv.slice(2).find(a => !a.startsWith('--')) ?? (thin ? '.build/ise/thin-cuts.json' : '.build/ise/plan-cuts.json');
const mesh = await readReference(root, 'pjsb526');
const view = meshView(mesh, ['hull']);
const levels: { y: number; polygons: unknown[] }[] = [];
if (thin) {
  const towers: Box[] = [{ min: [-10, 0, -44], max: [10, 50, -18] }, { min: [-10, 0, 36], max: [10, 50, 58] }];
  for (let k = 0; ; k++) {
    const y = Math.round((15 + k * 0.05) * 1000) / 1000;
    if (y > 36 + 1e-9) break;
    levels.push({ y, polygons: towers.flatMap(box => planPolygons(view, y, { box, symmetric: true, close: 0.25, minThickness: 0.02, resolution: 0.04, minArea: 0.02 })) });
  }
  writeFileSync(resolve(root, out), JSON.stringify({ levels }));
} else {
  const box: Box = { min: [-22, 0, -112], max: [22, 50, 113] };
  for (let k = 0; ; k++) {
    const y = Math.round((4.57 + k * 0.05) * 1000) / 1000;
    if (y > 44 + 1e-9) break;
    levels.push({ y, polygons: planPolygons(view, y, { box, symmetric: true, close: y < 15 ? 0.6 : 0.25, minThickness: 0.3, resolution: 0.04, minArea: 0.15 }) });
  }
  writeFileSync(resolve(root, out), JSON.stringify({ ship: levels }));
}
console.log(`${levels.length} levels -> ${out}`);

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ConstructionCustomHull, Hull } from '../../src/ships/blueprint';

const root = resolve(import.meta.dir, '../..');
export const PRESET_SHIPS = ['bismarck', 'king-george-v', 'admiral-hipper', 'baltimore', 'fletcher', 'yukikaze'] as const;

/** Reduce the original game hull to the editor's 24 sections and nine controls.
 * Select stations by error in metres and space outline controls along each side.
 * Legacy stations run stern-to-bow; custom-hull t runs bow-to-stern. */
export function deriveHullPreset(hull: Pick<Hull, 'length' | 'beam' | 'sections'>) {
  const sections = hull.sections!.map((s, i, all) => ({ ...s,
    // Retain short stem transitions that would otherwise be dropped by the
    // editor's minimum station spacing. Only move stations within 0.51% of an end.
    station: i === 0 || i === all.length - 1 ? s.station
      : Math.max(hull.length * .0051, Math.min(hull.length * .9949, s.station)),
  }));
  const depth = Math.max(...sections.flatMap(s => s.points.map(p => p[1])))
    - Math.min(...sections.flatMap(s => s.points.map(p => p[1])));
  const selected = [0, sections.length - 1];
  while (selected.length < 24) {
    let best = -1, error = -1;
    for (let i = 0; i < selected.length - 1; i++) {
      const a = sections[selected[i]], b = sections[selected[i + 1]];
      for (let j = selected[i] + 1; j < selected[i + 1]; j++) {
        const s = sections[j];
        // Leave a margin so serialized positions remain at least 0.5% apart.
        if (Math.min(s.station - a.station, b.station - s.station) / hull.length < .00501) continue;
        const t = (s.station - a.station) / (b.station - a.station);
        const distance = Math.max(...s.points.map((p, k) => Math.hypot(
          p[0] - a.points[k][0] - t * (b.points[k][0] - a.points[k][0]),
          p[1] - a.points[k][1] - t * (b.points[k][1] - a.points[k][1]),
        )));
        if (distance > error) { error = distance; best = j; }
      }
    }
    if (best < 0) break;
    selected.push(best); selected.sort((a, b) => a - b);
  }
  const customHull: ConstructionCustomHull = {
    version: 1, rake: 0, bulb: 0, redPaintY: -.02 * depth,
    stations: selected.reverse().map(index => {
      const s = sections[index], deck = s.points.at(-1)![1], keel = s.points[0][1];
      // Collapsed legacy tips need a short vertical stem to remain editable.
      // Preserve deck height and width, respecting the compiler's minimum depth.
      const height = Math.max(deck - keel, .06001 * depth);
      const distances = [0];
      for (let k = 1; k < s.points.length; k++) distances.push(distances[k - 1]
        + Math.hypot(s.points[k][0] - s.points[k - 1][0], s.points[k][1] - s.points[k - 1][1]));
      const half = Array.from({ length: 5 }, (_, i) => {
        const distance = distances.at(-1)! * i / 4;
        let k = 1;
        while (k < distances.length - 1 && distances[k] < distance) k++;
        const span = distances[k] - distances[k - 1], f = span > 0 ? (distance - distances[k - 1]) / span : i / 4;
        const x = s.points[k - 1][0] + f * (s.points[k][0] - s.points[k - 1][0]);
        const y = s.points[k - 1][1] + f * (s.points[k][1] - s.points[k - 1][1]);
        return { x: x / (hull.beam / 2), y: (deck - height + height * (deck > keel ? (y - keel) / (deck - keel) : i / 4)) / depth };
      });
      return { id: `section-${index}`, t: (hull.length - s.station) / hull.length,
        points: [...half.slice(1).reverse().map(p => ({ x: p.x ? -p.x : 0, y: p.y })), { x: 0, y: half[0].y }, ...half.slice(1)] };
    }),
  };
  return { length: hull.length, beam: hull.beam, depth, customHull };
}

if (import.meta.main) {
  const entries = await Promise.all(PRESET_SHIPS.map(async id => {
    const { hull } = JSON.parse(await readFile(resolve(root, 'assets/ships', id, 'blueprint.json'), 'utf8'));
    const shape = deriveHullPreset(hull);
    // Compact section rows avoid shipping whole ship blueprints to the browser.
    return `  ${JSON.stringify(id)}: ${JSON.stringify(shape).replace('"stations":[', '"stations":[\n    ').replaceAll('},{"id":', '},\n    {"id":').replace(/\]\}\}$/, '\n  ]}}')}`;
  }));
  const path = resolve(root, 'src/ships/constructionHullPresets.generated.json');
  const data = '{\n' + entries.join(',\n') + '\n}\n';
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== data) throw new Error('Hull presets are stale. Run bun scripts/construction/hull-presets.ts');
  } else await writeFile(path, data);
}

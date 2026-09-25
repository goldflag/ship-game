import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ConstructionCustomHull, Hull } from '../../src/ships/blueprint';

const root = resolve(import.meta.dir, '../..');
export const PRESET_SHIPS = ['bismarck', 'king-george-v', 'admiral-hipper', 'baltimore', 'fletcher', 'yukikaze'] as const;
export const PRESET_OPTIONS: Partial<Record<typeof PRESET_SHIPS[number], { bluntEnds: boolean }>> = {
  bismarck: { bluntEnds: true }, 'king-george-v': { bluntEnds: true },
};

/** Reduce the original game hull to at most 16 sections and nine controls.
 * Select stations by error in metres and space outline controls along each side.
 * Legacy stations run stern-to-bow; custom-hull t runs bow-to-stern. */
export function deriveHullPreset(hull: Pick<Hull, 'length' | 'beam' | 'sections'>, { bluntEnds = false } = {}) {
  const sections = hull.sections!;
  const depth = Math.max(...sections.flatMap(s => s.points.map(p => p[1])))
    - Math.min(...sections.flatMap(s => s.points.map(p => p[1])));
  const selected = [0, sections.length - 1];
  while (selected.length < 16) {
    let best = -1, error = -1;
    for (let i = 0; i < selected.length - 1; i++) {
      const a = sections[selected[i]], b = sections[selected[i + 1]];
      for (let j = selected[i] + 1; j < selected[i + 1]; j++) {
        const s = sections[j];
        // Give the editable controls breathing room, including at either end.
        if (Math.min(s.station - a.station, b.station - s.station) / hull.length < .04 - 1e-9) continue;
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
      const blunt = bluntEnds && (index === 0 || index === sections.length - 1);
      // Collapsed legacy tips need a short vertical stem to remain editable.
      // Preserve deck height, respecting the compiler's minimum section depth.
      const height = Math.max(deck - keel, (blunt ? .16 : .06001) * depth);
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
        // Broader, rounded cross-sections replace the battleships' needle tips.
        const width = x / (hull.beam / 2);
        return { x: blunt ? Math.max(width, [0, .36, .74, .96, 1][i] * .08) : width,
          y: (deck - height + height * (deck > keel ? (y - keel) / (deck - keel) : i / 4)) / depth };
      });
      return { id: `section-${index}`, t: (hull.length - s.station) / hull.length,
        points: [...half.slice(1).reverse().map(p => ({ x: p.x ? -p.x : 0, y: p.y })), { x: 0, y: half[0].y }, ...half.slice(1)] };
    }),
  };
  return { length: hull.length, beam: hull.beam, depth, customHull };
}

/** The chooser's ship hulls as published: src/ships/constructionHullPresets.generated.json. */
export async function hullPresetsJson(dir = root): Promise<string> {
  const entries = await Promise.all(PRESET_SHIPS.map(async id => {
    const { hull } = JSON.parse(await readFile(resolve(dir, 'assets/ships', id, 'blueprint.json'), 'utf8'));
    const shape = deriveHullPreset(hull, PRESET_OPTIONS[id]);
    // Compact section rows avoid shipping whole ship blueprints to the browser.
    return `  ${JSON.stringify(id)}: ${JSON.stringify(shape).replace('"stations":[', '"stations":[\n    ').replaceAll('},{"id":', '},\n    {"id":').replace(/\]\}\}$/, '\n  ]}}')}`;
  }));
  return '{\n' + entries.join(',\n') + '\n}\n';
}
export const HULL_PRESETS_FILE = 'src/ships/constructionHullPresets.generated.json';

/** Rewrites the published hull presets from the source blueprints; true when they changed. */
export async function writeHullPresets(dir = root): Promise<boolean> {
  const path = resolve(dir, HULL_PRESETS_FILE), data = await hullPresetsJson(dir);
  if (await readFile(path, 'utf8') === data) return false;
  await writeFile(path, data);
  return true;
}

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    if (await readFile(resolve(root, HULL_PRESETS_FILE), 'utf8') !== await hullPresetsJson()) throw new Error('Hull presets are stale. Run bun scripts/construction/hull-presets.ts');
  } else await writeHullPresets();
}

import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []);

test('only the comparison adapter imports Water Pro, and the game loads it on demand', () => {
  const offenders: string[] = [];
  for (const file of sources(join(ROOT, 'src'))) {
    const path = relative(ROOT, file);
    if (path.startsWith('src/game/comparison/')) continue;
    // Type-only imports vanish from the bundle; any other static import would ship the library to every player.
    for (const [, from] of readFileSync(file, 'utf8').matchAll(/^import (?!type\b)[^;]*? from '([^']+)'/gm)) {
      if (from.includes('threejs-water-pro') || from.includes('comparison/WaterProOcean')) offenders.push(`${path}: ${from}`);
    }
  }
  expect(offenders).toEqual([]);
  expect(readFileSync(join(ROOT, 'src/game/Game.ts'), 'utf8')).toContain("await import('./comparison/WaterProOcean')");
});

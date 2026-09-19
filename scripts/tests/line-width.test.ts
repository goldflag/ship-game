import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Wide lines make every search hit and exact-string edit expensive. New and formatted files stay under the limit;
 * the allowlist names files not yet formatted and may only shrink. `LINE_WIDTH_RECORD=1 bun test scripts/tests/line-width.test.ts`
 * rewrites it after formatting more files. */
const LIMIT = 240;
const root = resolve(import.meta.dir, '../..');
const ALLOWLIST = resolve(import.meta.dir, 'line-width-allowlist.json');
const GENERATED = /(^|\/)generated\//;

function trackedSources(): string[] {
  const listed = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'src', 'scripts'], { cwd: root });
  if (listed.exitCode) throw new Error('git ls-files failed');
  return listed.stdout
    .toString()
    .split('\0')
    .filter((path) => (/^src\/.*\.(ts|tsx|css)$/.test(path) || /^scripts\/.*\.(ts|tsx)$/.test(path)) && !GENERATED.test(path));
}

/** The first over-wide line of each file, as `[file, line number, width]`. */
function widest(files: string[]): Map<string, [line: number, width: number]> {
  const wide = new Map<string, [number, number]>();
  for (const file of files) {
    const lines = readFileSync(resolve(root, file), 'utf8').split('\n');
    const index = lines.findIndex((line) => line.length > LIMIT);
    if (index >= 0) wide.set(file, [index + 1, lines[index].length]);
  }
  return wide;
}

test(`tracked source lines stay within ${LIMIT} columns outside the shrinking allowlist`, () => {
  const wide = widest(trackedSources());
  if (process.env.LINE_WIDTH_RECORD) writeFileSync(ALLOWLIST, JSON.stringify([...wide.keys()].sort(), null, 2) + '\n');
  const allowed = new Set<string>(JSON.parse(readFileSync(ALLOWLIST, 'utf8')));
  const offenders = [...wide]
    .filter(([file]) => !allowed.has(file))
    .map(
      ([file, [line, width]]) =>
        `${file}:${line} is ${width} columns wide (limit ${LIMIT}); run bun run format ${file} (and split any literal it cannot wrap)`,
    );
  const stale = [...allowed]
    .filter((file) => !wide.has(file))
    .map((file) => `${file} no longer needs its entry in scripts/tests/line-width-allowlist.json; remove it`);
  expect([...offenders, ...stale]).toEqual([]);
});

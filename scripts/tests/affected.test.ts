import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { affectedTests } from './affected';

const root = mkdtempSync(join(tmpdir(), 'affected-tests-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const files: Record<string, string> = {
  'src/a.test.ts': "import type { T } from './types';\nimport {\n  f,\n  g,\n} from './f';\nconst data = new URL('../assets/x.json', import.meta.url);\n",
  'src/f.ts': "export const f = () => import('./lazy').then(m => m);\nexport type Z = import('./typed').Y;\nimport shader from './shader.wgsl?raw';\nimport './gone';\n",
  'src/b.test.ts': "import { hints } from './runner';\n",
  'src/runner.ts': "export const hints = { 'src/a.test.ts': 3 };\nexport const catalog = 'assets/catalog.json';\n",
  'src/types.ts': '', 'src/lazy.ts': '', 'src/typed.ts': '', 'src/shader.wgsl': '', 'assets/x.json': '{}', 'assets/catalog.json': '{}',
};
for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), text); }
const select = (...touched: string[]) => Object.fromEntries(affectedTests(root, touched, ['src/a.test.ts', 'src/b.test.ts']).reasons);

test('a change reaches tests through runtime imports, URLs, suffixed and deleted modules, but not type-only imports', () => {
  expect(select('src/lazy.ts')).toEqual({ 'src/a.test.ts': 'imports src/lazy.ts via f.ts' });
  expect(select('src/shader.wgsl')).toEqual({ 'src/a.test.ts': 'imports src/shader.wgsl via f.ts' });
  expect(select('src/gone.ts')).toEqual({ 'src/a.test.ts': 'imports src/gone.ts via f.ts' });
  expect(select('assets/x.json')).toEqual({ 'src/a.test.ts': 'imports assets/x.json' });
  expect(select('src/types.ts', 'src/typed.ts')).toEqual({});
});

test('a file named by its repository path selects its readers, but a test named in a table is not a dependency', () => {
  expect(select('assets/catalog.json')).toEqual({ 'src/b.test.ts': 'depends on assets/catalog.json via runner.ts' });
  expect(select('src/a.test.ts')).toEqual({ 'src/a.test.ts': 'changed' });
});

test('shared roots select every test', () => {
  expect(affectedTests(root, ['src/lazy.ts', 'bun.lock'], []).everything).toBe('bun.lock');
});

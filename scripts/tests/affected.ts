/** Which test files a change can reach, and why: `bun run check` runs only these. A test is affected when it changed,
 * sits beside a changed module under the same stem, scans a changed file (see SCANNERS), or reaches a changed file
 * through imports; shared roots such as package.json or the Rust crates reach every test. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Modules a source imports, relative to the repository: imports and re-exports (not `import type`), `require`, runtime
 * `import()` (not the type-level `import('x').T`) and `new URL(…, import.meta.url)`, without Vite's `?raw`/`?url` suffixes. */
const IMPORTS = [
  /(?:^|[\s;])(?:import|export)(?!\s+type[\s{])(?:[\w\s{},*$]*?\sfrom)?\s*['"](\.{1,2}\/[^'"\n]+)['"]/g,
  /\b(?:import|require)\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)(?!\s*\.\s*(?!then\b|catch\b|finally\b)\w)/g,
  /new URL\(\s*['"](\.{1,2}\/[^'"\n]+)['"],\s*import\.meta\.url/g,
];
/** Files a source reads by path: joined to `import.meta.dir`, or repository-rooted literals such as 'public/models/x.json'. */
const BESIDE = /(?:join|resolve)\(\s*import\.meta\.dir,\s*['"]([^'"\n]+)['"]/g, ROOTED = /['"`]((?:src|scripts|assets|public|tools|services)\/[\w./-]+\.\w+)['"`]/g;
const PARSED = /^(src|scripts|tools|services)\/.*\.(tsx?|mts|cts|jsx?|mjs|cjs)$/, TEST = /\.(test|spec)\.\w+$/;
const SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.json', '/index.ts', '/index.tsx', '/index.js'];
/** Tests that read the repository instead of importing it run when anything they scan changes. */
const SCANNERS: [test: string, scans: RegExp, what: string][] = [
  ['scripts/tests/line-width.test.ts', /^(src\/.*\.(tsx?|css)|scripts\/.*\.tsx?|scripts\/tests\/line-width-allowlist\.json)$/, 'source line widths'],
  ['scripts/tests/tracked-evidence.test.ts', /^assets\//, 'tracked assets'],
  ['src/game/comparison/waterProIsolation.test.ts', /^src\/.*\.tsx?$/, 'imports across src'],
];
/** Shared roots reach every test; so does the simulation, which the client tests run as WASM. */
const SHARED = /^(package\.json|bun\.lock|tsconfig.*\.json|vite\.config\.ts|scripts\/tests\/run\.ts|Cargo\.(toml|lock)|crates\/)/;

export const testFiles = (root: string) => {
  const glob = new Bun.Glob('**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}');
  return ['src', 'scripts'].flatMap(dir => [...glob.scanSync({ cwd: resolve(root, dir) })].map(file => `${dir}/${file}`)).sort();
};

/** `touched` are repository paths, deleted ones included. `everything` names the shared root that selects every test. */
export function affectedTests(root: string, touched: string[], tests = testFiles(root)): { everything?: string; reasons: Map<string, string> } {
  const everything = touched.find(file => SHARED.test(file)), reasons = new Map<string, string>();
  if (everything) return { everything, reasons };
  const deleted = new Set(touched.filter(file => !existsSync(resolve(root, file))));
  const files = new Map<string, boolean>(), isFile = (path: string) => {
    if (!files.has(path)) { try { files.set(path, statSync(resolve(root, path)).isFile()); } catch { files.set(path, false); } }
    return files.get(path)!;
  };
  const resolveModule = (path: string) => path.startsWith('..') ? undefined
    : [...SUFFIXES.map(suffix => path + suffix), path.replace(/\.m?js$/, '.ts'), path.replace(/\.js$/, '.tsx')].find(candidate => isFile(candidate) || deleted.has(candidate));
  const found = (file: string, paths: string[]) => paths.map(resolveModule).filter((path): path is string => !!path && path !== file);
  // Every module the tests reach, who imports it and who reads which files; files outside the source roots are leaves.
  const importers = new Map<string, Set<string>>(), readers = new Map<string, Set<string>>(), queue = [...tests], reached = new Set(tests);
  const link = (edges: Map<string, Set<string>>, target: string, file: string) => { if (!edges.has(target)) edges.set(target, new Set()); edges.get(target)!.add(file); };
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (!PARSED.test(file) || !isFile(file)) continue;
    const text = readFileSync(resolve(root, file), 'utf8'), here = dirname(file);
    for (const target of found(file, IMPORTS.flatMap(pattern => [...text.matchAll(pattern)].map(([, spec]) => join(here, spec.replace(/[?#].*$/, '')))))) {
      link(importers, target, file);
      if (!reached.has(target)) { reached.add(target); queue.push(target); }
    }
    // A test file named in a string (the runner's scheduling table) is not read by that module.
    const read = [...[...text.matchAll(BESIDE)].map(([, spec]) => join(here, spec)), ...[...text.matchAll(ROOTED)].map(([, path]) => path)];
    for (const target of found(file, read)) if (!TEST.test(target)) link(readers, target, file);
  }
  // Walk back from each change; `toward` keeps each file's next step to it, so a selection can say why. A file read by
  // path affects its readers only; an import carries the change on to everything that imports the importer.
  const toward = new Map<string, string>(), origin = new Map<string, string>(), frontier = [...touched], readHop = new Set<string>();
  const step = (file: string, next: string) => { if (!origin.has(file)) { origin.set(file, origin.get(next)!); toward.set(file, next); frontier.push(file); } };
  for (const file of touched) origin.set(file, file);
  for (const file of touched) for (const reader of readers.get(file) ?? []) { step(reader, file); readHop.add(reader); }
  for (const file of frontier) for (const importer of importers.get(file) ?? []) step(importer, file);

  const modules = touched.filter(file => /\.(tsx?|mjs|js|css|json)$/.test(file) && /^(src|scripts)\//.test(file));
  for (const test of tests) {
    const beside = modules.find(file => dirname(file) === dirname(test) && basename(test).startsWith(`${basename(file).replace(/\.(tsx?|mjs|js|css|json)$/, '')}.`));
    const scanner = SCANNERS.find(([name]) => name === test), scanned = scanner && touched.find(file => scanner[1].test(file));
    const chain: string[] = [];
    for (let next = toward.get(test); next && next !== origin.get(test); next = toward.get(next)) chain.push(next);
    const reads = readHop.has(chain.at(-1) ?? test), via = chain.length ? ` via ${chain.map(file => basename(file)).join(' → ')}` : '';
    const reason = touched.includes(test) ? 'changed'
      : beside ? `beside ${beside}`
      : scanned ? `scans ${scanner[2]}, and ${scanned} changed`
      : origin.has(test) ? `${reads ? (chain.length ? 'depends on' : 'reads') : 'imports'} ${origin.get(test)}${via}` : undefined;
    if (reason) reasons.set(test, reason);
  }
  return { reasons };
}

import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeRecords, mergeText } from './catalog-merge';
import { perRecordJson } from './json-format';

const catalog = (parts: any[], other = {}) => ({ schemaVersion: 1, parts, ...other });
test('independent additions survive the same catalog insertion point, including new equipment groups', () => {
  expect(mergeRecords(catalog([]), catalog([{ id: 'fletcher' }], { depthCharges: [{ id: 'dc' }] }), catalog([{ id: 'kgv' }]))).toEqual(
    catalog([{ id: 'fletcher' }, { id: 'kgv' }], { depthCharges: [{ id: 'dc' }] }),
  );
});
test('independent fields merge; geometry arrays and conflicting values require review', () => {
  const base = catalog([{ id: 'gun', reload: 10, damage: 20, vertices: [1, 2] }]);
  const ours = catalog([{ id: 'gun', reload: 11, damage: 20, vertices: [1, 2] }]);
  const theirs = catalog([{ id: 'gun', reload: 10, damage: 22, vertices: [1, 2] }]);
  expect(mergeRecords(base, ours, theirs)).toEqual(catalog([{ id: 'gun', reload: 11, damage: 22, vertices: [1, 2] }]));
  expect(() => mergeRecords(base, ours, catalog([{ ...base.parts[0], reload: 12 }]))).toThrow('reload');
  expect(() => mergeRecords(base, catalog([{ ...base.parts[0], vertices: [3, 2] }]), catalog([{ ...base.parts[0], vertices: [1, 4] }]))).toThrow('vertices');
});
test('deletions propagate only against unchanged entries; ambiguous IDs and add/add edits fail', () => {
  const base = catalog([{ id: 'gun', reload: 10 }]);
  expect(mergeRecords(base, catalog([]), base)).toEqual(catalog([]));
  expect(() => mergeRecords(base, catalog([]), catalog([{ id: 'gun', reload: 12 }]))).toThrow('gun');
  expect(() => mergeRecords(catalog([]), base, catalog([{ id: 'gun', reload: 12 }]))).toThrow('gun');
  // Duplicate IDs leave a list indivisible: only one side may change it.
  expect(() => mergeRecords(base, catalog([{ id: 'gun' }, { id: 'gun' }]), catalog([{ id: 'gun', reload: 11 }]))).toThrow('Conflicting edits at $.parts');
});

test('blueprint and library records merge by ID at any depth, new records land beside their neighbours', () => {
  const ship = (mounts: any[], structures: any[] = [{ id: 'bridge', h: 10 }]) => ({ id: 'yamato', hull: { sections: [[0, 1], [2, 3]] }, mounts, structures });
  const base = ship([{ id: 'main-1', y: 5 }, { id: 'main-2', y: 8 }, { id: 'main-3', y: 7 }]);
  const ours = ship([{ id: 'main-1', y: 5.5 }, { id: 'main-2', y: 8 }, { id: 'aa-1', y: 12 }, { id: 'main-3', y: 7 }]);
  const theirs = ship([{ id: 'main-1', y: 5 }, { id: 'main-2', y: 8, part: 'b' }, { id: 'aa-2', y: 11 }, { id: 'main-3', y: 7 }], [{ id: 'bridge', h: 11 }]);
  expect(mergeRecords(base, ours, theirs)).toEqual(ship(
    [{ id: 'main-1', y: 5.5 }, { id: 'main-2', y: 8, part: 'b' }, { id: 'aa-2', y: 11 }, { id: 'aa-1', y: 12 }, { id: 'main-3', y: 7 }], [{ id: 'bridge', h: 11 }]));
  const library = (components: any[]) => ({ builders: { a: 'a.py' }, components });
  expect(mergeRecords(library([{ partId: 'x' }]), library([{ partId: 'x' }, { partId: 'y' }]), library([{ partId: 'x', review: 'accepted' }])))
    .toEqual(library([{ partId: 'x', review: 'accepted' }, { partId: 'y' }]));
  // One side's reordering is kept; two different reorderings need review.
  const list = (...ids: string[]) => ({ mounts: ids.map(id => ({ id })) });
  expect(mergeRecords(list('a', 'b', 'c'), list('c', 'a', 'b'), list('a', 'b', 'c', 'd'))).toEqual(list('c', 'd', 'a', 'b'));
  expect(() => mergeRecords(list('a', 'b', 'c'), list('c', 'a', 'b'), list('b', 'a', 'c'))).toThrow('reordered');
});

test('merged text keeps each file’s own style: Python floats and escapes, per-record generated layout', () => {
  const python = (reload: string, name: string) => `{\n  "parts": [\n    {\n      "id": "gun",\n      "reload": ${reload},\n      "name": "${name}"\n    }\n  ]\n}\n`;
  expect(mergeText(python('3.0', 'A \\u00b7 B'), python('3.0', 'C \\u00b7 D'), python('4.0', 'A \\u00b7 B'))).toBe(python('4.0', 'C \\u00b7 D'));
  const generated = (a: number, b: number) => perRecordJson({ version: 1, ships: { a: { v: a }, b: { v: b } } }, ['ships']);
  expect(generated(1, 1)).toBe('{\n  "version": 1,\n  "ships": {\n    "a":\n      {"v":1},\n    "b":\n      {"v":1}\n  }\n}\n');
  expect(mergeText(generated(1, 1), generated(2, 1), generated(1, 3))).toBe(generated(2, 3));
  // An all-ASCII side fits either escaping; the other versions decide.
  const named = (name: string) => `{\n  "name": "${name}"\n}\n`;
  expect(mergeText(named('A'), named('A'), named('B \\u00b7 C'))).toBe(named('B \\u00b7 C'));
  expect(mergeText(named('A \\u00b7'), named('B'), named('A \\u00b7'))).toBe(named('B'));
  expect(() => mergeText('{"a": 1}\n', '{"a": 1}\n', '{"a": 2}\n')).toThrow('Unrecognized');
});

test('Git invokes the driver for catalogs, blueprints and generated ship tables, and marks a real conflict', () => {
  const root = mkdtempSync(join(tmpdir(), 'ship catalog merge '));
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  };
  const ok = (...args: string[]) => { const r = git(...args); expect(r.code, r.err).toBe(0); return r.out.trim(); };
  const catalogPath = 'assets/parts/guns.json', blueprintPath = 'assets/ships/yamato/blueprint.json', tablePath = 'src/ships/presetCatalog.json';
  const save = (path: string, value: any, message: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), path === tablePath ? perRecordJson(value) : JSON.stringify(value, null, 2) + '\n');
    ok('add', '.'); ok('commit', '-m', message);
  };
  try {
    ok('init', '--initial-branch=main');
    ok('config', 'user.name', 'Merge test'); ok('config', 'user.email', 'merge@example.test');
    ok('config', 'commit.gpgsign', 'false');
    ok('config', 'core.hooksPath', join(root, 'no-hooks'));
    ok('config', 'merge.ship-catalog.driver', `${quote(process.execPath)} ${quote(`${import.meta.dir}/catalog-merge.ts`)} %O %A %B %P`);
    writeFileSync(join(root, '.gitattributes'), readFileSync(join(import.meta.dir, '../../.gitattributes')));
    for (const path of [catalogPath, blueprintPath, tablePath, 'assets/gameplay/hydrostatics.v1.json', 'assets/parts/construction.json'])
      expect(ok('check-attr', 'merge', '--', path)).toBe(path + ': merge: ship-catalog');
    save(catalogPath, catalog([{ id: 'base', reload: 10 }]), 'base');
    save(blueprintPath, { mounts: [{ id: 'm1', y: 1 }, { id: 'm2', y: 2 }] }, 'ship');
    save(tablePath, { a: { v: 1 }, b: { v: 1 } }, 'table');
    const base = ok('rev-parse', 'HEAD');
    ok('switch', '-c', 'ship-a');
    save(catalogPath, catalog([{ id: 'base', reload: 10 }, { id: 'a' }]), 'add a');
    save(blueprintPath, { mounts: [{ id: 'm1', y: 1.5 }, { id: 'm2', y: 2 }, { id: 'm3', y: 3 }] }, 'move m1, add m3');
    save(tablePath, { a: { v: 2 }, b: { v: 1 } }, 'rebuild a');
    ok('switch', '-c', 'ship-b', base);
    save(catalogPath, catalog([{ id: 'base', reload: 10 }, { id: 'b' }]), 'add b');
    save(blueprintPath, { mounts: [{ id: 'm1', y: 1 }, { id: 'm2', y: 2.5 }, { id: 'm4', y: 4 }] }, 'move m2, add m4');
    save(tablePath, { a: { v: 1 }, b: { v: 3 }, c: { v: 1 } }, 'rebuild b, add c');
    ok('merge', '--no-edit', 'ship-a');
    expect(JSON.parse(readFileSync(join(root, catalogPath), 'utf8')).parts.map((p: any) => p.id).sort()).toEqual(['a', 'b', 'base']);
    expect(JSON.parse(readFileSync(join(root, blueprintPath), 'utf8')).mounts).toEqual([{ id: 'm1', y: 1.5 }, { id: 'm2', y: 2.5 }, { id: 'm3', y: 3 }, { id: 'm4', y: 4 }]);
    expect(readFileSync(join(root, tablePath), 'utf8')).toBe(perRecordJson({ a: { v: 2 }, b: { v: 3 }, c: { v: 1 } }));
    ok('switch', '-c', 'edit-a', base); save(catalogPath, catalog([{ id: 'base', reload: 11 }]), 'reload a');
    ok('switch', '-c', 'edit-b', base); save(catalogPath, catalog([{ id: 'base', reload: 12 }]), 'reload b');
    const conflict = git('merge', '--no-edit', 'edit-a');
    expect(conflict.code).toBe(1);
    expect(conflict.out + conflict.err).toContain('Conflicting edits at $.parts[base].reload');
    expect(ok('diff', '--name-only', '--diff-filter=U')).toBe(catalogPath);
    expect(readFileSync(join(root, catalogPath), 'utf8')).toContain('<<<<<<< ours\n      "reload": 12\n||||||| base\n      "reload": 10\n=======\n      "reload": 11\n>>>>>>> theirs\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeCatalog } from './catalog-merge';

const catalog = (parts: any[], other = {}) => ({ schemaVersion: 1, parts, ...other });
test('independent additions survive the same catalog insertion point, including new equipment groups', () => {
  expect(mergeCatalog(catalog([]), catalog([{ id: 'fletcher' }], { depthCharges: [{ id: 'dc' }] }), catalog([{ id: 'kgv' }]))).toEqual(
    catalog([{ id: 'fletcher' }, { id: 'kgv' }], { depthCharges: [{ id: 'dc' }] }),
  );
});
test('independent fields merge; geometry arrays and conflicting values require review', () => {
  const base = catalog([{ id: 'gun', reload: 10, damage: 20, vertices: [1, 2] }]);
  const ours = catalog([{ id: 'gun', reload: 11, damage: 20, vertices: [1, 2] }]);
  const theirs = catalog([{ id: 'gun', reload: 10, damage: 22, vertices: [1, 2] }]);
  expect(mergeCatalog(base, ours, theirs)).toEqual(catalog([{ id: 'gun', reload: 11, damage: 22, vertices: [1, 2] }]));
  expect(() => mergeCatalog(base, ours, catalog([{ ...base.parts[0], reload: 12 }]))).toThrow('reload');
  expect(() => mergeCatalog(base, catalog([{ ...base.parts[0], vertices: [3, 2] }]), catalog([{ ...base.parts[0], vertices: [1, 4] }]))).toThrow('vertices');
});
test('deletions propagate only against unchanged entries; ambiguous IDs and add/add edits fail', () => {
  const base = catalog([{ id: 'gun', reload: 10 }]);
  expect(mergeCatalog(base, catalog([]), base)).toEqual(catalog([]));
  expect(() => mergeCatalog(base, catalog([]), catalog([{ id: 'gun', reload: 12 }]))).toThrow('gun');
  expect(() => mergeCatalog(catalog([]), base, catalog([{ id: 'gun', reload: 12 }]))).toThrow('gun');
  expect(() => mergeCatalog(base, catalog([{ id: 'gun' }, { id: 'gun' }]), base)).toThrow('duplicate');
});

test('Git invokes the driver, combines branches, and retains a real conflict in the index', () => {
  const root = mkdtempSync(join(tmpdir(), 'ship catalog merge '));
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  };
  const ok = (...args: string[]) => { const r = git(...args); expect(r.code, r.err).toBe(0); return r.out.trim(); };
  const file = join(root, 'guns.json');
  const save = (value: any, message: string) => {
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
    ok('add', '.'); ok('commit', '-m', message);
  };
  try {
    ok('init', '--initial-branch=main');
    ok('config', 'user.name', 'Merge test'); ok('config', 'user.email', 'merge@example.test');
    ok('config', 'commit.gpgsign', 'false');
    ok('config', 'core.hooksPath', join(root, 'no-hooks'));
    ok('config', 'merge.ship-catalog.driver', `${quote(process.execPath)} ${quote(`${import.meta.dir}/catalog-merge.ts`)} %O %A %B`);
    writeFileSync(join(root, '.gitattributes'), 'guns.json merge=ship-catalog\n');
    save(catalog([{ id: 'base', reload: 10 }]), 'base');
    const base = ok('rev-parse', 'HEAD');
    ok('switch', '-c', 'ship-a'); save(catalog([{ id: 'base', reload: 10 }, { id: 'a' }]), 'add a');
    ok('switch', '-c', 'ship-b', base); save(catalog([{ id: 'base', reload: 10 }, { id: 'b' }]), 'add b');
    ok('merge', '--no-edit', 'ship-a');
    expect(JSON.parse(readFileSync(file, 'utf8')).parts.map((p: any) => p.id).sort()).toEqual(['a', 'b', 'base']);
    ok('switch', '-c', 'edit-a', base); save(catalog([{ id: 'base', reload: 11 }]), 'reload a');
    ok('switch', '-c', 'edit-b', base); save(catalog([{ id: 'base', reload: 12 }]), 'reload b');
    expect(git('merge', '--no-edit', 'edit-a').code).toBe(1);
    expect(ok('diff', '--name-only', '--diff-filter=U')).toBe('guns.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).parts[0].reload).toBe(12);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

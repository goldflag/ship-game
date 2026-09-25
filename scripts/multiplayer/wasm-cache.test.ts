import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { restoreWasm, storeWasm, wasmSourceKey } from './wasm-cache';

const repository = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'wasm-cache-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

test('the key follows crate sources, files a crate includes and build settings, not unrelated files', () => {
  const root = repository({
    'Cargo.lock': 'lock',
    'crates/sim/src/lib.rs': 'const RULES: &str = include_str!("../../../assets/rules.json");',
    'crates/sim/build.rs': 'fn main() { digest("assets/digested.json"); }',
    'assets/rules.json': '{"a":1}',
    'assets/digested.json': '{}',
    'assets/unrelated.json': '{}',
  });
  try {
    const key = () => wasmSourceKey(root, { profile: 'wasm-dev', rustflags: '' });
    const first = key();
    writeFileSync(join(root, 'assets/unrelated.json'), '{"b":2}');
    expect(key()).toBe(first);
    writeFileSync(join(root, 'assets/rules.json'), '{"a":2}');
    const included = key();
    expect(included).not.toBe(first);
    writeFileSync(join(root, 'assets/digested.json'), '{"c":3}');
    const digested = key();
    expect(digested).not.toBe(included);
    writeFileSync(join(root, 'crates/sim/src/new.rs'), '// an untracked module');
    expect(key()).not.toBe(digested);
    expect(wasmSourceKey(root, { profile: 'release', rustflags: '' })).not.toBe(key());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stored module restores into another output directory; a missing key restores nothing', () => {
  const root = repository({ 'out/a.wasm': 'module', 'out/a.js': 'bindings' }), cache = join(root, 'cache');
  try {
    const key = '0123456789abcdef0123456789abcdef';
    expect(restoreWasm(cache, key, join(root, 'elsewhere'), ['a.wasm', 'a.js'])).toBe(false);
    storeWasm(cache, key, join(root, 'out'), ['a.wasm', 'a.js']);
    expect(restoreWasm(cache, key, join(root, 'elsewhere'), ['a.wasm', 'a.js'])).toBe(true);
    expect(readFileSync(join(root, 'elsewhere/a.wasm'), 'utf8')).toBe('module');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

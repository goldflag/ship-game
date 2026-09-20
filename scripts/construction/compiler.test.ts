import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshCompilerBinary } from './compiler';

// Freshness rule only; no cargo. `build = false` never invokes it.
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'construction compiler ')); roots.push(root);
  const binary = join(root, 'target/wasm-dev/examples/compile_construction'), input = join(root, 'crates/lib.rs'), lock = join(root, 'Cargo.lock');
  await mkdir(join(root, 'target/wasm-dev/examples'), { recursive: true }); await mkdir(join(root, 'crates')); await mkdir(join(root, '.build/construction'), { recursive: true });
  await writeFile(binary, 'binary'); await writeFile(input, 'source'); await writeFile(lock, 'lock');
  const past = new Date(Date.now() - 60_000); for (const path of [input, lock]) await utimes(path, past, past);
  const escape = (path: string) => path.replaceAll(' ', '\\ ');
  await writeFile(binary + '.d', escape(binary) + ': ' + escape(input) + ' ' + escape(lock) + '\n');
  const stamp = async (builtAfterMs: number) => { const s = await stat(binary); await writeFile(join(root, '.build/construction/compiler-stamp.json'), JSON.stringify({ binary, mtimeMs: s.mtimeMs, size: s.size, builtAfterMs })); };
  return { root, binary, input, stamp };
}
test('a stamped binary is trusted only while every dep-info input predates its build', async () => {
  const { root, binary, input, stamp } = await fixture();
  expect(await freshCompilerBinary(root, false)).toBeUndefined();
  await stamp(Date.now() - 1_000);
  expect(await freshCompilerBinary(root, false)).toBe(binary);
  const now = new Date(); await utimes(input, now, now);
  expect(await freshCompilerBinary(root, false)).toBeUndefined();
});
test('a replaced binary, a deleted input or missing dep-info is never trusted', async () => {
  const replaced = await fixture(); await replaced.stamp(Date.now() - 1_000);
  await writeFile(replaced.binary, 'rebuilt elsewhere');
  expect(await freshCompilerBinary(replaced.root, false)).toBeUndefined();
  const deleted = await fixture(); await deleted.stamp(Date.now() - 1_000);
  await rm(deleted.input);
  expect(await freshCompilerBinary(deleted.root, false)).toBeUndefined();
  const bare = await fixture(); await bare.stamp(Date.now() - 1_000);
  await rm(bare.binary + '.d');
  expect(await freshCompilerBinary(bare.root, false)).toBeUndefined();
});
test('a custom cargo environment is never second-guessed', async () => {
  const { root, stamp } = await fixture(); await stamp(Date.now() - 1_000);
  process.env.CARGO_TARGET_DIR = '/elsewhere';
  try { expect(await freshCompilerBinary(root, false)).toBeUndefined(); } finally { delete process.env.CARGO_TARGET_DIR; }
});

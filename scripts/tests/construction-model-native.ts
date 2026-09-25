import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rustTool } from '../multiplayer/toolchain';

/** Pure native oracle for the browser review. No production Rust or schema edits. */
export async function nativeConstructionMuzzles(input: unknown) {
  const root = resolve(import.meta.dir, '../..'),
    directory = resolve(root, '.build/shipbuilding/native-muzzle-oracle');
  await mkdir(directory, { recursive: true });
  const quote = (value: string) => JSON.stringify(value);
  await writeFile(
    resolve(directory, 'Cargo.toml'),
    `[package]\nname = "construction-model-oracle"\nversion = "0.0.0"\nedition = "2024"\n[workspace]\n[dependencies]\nnaval-sim = { path = ${quote(resolve(root, 'crates/naval-sim'))} }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n[[bin]]\nname = "construction-model-oracle"\npath = ${quote(resolve(root, 'scripts/tests/construction-model-native.rs'))}\n`,
  );
  const child = Bun.spawn([rustTool('cargo'), 'run', '--quiet', '--manifest-path', resolve(directory, 'Cargo.toml')], {
    cwd: root,
    env: { ...process.env, CARGO_TARGET_DIR: resolve(root, 'target') },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify(input));
  child.stdin.end();
  const [text, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  // Say why: a build error, a missing toolchain and a panic in the oracle all read the same without cargo's output.
  if (code) throw new Error(`Native muzzle oracle failed (cargo run exited ${code}):\n${errors.trim().split('\n').slice(-20).join('\n')}`);
  return JSON.parse(text);
}
if (import.meta.main) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error('Usage: bun scripts/tests/construction-model-native.ts <input.json> <output.json>');
  await Bun.write(process.argv[3], JSON.stringify(await nativeConstructionMuzzles(await Bun.file(process.argv[2]).json()), null, 2));
}

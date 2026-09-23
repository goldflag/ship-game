import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, sep } from 'node:path';

/** A tool on PATH, skipping node_modules/.bin: `bun run` puts those first, so `Bun.which` would prefer an npm build
 * (npm's Binaryen wasm-opt is about ten times slower than the native one) over the system binary. */
export function systemTool(name: string): string | null {
  const path = (process.env.PATH ?? '').split(delimiter).filter(dir => !dir.split(sep).includes('node_modules')).join(delimiter);
  return Bun.which(name, { PATH: path });
}

export function rustTool(name: 'cargo' | 'rustfmt' | 'wasm-bindgen'): string {
  const resolved = systemTool(name);
  if (resolved) return resolved;
  const local = join(homedir(), '.cargo', 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
  if (existsSync(local)) return local;
  throw new Error(`${name} is missing. Install the Rust/WASM tools described in docs/rust-multiplayer-implementation.md.`);
}

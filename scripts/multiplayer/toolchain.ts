import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function rustTool(name: 'cargo' | 'rustfmt' | 'wasm-bindgen'): string {
  const resolved = Bun.which(name);
  if (resolved) return resolved;
  const local = join(homedir(), '.cargo', 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
  if (existsSync(local)) return local;
  throw new Error(`${name} is missing. Install the Rust/WASM tools described in docs/rust-multiplayer-implementation.md.`);
}

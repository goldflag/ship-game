/** A WASM module another worktree already built from the same sources. Every worktree has its own `target/`, so a fresh
 * one (or one that just merged master) compiled the simulation from scratch: 30 s idle, several minutes while other
 * sessions' cargo jobs share the CPU. build-wasm.ts restores the bindings from here instead when the key matches, and
 * stores what it builds. Entries live in the main checkout's `.build/wasm-cache/<key>/`; the newest KEEP are kept.
 *
 * The key covers what cargo compiles into the module: every file under crates/, the workspace manifests, lockfile,
 * toolchain and cargo config, every repository file a crate names in a string literal (include_str!/include_bytes!
 * targets and the files build.rs digests), the profile, extra RUSTFLAGS and the wasm-bindgen version. Test-only
 * includes are hashed too, which costs a miss, never a stale module. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const KEEP = 12;
const ROOT_FILES = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo/config.toml'];
/** A path a crate reads from the repository: `"../../../assets/x.json"` from a source file, `"assets/x.json"` in build.rs. */
const NAMED = /"((?:\.\.\/)*(?:assets|public|src|scripts)\/[^"\s]+\.\w+)"/g;

const walk = (dir: string, files: string[] = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'target') walk(path, files); } else files.push(path);
  }
  return files;
};

/** The cache key for a build of the given profile. `extra` carries RUSTFLAGS and the wasm-bindgen version. */
export function wasmSourceKey(root: string, extra: Record<string, string>): string {
  const sources = walk(join(root, 'crates')).sort();
  const named = new Set<string>();
  for (const file of sources) {
    if (!file.endsWith('.rs')) continue;
    for (const [, path] of readFileSync(file, 'utf8').matchAll(NAMED)) {
      // Relative to the source file for include_str!, to the crate for build.rs, or to the repository root.
      const candidates = [resolve(dirname(file), path), resolve(root, 'crates', relative(join(root, 'crates'), file).split('/')[0], path), resolve(root, path)];
      const found = candidates.find(candidate => candidate.startsWith(`${root}/`) && existsSync(candidate) && statSync(candidate).isFile());
      if (found) named.add(found);
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(Object.entries(extra).sort()));
  for (const file of [...sources, ...ROOT_FILES.map(name => join(root, name)), ...[...named].sort()]) {
    hash.update(`\0${relative(root, file)}\0`);
    if (existsSync(file)) hash.update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 32);
}

/** The shared cache directory: the main checkout's, found through git's common directory. */
export function wasmCacheDir(root: string): string {
  const common = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root }).stdout.toString().trim();
  return join(common ? dirname(common) : root, '.build/wasm-cache');
}

/** Copies a cached module's bindings into `outDir`; false on a miss. */
export function restoreWasm(cache: string, key: string, outDir: string, files: string[]): boolean {
  const entry = join(cache, key);
  if (!files.every(file => existsSync(join(entry, file)))) return false;
  mkdirSync(outDir, { recursive: true });
  for (const file of files) cpSync(join(entry, file), join(outDir, file));
  const now = new Date();
  utimesSync(entry, now, now);
  return true;
}

/** Stores freshly built bindings (written aside, then renamed, so a concurrent reader never sees half an entry) and
 * drops all but the newest KEEP entries. */
export function storeWasm(cache: string, key: string, outDir: string, files: string[]): void {
  const entry = join(cache, key), staging = `${entry}.${process.pid}.tmp`;
  if (existsSync(entry)) return;
  mkdirSync(staging, { recursive: true });
  for (const file of files) cpSync(join(outDir, file), join(staging, file));
  try { renameSync(staging, entry); } catch { rmSync(staging, { recursive: true, force: true }); }
  const entries = readdirSync(cache).filter(name => /^[0-9a-f]{32}$/.test(name))
    .map(name => ({ name, time: statSync(join(cache, name)).mtimeMs })).sort((a, b) => b.time - a.time);
  for (const { name } of entries.slice(KEEP)) rmSync(join(cache, name), { recursive: true, force: true });
}

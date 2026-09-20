import { join, resolve as resolvePath } from 'node:path';
import { mkdir, writeFile, rm, readFile, readdir, stat, rename, utimes } from 'node:fs/promises';
import type { ConstructionResult, ConstructionSource, ConstructionSuggestion } from '../../src/ships/blueprint';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readCatalog, digest } from './files';

/** The same Rust entry point used to verify browser/WASM compilation. */
export async function compileConstruction(root: string, source: ConstructionSource): Promise<ConstructionResult> {
  return JSON.parse(await compileConstructionJson(root, source));
}
export async function suggestConstruction(root: string, source: ConstructionSource, partIds: string[]): Promise<ConstructionSuggestion> {
  return JSON.parse(await compileConstructionJson(root, source, partIds));
}

export type CompilerPath = 'cache' | 'session' | 'binary' | 'cargo';
export interface CompileOptions {
  /** Paths allowed for this call, tried in the order cache, session, binary, cargo. Default: all.
   * `CONSTRUCTION_SESSION=off` removes the session and `CONSTRUCTION_COMPILE_CACHE=off` the cache. */
  paths?: CompilerPath[];
  /** Receives the path that answered. */
  used?: (path: CompilerPath) => void;
}
const BUILD = ['--quiet', '--locked', '--profile', 'wasm-dev', '-p', 'naval-sim', '--example', 'compile_construction'];
export const cargoCommand = () => {
  const local = join(homedir(), '.cargo/bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  return existsSync(local) ? local : 'cargo';
};
const failure = (stderr: string) => new Error('Native construction compile failed: ' + stderr.slice(-4000));
const CACHE_ENTRIES = 8;
const TIMEOUT = 'Native construction compile exceeded ten minutes. Simplify the source before retrying.';

/** Exact compiler output text. Every path returns the same bytes for the same source and catalog. */
export async function compileConstructionJson(root: string, source: ConstructionSource, partIds?: string[], options: CompileOptions = {}): Promise<string> {
  const allowed = (path: CompilerPath) => !options.paths || options.paths.includes(path);
  const sourceJson = JSON.stringify(source);
  // Output is a pure function of the compiler build, the immutable catalog revision and the source text. Only a binary
  // proven fresh names a build, so a stale or unverifiable compiler never reads or writes the cache.
  const cached = async () => {
    if (!allowed('cache') || process.env.CONSTRUCTION_COMPILE_CACHE === 'off') return undefined;
    const binary = await freshCompilerBinary(root, false);
    return binary && join(root, '.build/construction/compile-cache', digest([await compilerBinaryIdentity(binary), source.construction.catalogRevision, JSON.stringify(partIds ?? null), sourceJson].join('\0')) + '.json');
  };
  const before = await cached(), hit = before && await readFile(before, 'utf8').catch(() => undefined);
  if (before && hit !== undefined) { const now = new Date(); await utimes(before, now, now).catch(() => {}); options.used?.('cache'); return hit; }
  const remember = async (output: string) => {
    const path = await cached().catch(() => undefined);
    // The build that answered is known only when the same fresh binary stood before and after the compile.
    if (!path || (before && path !== before)) return output;
    try {
      await mkdir(join(root, '.build/construction/compile-cache'), { recursive: true });
      const temporary = path + '.' + crypto.randomUUID() + '.tmp';
      await writeFile(temporary, output); await rename(temporary, path);
      const entries = await Promise.all((await readdir(join(root, '.build/construction/compile-cache'))).map(async name => ({ name, at: await stat(join(root, '.build/construction/compile-cache', name)).then(s => s.mtimeMs, () => 0) })));
      for (const { name } of entries.sort((a, b) => b.at - a.at).slice(CACHE_ENTRIES)) await rm(join(root, '.build/construction/compile-cache', name), { force: true });
    } catch { /* The cache is an optimisation; a full disk must not fail a compile. */ }
    return output;
  };
  if (allowed('session') && process.env.CONSTRUCTION_SESSION !== 'off' && existsSync(join(root, '.build/construction/session.json'))) {
    const answer = await (await import('./session')).sessionCompile(root, sourceJson, source.construction.catalogRevision, partIds);
    if (answer !== undefined) { options.used?.('session'); return before ? remember(answer) : answer; }
  }
  const catalog = await readCatalog(root, source.construction.catalogRevision);
  const directory = join(root, '.build/construction/compile', crypto.randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, 'source.json'), sourceJson);
    await writeFile(join(directory, 'catalog.json'), JSON.stringify(catalog));
    if (partIds) await writeFile(join(directory, 'parts.json'), JSON.stringify(partIds));
    const args = [join(directory, 'source.json'), join(directory, 'catalog.json'), ...(partIds ? ['--suggest', join(directory, 'parts.json')] : [])];
    const binary = allowed('binary') ? await freshCompilerBinary(root) : undefined;
    if (!binary && !allowed('cargo')) throw new Error('No allowed native compiler path is available.');
    options.used?.(binary ? 'binary' : 'cargo');
    const output = binary ? await run(binary, args, root) : await run(cargoCommand(), ['run', ...BUILD, '--', ...args], root);
    const text = output.endsWith('\n') ? output.slice(0, -1) : output;
    return binary ? remember(text) : text;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
function run(command: string, args: string[], cwd: string): Promise<string> {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 600_000);
  const stdout: Buffer[] = []; let stderr = '';
  child.stdout.on('data', data => { stdout.push(data); }); child.stderr.on('data', data => { stderr += data; });
  return new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }).then(code => {
    if (timedOut) throw new Error(TIMEOUT);
    if (code !== 0) throw failure(stderr);
    return Buffer.concat(stdout).toString();
  }).finally(() => clearTimeout(timer));
}

interface CompilerStamp { binary: string; mtimeMs: number; size: number; builtAfterMs: number }
const stampPath = (root: string) => join(root, '.build/construction/compiler-stamp.json');
/** Every input of the example binary, from Cargo's own dep-info: Rust sources, embedded assets, manifests and the lockfile. */
async function compilerInputs(root: string, binary: string): Promise<string[] | undefined> {
  const text = await readFile(binary + '.d', 'utf8').catch(() => undefined);
  const line = text?.split('\n').find(line => line.startsWith(binary.replaceAll(' ', '\\ ') + ':'));
  if (!line) return undefined;
  const inputs = line.slice(binary.replaceAll(' ', '\\ ').length + 1).split(/(?<!\\) +/).filter(Boolean).map(path => resolvePath(root, path.replaceAll('\\ ', ' ')));
  return inputs.length ? inputs : undefined;
}
async function stampIsFresh(root: string, binary: string): Promise<boolean> {
  const stamp = await readFile(stampPath(root), 'utf8').then(text => JSON.parse(text) as CompilerStamp).catch(() => undefined);
  const actual = await stat(binary).catch(() => undefined), inputs = await compilerInputs(root, binary);
  if (!stamp || !actual || !inputs || stamp.binary !== binary || stamp.mtimeMs !== actual.mtimeMs || stamp.size !== actual.size) return false;
  // An input touched at or after the build began may not be in the binary. Deleted inputs fail the stat.
  const modified = await Promise.all(inputs.map(path => stat(path).then(s => s.mtimeMs, () => Infinity)));
  return modified.every(time => time < stamp.builtAfterMs);
}
const building = new Map<string, Promise<string | undefined>>();
/** The example binary, only when it provably reflects the current Rust inputs; builds it when stale.
 * `undefined` means unsure (custom target directory, inputs edited during the build): use `cargo run`. */
export async function freshCompilerBinary(root: string, build = true): Promise<string | undefined> {
  if (process.env.CARGO_TARGET_DIR || process.env.CARGO_BUILD_TARGET_DIR || process.env.CARGO_BUILD_TARGET || process.env.RUSTFLAGS || process.env.CARGO_ENCODED_RUSTFLAGS) return undefined;
  const binary = join(root, 'target/wasm-dev/examples', process.platform === 'win32' ? 'compile_construction.exe' : 'compile_construction');
  if (await stampIsFresh(root, binary)) return binary;
  if (!build) return undefined;
  const started = building.get(root) ?? (async () => {
    // Cargo's lock serialises concurrent builders; each then records its own start time.
    const builtAfterMs = Date.now();
    await run(cargoCommand(), ['build', ...BUILD], root);
    const actual = await stat(binary).catch(() => undefined);
    if (!actual) return undefined;
    await mkdir(join(root, '.build/construction'), { recursive: true });
    const temporary = stampPath(root) + '.' + crypto.randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify({ binary, mtimeMs: actual.mtimeMs, size: actual.size, builtAfterMs } satisfies CompilerStamp));
    await rename(temporary, stampPath(root));
    return await stampIsFresh(root, binary) ? binary : undefined;
  })().finally(() => { building.delete(root); });
  building.set(root, started);
  return started;
}
/** Identity of the binary a long-lived process was started from. */
export async function compilerBinaryIdentity(binary: string) { const s = await stat(binary); return s.mtimeMs + ':' + s.size; }

export interface CompilerRequest { source: string; catalog: string; parts?: string }
/** One `compile_construction --serve` process. Requests run strictly one at a time; its geometry caches survive between them. */
export class CompilerProcess {
  private child: ChildProcessWithoutNullStreams;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: { resolve(line: string): void; reject(error: Error): void };
  private chunks: Buffer[] = [];
  private stderr = '';
  closed = false;
  constructor(readonly binary: string, cwd: string) {
    this.child = spawn(binary, ['--serve'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (data: Buffer) => {
      const end = data.indexOf(10);
      if (end < 0) { this.chunks.push(data); return; }
      const line = Buffer.concat([...this.chunks, data.subarray(0, end)]).toString();
      this.chunks = end + 1 < data.length ? [data.subarray(end + 1)] : [];
      const pending = this.pending; this.pending = undefined; pending?.resolve(line);
    });
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4000); });
    const ended = (error?: Error) => { this.closed = true; const pending = this.pending; this.pending = undefined; pending?.reject(error ?? failure(this.stderr || 'compiler process exited')); };
    this.child.on('error', ended); this.child.on('close', () => ended()); this.child.stdin.on('error', () => {});
  }
  request(request: CompilerRequest): Promise<{ result: string; reused: number }> {
    const next = this.queue.then(async () => {
      if (this.closed) throw failure(this.stderr || 'compiler process exited');
      const line = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { this.close(); reject(new Error(TIMEOUT)); }, 600_000);
        this.pending = { resolve: line => { clearTimeout(timer); resolve(line); }, reject: error => { clearTimeout(timer); reject(error); } };
        this.child.stdin.write(JSON.stringify(request) + '\n');
      });
      // `result` is last, so its exact bytes are the rest of the line.
      const head = /^\{"ok":true,"reused":(\d+),"result":/.exec(line.slice(0, 80));
      if (!head) throw failure(String((JSON.parse(line) as { error?: string }).error ?? 'malformed compiler response'));
      return { result: line.slice(head[0].length, -1), reused: Number(head[1]) };
    });
    this.queue = next.catch(() => {});
    return next;
  }
  close() { this.closed = true; this.child.stdin.end(); this.child.kill(); }
}

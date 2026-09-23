/** Builds naval-wasm and publishes its bindings to src/generated/naval-wasm: release by default, `--dev` for the wasm-dev
 * profile. A/B variants go elsewhere so they neither replace the game's module nor evict the shared cargo cache:
 *   bun scripts/multiplayer/build-wasm.ts --out-dir .build/wasm-simd --rustflags '-C target-feature=+simd128'
 * Extra RUSTFLAGS build in their own `.build/wasm-target/<hash>` unless `--target-dir` names one. Each output directory
 * records what it holds in `build.json`, so replacing a release or hand-made module is announced, never silent. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rustTool } from './toolchain';

const root = resolve(import.meta.dir, '../..'), PUBLISHED = 'src/generated/naval-wasm';
const usage = 'Usage: build-wasm.ts [--dev] [--out-dir <dir>] [--rustflags <flags>] [--target-dir <dir>]';
const options: Record<string, string> = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const [flag, inline] = args[i].split(/=(.*)/s);
  if (flag === '--dev' && inline === undefined) options.dev = 'yes';
  else if (['--out-dir', '--rustflags', '--target-dir'].includes(flag) && (inline ?? args[i + 1]) !== undefined) options[flag.slice(2)] = inline ?? args[++i];
  else throw new Error(usage);
}
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const profile = options.dev ? 'wasm-dev' : 'release', rustflags = options.rustflags ?? '';
const outDir = resolve(root, options['out-dir'] ?? PUBLISHED), published = outDir === resolve(root, PUBLISHED);
const targetDir = resolve(root, options['target-dir'] ?? (rustflags ? `.build/wasm-target/${sha256(rustflags).slice(0, 12)}` : process.env.CARGO_TARGET_DIR ?? 'target'));
const wasm = `${targetDir}/wasm32-unknown-unknown/${profile}/naval_wasm.wasm`, shown = (path: string) => path.replace(`${root}/`, '');
interface Stamp { profile: string; rustflags: string; wasmSha256: string }
const describe = (stamp: Pick<Stamp, 'profile' | 'rustflags'>) => `${stamp.profile === 'release' ? 'release' : 'dev'} WASM${stamp.rustflags ? ` (RUSTFLAGS ${stamp.rustflags})` : ''}`;
const label = describe({ profile, rustflags });

// A module this script did not write, or one from another profile, is about to be replaced: say so before the build.
const stampFile = resolve(outDir, 'build.json'), moduleFile = resolve(outDir, 'naval_wasm_bg.wasm');
const stamp: Stamp | undefined = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : undefined;
if (stamp && existsSync(moduleFile)) {
  const restore = published && profile !== 'release' ? '; bun run multiplayer:prepare restores the release build' : '';
  if (stamp.wasmSha256 !== sha256(readFileSync(moduleFile))) {
    console.log(`Replacing ${shown(outDir)}: its module is not the one this script wrote (copied in or post-processed, e.g. by wasm-opt); `
      + `it becomes the ${label}. Build variants with --out-dir .build/<name>.`);
  } else if (stamp.profile !== profile || stamp.rustflags !== rustflags) console.log(`Replacing the ${describe(stamp)} in ${shown(outDir)} with the ${label}${restore}.`);
}

// Cargo decides what is stale; its first `Compiling` line is announced, since a rebuild can take minutes.
const env: Record<string, string | undefined> = { ...process.env, ...(rustflags ? { RUSTFLAGS: [process.env.RUSTFLAGS, rustflags].filter(Boolean).join(' ') } : {}) };
if (process.stderr.isTTY) Object.assign(env, { CARGO_TERM_COLOR: 'always', CARGO_TERM_PROGRESS_WHEN: 'always', CARGO_TERM_PROGRESS_WIDTH: String(process.stderr.columns || 100) });
const started = performance.now(), firstBuild = !existsSync(wasm), decoder = new TextDecoder();
const cargo = Bun.spawn([rustTool('cargo'), 'build', '-p', 'naval-wasm', '--target', 'wasm32-unknown-unknown', '--profile', profile, '--locked', '--target-dir', targetDir], {
  cwd: root, env, stdout: 'inherit', stderr: 'pipe',
});
let rebuilding = false, recent = '';
for await (const chunk of cargo.stderr) {
  if (!rebuilding) {
    recent = (recent + decoder.decode(chunk, { stream: true })).replace(/\x1b\[[\d;]*m/g, '').slice(-2000);
    const crate = recent.match(/Compiling (\S+)/)?.[1];
    if (crate) {
      rebuilding = true;
      console.log(firstBuild ? `Building ${label} for the first time in ${shown(targetDir)}; this can take minutes.` : `Rebuilding ${label}: sources changed since the last build (cargo is compiling ${crate}); this can take minutes.`);
    }
  }
  process.stderr.write(chunk);
}
if (await cargo.exited) throw new Error('Failed: cargo build');
const bindgen = Bun.spawn([rustTool('wasm-bindgen'), '--target', 'web', '--out-dir', outDir, wasm], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (await bindgen.exited) throw new Error('Failed: wasm-bindgen');
// Embed the exact local content/build identity; never adopt the server's version
// as our own, which would silently accept a stale browser deployment.
const { default: init, simulation_build, protocol_version, construction_shape_library } = await import(resolve(outDir, 'naval_wasm.js'));
const bytes = new Uint8Array(await Bun.file(moduleFile).arrayBuffer());
await init({ module_or_path: bytes });
await Bun.write(resolve(outDir, 'construction-shapes.json'), construction_shape_library());
if (published) {
  const manifest = new Uint8Array(await Bun.file(resolve(root, '.build/naval-content/manifest.json')).arrayBuffer());
  const rulesVersion = (await Bun.file(resolve(root, 'assets/gameplay/battle-rules.v1.json')).json()).version;
  await Bun.write(resolve(root, 'src/generated/naval-version.json'), JSON.stringify({ protocol: protocol_version(), simulationBuild: simulation_build(), manifestHash: sha256(manifest), rulesVersion }));
}
await Bun.write(stampFile, `${JSON.stringify({ profile, rustflags, targetDir: shown(targetDir), wasmSha256: sha256(bytes) }, null, 2)}\n`);
if (rebuilding || !published) console.log(`${rebuilding && !firstBuild ? 'Rebuilt' : 'Built'} ${label} in ${((performance.now() - started) / 1000).toFixed(0)} s: ${shown(outDir)}`);

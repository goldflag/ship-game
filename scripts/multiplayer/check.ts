/** `bun run multiplayer:check`: generated-source drift, rustfmt, Rust tests, clippy and the release WASM. Every step runs
 * even after another fails, so fmt drift cannot hide a failing test; only the content manifest, which the Rust tests and
 * the WASM build read, stops the run. Step logs are in `.build/multiplayer-check/`; `--verbose` (or CI) streams them. */
import { resolve } from 'node:path';
import { runSteps } from '../build/steps';
import { rustTool } from './toolchain';

const root = resolve(import.meta.dir, '../..'), cargo = rustTool('cargo'), bun = process.execPath;
process.exit(await runSteps('Multiplayer check', [
  { label: 'Simulation content', command: [bun, 'scripts/multiplayer/content.ts'], required: true },
  // Generated sources first: a stale definition.rs or ts-rs output explains later failures.
  { label: 'Rust definitions generator', command: [bun, 'test', 'scripts/multiplayer/generate-rust-definitions.test.ts'] },
  { label: 'Generated protocol types', command: [bun, 'scripts/multiplayer/check-generated-types.ts'] },
  // The workspace is rustfmt-clean; keeping it so makes `cargo fmt` a no-noise command.
  { label: 'cargo fmt --check', command: [cargo, 'fmt', '--all', '--check'] },
  // Full carrier scenarios are numerical simulation workloads. Test the optimized
  // production profile so CI can run every case within its execution budget.
  { label: 'cargo test --release', command: [cargo, 'test', '--release', '--workspace', '--locked', '--no-fail-fast'] },
  { label: 'cargo clippy', command: [cargo, 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'] },
  { label: 'Release WASM', command: [bun, 'scripts/multiplayer/build-wasm.ts'] },
], resolve(root, '.build/multiplayer-check'), { root }));

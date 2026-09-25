/**
 * The fast Rust edit-test loop, on the `test-fast` profile (see Cargo.toml).
 *
 *   bun run rust:test                                  whole workspace
 *   bun run rust:test -- <test-file-stem> [filter]     one naval-sim integration test binary
 *   bun run rust:test -- -p naval-protocol <stem> [filter]
 *   bun run rust:test -- <stem> [filter] -- --nocapture  arguments after a second `--` go to the test binary
 *
 * A stem is a file name under crates/<package>/tests without `.rs`.
 *
 * It regenerates .build/naval-content/manifest.json first (under a second): the tests read the catalog from it, and a
 * manifest left from bootstrap or an earlier ship:hydrostatics passes or fails them against stale content.
 */
import { existsSync, readdirSync } from 'node:fs';
import { rustTool } from './toolchain';

const raw = process.argv.slice(2), split = raw.indexOf('--', raw[0] === '--' ? 1 : 0);
const args = (split < 0 ? raw : raw.slice(0, split)).filter(arg => arg !== '--'), harness = split < 0 ? [] : raw.slice(split + 1);
let pkg = 'naval-sim';
if (args[0] === '-p' || args[0] === '--package') {
  pkg = args[1] ?? '';
  args.splice(0, 2);
}
const [stem, ...filter] = args;
const root = new URL('../..', import.meta.url).pathname;
const content = Bun.spawnSync([process.execPath, 'scripts/multiplayer/content.ts'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
if (content.exitCode) {
  console.error(`Simulation content failed, so the tests would read a stale catalog:\n${content.stdout}${content.stderr}`);
  process.exit(content.exitCode);
}
const command = [rustTool('cargo'), 'test', '--profile', 'test-fast', '--locked'];
if (!stem) command.push('--workspace');
else {
  const dir = `crates/${pkg}/tests`;
  if (!existsSync(`${dir}/${stem}.rs`)) {
    const known = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.rs')).map(f => f.slice(0, -3)).sort() : [];
    console.error(`No integration test ${dir}/${stem}.rs. Known stems:\n  ${known.join(' ')}\nUnit tests inside src/ run with: cargo test -p ${pkg} --profile test-fast --lib <filter>`);
    process.exit(2);
  }
  command.push('-p', pkg, '--test', stem, ...filter);
}
command.push('-q', '--no-fail-fast', ...(harness.length ? ['--', ...harness] : []));
console.error(`$ ${command.join(' ')}`);
const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);

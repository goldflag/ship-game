/**
 * The fast Rust edit-test loop, on the `test-fast` profile (see Cargo.toml).
 *
 *   bun run rust:test                                  whole workspace
 *   bun run rust:test -- <test-file-stem> [filter]     one naval-sim integration test binary
 *   bun run rust:test -- -p naval-protocol <stem> [filter]
 *
 * A stem is a file name under crates/<package>/tests without `.rs`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { rustTool } from './toolchain';

const args = process.argv.slice(2).filter(arg => arg !== '--');
let pkg = 'naval-sim';
if (args[0] === '-p' || args[0] === '--package') {
  pkg = args[1] ?? '';
  args.splice(0, 2);
}
const [stem, ...filter] = args;
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
command.push('-q', '--no-fail-fast');
console.error(`$ ${command.join(' ')}`);
const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);

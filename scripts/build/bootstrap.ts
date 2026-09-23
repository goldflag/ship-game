/** `bun run bootstrap`: everything a fresh worktree needs before tests, the dev server or the browser
 * harness work. Safe to rerun; each step is skipped or fast when already done. */
import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mainCheckout, designsCache } from '../browser/designs';
import { worktreePort } from './dev-port';

const root = resolve(import.meta.dir, '../..'), main = mainCheckout(root);
const run = (label: string, command: string[]) => {
  const started = performance.now(), result = Bun.spawnSync(command, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) { console.error(result.stdout.toString(), result.stderr.toString()); throw new Error(`${label} failed.`); }
  console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
};
run('Dependencies', [process.execPath, 'install', '--frozen-lockfile']);
// The scripts fall back to ~/.cargo/bin (scripts/multiplayer/toolchain.ts); a shell running cargo itself needs it on PATH.
if (!Bun.which('cargo') && existsSync(join(homedir(), '.cargo/bin/cargo'))) console.log('Rust: cargo is not on PATH; for your own cargo commands run export PATH="$HOME/.cargo/bin:$PATH"');
run('Simulation content and dev WASM', [process.execPath, 'run', 'multiplayer:prepare:dev']);
// Test-account credentials stay in the durable checkout; a linked worktree gets a copy of the ignored file.
if (main !== root && !existsSync(join(root, '.env.local')) && existsSync(join(main, '.env.local'))) { copyFileSync(join(main, '.env.local'), join(root, '.env.local')); console.log('.env.local: copied from the main checkout'); }
// Probed in a child: this process resolved its modules before the install, and a failed import here once read as "missing".
const probe = Bun.spawnSync([process.execPath, '-e', "console.log((await import('playwright')).chromium.executablePath())"], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
const chromium = probe.stdout.toString().trim(), failure = probe.stderr.toString().split('\n').find(line => /error/i.test(line))?.trim();
console.log(`Playwright Chromium: ${probe.exitCode ? `cannot load playwright (${failure ?? `exit ${probe.exitCode}`}); run bun install`
  : existsSync(chromium) ? 'installed' : `missing: ${chromium} does not exist; run bunx playwright install chromium`}`);
console.log(`Saved designs for the harness: ${existsSync(designsCache(root)) ? 'cached' : 'not cached; run bun run harness:designs'}`);
console.log(`Dev server: bun run dev serves http://127.0.0.1:${main === root ? 5173 : worktreePort(root)}/ (.build/dev-server.json holds the live URL once its status is "ready")`);
console.log('Next: bun run check (typecheck and tests for your changes), bun run ui:shot (see docs/browser-verification.md)');

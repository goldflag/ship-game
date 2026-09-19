/** `bun run bootstrap`: everything a fresh worktree needs before tests, the dev server or the browser
 * harness work. Safe to rerun; each step is skipped or fast when already done. */
import { copyFileSync, existsSync } from 'node:fs';
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
run('Simulation content and dev WASM', [process.execPath, 'run', 'multiplayer:prepare:dev']);
// Test-account credentials stay in the durable checkout; a linked worktree gets a copy of the ignored file.
if (main !== root && !existsSync(join(root, '.env.local')) && existsSync(join(main, '.env.local'))) { copyFileSync(join(main, '.env.local'), join(root, '.env.local')); console.log('.env.local: copied from the main checkout'); }
const chromium = await import('playwright').then(({ chromium }) => existsSync(chromium.executablePath())).catch(() => false);
console.log(`Playwright Chromium: ${chromium ? 'installed' : 'missing; run bunx playwright install chromium'}`);
console.log(`Saved designs for the harness: ${existsSync(designsCache(root)) ? 'cached' : 'not cached; run bun run harness:designs'}`);
console.log(`Dev server: bun run dev serves http://127.0.0.1:${main === root ? 5173 : worktreePort(root)}/ (the live URL is written to .build/dev-server.json)`);
console.log('Next: bun run check (typecheck and tests for your changes), bun run ui:shot (see docs/browser-verification.md)');

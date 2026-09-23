/** `bun run build`: the release gate. Every check runs even after another fails, so a stale ship does not hide a type
 * error; only simulation preparation stops the run, because the checks, TypeScript and the bundle all read its output.
 * Step logs are in `.build/release/`; `--verbose` (or CI) streams them instead. */
import { resolve } from 'node:path';
import { requireBootstrapped } from './ready';
import { runSteps } from './steps';

const root = resolve(import.meta.dir, '../..'), bun = process.execPath, bin = (name: string) => resolve(root, 'node_modules/.bin', name);
requireBootstrapped(root);
process.exit(await runSteps('Release build', [
  { label: 'multiplayer:prepare', command: [bun, 'run', 'multiplayer:prepare'], required: true },
  { label: 'part:published:check', command: [bun, 'run', 'part:published:check'] },
  { label: 'part:thumbnails --check', command: [bun, 'run', 'part:thumbnails', '--check'] },
  { label: 'ship:check all', command: [bun, 'run', 'ship:check', 'all'] },
  { label: 'ship:runtime:check', command: [bun, 'run', 'ship:runtime:check'] },
  { label: 'aircraft:check all', command: [bun, 'run', 'aircraft:check', 'all'] },
  { label: 'tsc --noEmit', command: [bin('tsc'), '--noEmit'] },
  { label: 'vite build', command: [bin('vite'), 'build'] },
], resolve(root, '.build/release'), { root }));

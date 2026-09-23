/** `bun run multiplayer:prepare[:dev]`: simulation content, then the WASM module (arguments go to build-wasm.ts). The
 * dev server, tests, check and ui:shot run it first, so a worktree that was never bootstrapped stops here with that advice
 * instead of a module-not-found error from the content generator. */
import { resolve } from 'node:path';
import { requireBootstrapped } from '../build/ready';

const root = resolve(import.meta.dir, '../..');
requireBootstrapped(root);
for (const script of ['content.ts', 'build-wasm.ts']) {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, script), ...script === 'build-wasm.ts' ? process.argv.slice(2) : []], {
    cwd: root, stdio: ['inherit', 'inherit', 'inherit'],
  });
  const code = await child.exited;
  if (code) process.exit(code);
}

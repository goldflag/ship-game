import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** A linked worktree's own port, stable across restarts: 5200-5899 from its path. With every worktree
 * defaulting to one port, the second server silently took the next one and sessions drove the wrong game. */
export function worktreePort(root: string): number {
  return 5200 + createHash('sha256').update(realpathSync(root)).digest().readUInt16BE(0) % 700;
}

/** Reserve the familiar game URL for the durable checkout, regardless of branch. Every dev server records
 * where it is listening in `.build/dev-server.json`, so scripts and agents read the URL instead of guessing.
 * `bun run dev` writes it first with `status: "preparing"` (scripts/build/dev.ts); wait for `status: "ready"`. */
export function devPort(root: string): Plugin {
  let linkedWorktree = false;
  return {
    name: 'checkout-dev-port',
    apply: 'serve',
    config(config) {
      const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: root, encoding: 'utf8',
      }).trim();
      linkedWorktree = realpathSync(root) !== realpathSync(dirname(commonDir));
      return { server: {
        port: config.server?.port ?? (linkedWorktree ? worktreePort(root) : 5173),
        strictPort: linkedWorktree ? (config.server?.strictPort ?? false) : true,
      } };
    },
    configureServer(server) {
      // Short-lived review and harness servers keep their own cache directory; they are not this checkout's dev server.
      if (server.config.cacheDir.includes('.build/construction')) return;
      const file = join(root, '.build/dev-server.json');
      server.httpServer?.once('listening', () => {
        const address = server.httpServer!.address();
        if (!address || typeof address === 'string') return;
        // Always the IPv4 loopback: `localhost` may resolve to ::1, where a 0.0.0.0 listener is absent.
        const url = `http://127.0.0.1:${address.port}${server.config.base}`;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify({ status: 'ready', url, port: address.port, pid: process.pid, harness: `${url}scripts/diagnostics/app.html` }, null, 2)}\n`);
        server.config.logger.info(`  Dev server for this checkout: ${url} (recorded in .build/dev-server.json)`);
      });
      server.httpServer?.once('close', () => rmSync(file, { force: true }));
    },
    configResolved(config) {
      if (linkedWorktree && config.server.port === 5173) {
        throw new Error('Port 5173 is reserved for the main checkout. Omit --port to use the port derived for this worktree.');
      }
    },
  };
}

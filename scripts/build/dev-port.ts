import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plugin } from 'vite';

/** Reserve the familiar game URL for the durable checkout, regardless of branch. */
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
        port: config.server?.port ?? (linkedWorktree ? 5200 : 5173),
        strictPort: linkedWorktree ? (config.server?.strictPort ?? false) : true,
      } };
    },
    configResolved(config) {
      if (linkedWorktree && config.server.port === 5173) {
        throw new Error('Port 5173 is reserved for the main checkout. Use --port 5200 or another worktree port.');
      }
    },
  };
}

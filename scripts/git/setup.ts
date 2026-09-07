import { resolve } from 'node:path';

function git(...args: string[]) {
  const result = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
const root = git('rev-parse', '--show-toplevel');
// Absolute paths keep linked worktrees usable when replaying old commits that
// predate this script. Settings are repository-local, never global.
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
git('config', '--local', 'merge.ship-catalog.name', 'Merge ship catalog entries by stable ID');
git('config', '--local', 'merge.ship-catalog.driver', `${quote(process.execPath)} ${quote(resolve(root, 'scripts/git/catalog-merge.ts'))} %O %A %B`);
git('config', '--local', 'rerere.enabled', 'true');
git('config', '--local', 'rerere.autoupdate', 'false');
git('config', '--local', 'merge.conflictStyle', 'zdiff3');
console.log('Installed ID-aware catalog merging, remembered resolutions (manual staging), and base-aware conflict markers for this repository.');

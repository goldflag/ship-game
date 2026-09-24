/** What `ship:build` runs after publishing: the built ships' stale hydrostatic tables, then `multiplayer:content`,
 * so the game, the preset catalog and both simulations load the new definition without "model and definition have
 * different versions" or "Stale hydrostatic table". Unregistered ships are skipped with a note. A lock directory
 * serialises builds in one worktree; `ship:build all` passes --no-refresh to each ship and refreshes once. */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { presetIds } from './runtime-assets';
import { refreshHydrostatics } from './hydrostatics';

export async function refreshRuntime(root: string, ids: string[], log = console.error): Promise<void> {
  const roster = await presetIds(root);
  const registered = ids.filter(id => roster.includes(id));
  const skipped = ids.filter(id => !roster.includes(id));
  if (skipped.length)
    log(`Not in src/ships/presets.ts: ${skipped.join(', ')}. After registering, run bun run ship:hydrostatics ${skipped.join(' ')} and bun run multiplayer:content.`);
  if (!registered.length) return;
  const lock = join(root, '.build/ships/runtime-refresh.lock');
  await mkdir(join(root, '.build/ships'), { recursive: true });
  for (const deadline = Date.now() + 10 * 60_000; ; ) {
    try { await mkdir(lock); break; } catch {}
    if (Date.now() > deadline) throw new Error(`Another build has held ${lock} for ten minutes. If it has stopped, remove that directory.`);
    await Bun.sleep(250);
  }
  try {
    const started = performance.now();
    const solved = await refreshHydrostatics(root, registered, log);
    // A fresh process: the content generator imports the table file this one may just have rewritten.
    const child = Bun.spawn([process.execPath, join(root, 'scripts/multiplayer/content.ts')], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(`Published ${registered.join(', ')}, but multiplayer:content failed:\n${(out + err).trim()}`);
    log(`Runtime content refreshed in ${((performance.now() - started) / 1000).toFixed(1)} s${solved.length ? ` (hydrostatics: ${solved.join(', ')})` : ''}. ${out.trim()}`);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

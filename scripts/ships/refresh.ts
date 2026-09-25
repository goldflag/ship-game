/** What `ship:build` runs after publishing: the editor's hull presets when a ship they are cut from was built (and the
 * construction ships whose model inputs include them), the built ships' stale hydrostatic tables, then
 * `multiplayer:content`, so the game, the preset catalog and both simulations load the new definition without "model
 * and definition have different versions" or "Stale hydrostatic table". Unregistered ships are skipped with a note. A
 * lock directory serialises builds in one worktree; `ship:build all` passes --no-refresh to each ship and refreshes once. */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { presetIds } from './runtime-assets';
import { refreshHydrostatics } from './hydrostatics';
import { HULL_PRESETS_FILE, PRESET_SHIPS, writeHullPresets } from '../construction/hull-presets';

/** Regenerates the hull presets after a source ship's build. The construction model recipe imports them (the default
 * custom hull), so a change restales every construction preset: those are checked and rebuilt here (~10 s each). */
async function refreshHullPresets(root: string, ids: string[], roster: string[], log: (message: string) => void) {
  if (!ids.some(id => (PRESET_SHIPS as readonly string[]).includes(id)) || !await writeHullPresets(root)) return;
  const constructed = [];
  for (const id of roster) {
    const blueprint = JSON.parse(await readFile(join(root, 'assets/ships', id, 'blueprint.json'), 'utf8'));
    if (blueprint.construction && !blueprint.hull) constructed.push(id);
  }
  const pipeline = (action: string, id: string) => Bun.spawn([process.execPath, join(root, 'scripts/ships/pipeline.ts'), action, id, '--no-refresh'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const stale = [];
  for (const id of constructed) if (await pipeline('check', id).exited) stale.push(id);
  log(`Rewrote ${HULL_PRESETS_FILE} from ${ids.filter(id => (PRESET_SHIPS as readonly string[]).includes(id)).join(', ')}${stale.length ? `; rebuilding ${stale.join(', ')}, whose model inputs include it` : ''}. Commit it with this build.`);
  for (const id of stale) {
    const child = pipeline('build', id), [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(`Rewrote ${HULL_PRESETS_FILE}, but rebuilding ${id} failed:\n${(out + err).trim()}`);
  }
}

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
    await refreshHullPresets(root, registered, roster, log);
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

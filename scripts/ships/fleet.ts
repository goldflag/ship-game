import { shipPresets } from '../../src/ships/presets';

/** The runtime roster also owns fleet validation; adding a preset needs no build-script edit. */
export async function runFleet(action: string): Promise<number> {
  const failed: string[] = [];
  for (const id of Object.keys(shipPresets)) {
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/pipeline.ts`, action, id], {
      stdout: 'pipe', stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code) {
      failed.push(id);
      console.error(`${id}: ${action} failed\n${out}${err}`);
    } else console.log(`${id}: ${action} passed`);
  }
  if (failed.length) console.error(`Failed ships: ${failed.join(', ')}`);
  return failed.length ? 1 : 0;
}

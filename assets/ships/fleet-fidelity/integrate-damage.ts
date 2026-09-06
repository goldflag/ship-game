/** One-time original-data integration recipe; never a production build dependency.
 * Replays the named, retained Git snapshots. --write deliberately replaces the
 * catalog and three fidelity blueprints; run flood-space/stability recipes next.
 */
import { writeFile } from 'node:fs/promises';
import { compileShip, type ShipBlueprint } from '../../../src/ships/blueprint';

function original(ref: string, path: string) {
  const result = Bun.spawnSync(['git', 'show', `${ref}:${path}`]);
  if (result.exitCode) throw new Error(`Missing integration source ${ref}:${path}`);
  return JSON.parse(result.stdout.toString());
}
const fidelity = '31a84b5', damage = '22ee7b2', base = 'd04f69e';
const catalogPath = 'assets/parts/guns.json';
const catalog = original(fidelity, catalogPath);
const previousCatalog = original(base, catalogPath), incomingCatalog = original(damage, catalogPath);
for (const part of catalog.parts) {
  const previous = previousCatalog.parts.find((p: { id: string }) => p.id === part.id);
  const incoming = incomingCatalog.parts.find((p: { id: string }) => p.id === part.id);
  if (!incoming || !previous) throw new Error(`Unmapped catalog part ${part.id}`);
  for (const key of Object.keys(incoming)) {
    if (JSON.stringify(incoming[key]) === JSON.stringify(previous[key])) continue;
    if (!['ballistics', 'ap', 'he'].includes(key)) throw new Error(`Unexpected incoming part change ${part.id}.${key}`);
    part[key] = incoming[key];
  }
}
const products: [string, unknown][] = [[catalogPath, catalog]];
for (const id of ['yamato', 'baltimore', 'enterprise-cv6']) {
  const path = `assets/ships/${id}/blueprint.json`;
  const blueprint = original(fidelity, path) as ShipBlueprint;
  const incoming = original(damage, path) as ShipBlueprint;
  blueprint.damageControl = incoming.damageControl;
  blueprint.propulsion = incoming.propulsion;
  for (const module of blueprint.modules) {
    const previous = incoming.modules.find(m => m.id === module.id);
    module.immersionToleranceM = previous?.immersionToleranceM ?? .3;
    if (module.kind === 'engine') module.role = previous?.role ?? 'combined-drive';
  }
  if (id === 'yamato') {
    const drives = blueprint.modules.filter(m => m.kind === 'engine');
    blueprint.propulsion = {
      groups: drives.map(m => ({ id: `${m.id}-group`, share: 1 / drives.length, boilerIds: [], driveIds: [m.id], shaftIds: [] })),
      basis: 'Four retained turbine envelopes act as combined drive groups with equal provisional power shares. The twelve boiler-room envelopes are not separately damageable boiler modules; steam supply and shafts remain aggregated, not a recovered routing plan.',
    };
  }
  blueprint.connections = blueprint.connections.map(connection => {
    const previous = incoming.connections.find(c => [c.fromId, c.toId].sort().join(':') === [connection.fromId, connection.toId].sort().join(':'));
    if (!previous?.id) throw new Error(`${id}: unmapped retained boundary`);
    const a = blueprint.compartments.find(c => c.id === connection.fromId)!;
    const b = blueprint.compartments.find(c => c.id === connection.toId)!;
    return { ...connection, id: previous.id, state: 'closed', position: a.center.map((n, axis) => (n + b.center[axis]) / 2) as [number, number, number] };
  });
  // Old residual cells/regions/loading belong to the superseded room/hull layout.
  // The existing original recipes regenerate those against this merged blueprint.
  compileShip(blueprint, catalog);
  products.push([path, blueprint]);
  console.log(id, blueprint.modules.length, 'retained modules;', blueprint.compartments.length, 'retained room envelopes');
}
if (process.argv.includes('--write')) {
  for (const [path, data] of products) await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  console.log('Wrote merged originals. Run author-flood-spaces.ts for each target, then author-stability.ts and the shared ship pipeline.');
} else console.log('Dry run only. --write deliberately replays the named snapshots.');

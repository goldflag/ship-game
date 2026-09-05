import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ShipBlueprint } from '../../src/ships/blueprint';
const id = process.argv[2];
if (!id || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Usage: bun run ship:new <lowercase-ship-id>');
const root = resolve(import.meta.dir, '../..'), folder = resolve(root, 'assets/ships', id);
if (existsSync(folder)) throw new Error(`Ship ${id} already exists; no files changed.`);
const blueprint: ShipBlueprint = {
  schemaVersion: 1, id, name: id, configuration: 'Original starter hull; replace with a sourced ship specification', coordinates: 'meters-y-up-bow-negative-z', modelUrl: `/models/${id}.glb`,
  hull: { kind: 'authored-stations-v1', length: 100, beam: 14, draft: 4, depth: 8, massKg: 3000000, waterplaneAreaM2: 1000, reserveBuoyancyM3: 800, halfBreadths: [[0, 0], [15, 5], [40, 7], [60, 7], [85, 4], [100, 0]], deckHeights: [[0, 4], [100, 4]], keelHeights: [[0, -4], [100, -4]] },
  handling: { forwardSpeed: 12, reverseSpeed: 3, acceleration: .3, braking: .25, rudderRate: .5, maxYawRate: .03 },
  mounts: [{ id: 'forward-gun', name: 'Forward gun', partId: 'sk-c28-150-twin', battery: 'main', position: [0, 4, -25], bearingDeg: 0, rangefinder: false }],
  armor: [{ id: 'hull-plating', name: 'Hull plating', center: [0, 0, 0], size: [14, 8, 90], thicknessMm: 25 }],
  compartments: [{ id: 'machinery-space', name: 'Machinery space', center: [0, 0, 0], size: [10, 7, 30], capacityM3: 1500, pumpM3PerSecond: .03 }],
  modules: [{ id: 'machinery', name: 'Machinery', kind: 'engine', center: [0, 0, 0], size: [8, 5, 20], hp: 100, compartmentId: 'machinery-space' }],
  connections: [], obstructions: [], accuracy: { exterior: 'Original starter geometry, not a historical reconstruction.', internals: 'Simplified gameplay volumes.', weapons: 'Provisional gameplay performance.' },
};
await mkdir(resolve(folder, 'references'), { recursive: true });
await mkdir(resolve(folder, 'reports'), { recursive: true });
await writeFile(resolve(folder, 'blueprint.json'), JSON.stringify(blueprint, null, 2) + '\n');
await writeFile(resolve(folder, 'build.py'), `"""Replace or extend this original starter recipe for ${id}."""\nfrom pathlib import Path\nimport runpy\nrunpy.run_path(str(Path(__file__).resolve().parents[3]/'scripts/ships/starter.py'),run_name='__main__')\n`);
await writeFile(resolve(folder, 'references/sources.json'), JSON.stringify({ configuration: blueprint.configuration, sources: [] }, null, 2) + '\n');
await writeFile(resolve(folder, 'README.md'), `# ${id}\n\nUnverified original starter. Follow [the ship pipeline](../../../docs/ship-pipeline.md) before developing this ship.\n\nBuild: \`bun run ship:build ${id}\`\nReview: \`bun run ship:review ${id}\`\n`);
console.log(`Created ${folder}. Edit blueprint.json and build.py, then run bun run ship:build ${id}.`);

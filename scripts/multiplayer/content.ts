import { aircraftBomb, aircraftTorpedo } from '../../src/ships/aircraftWeapons';
import { aircraftGroundPose } from '../../src/game/aircraftGroundPose';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { runtimeAssets } from '../ships/runtime-assets';
import rules from '../../assets/gameplay/battle-rules.v1.json';
import pveMission from '../../assets/gameplay/pve-mission.v1.json';
import legacyAir from '../../assets/gameplay/legacy-air.v1.json';
import pveAir from '../../assets/gameplay/pve-air.v1.json';
import { aircraftDeckGeometry } from './aircraft-deck-geometry';
import hydrostatics from '../../assets/gameplay/hydrostatics.v1.json';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const { ships, summaries } = await runtimeAssets();
const maps = JSON.parse(await Bun.file('assets/maps/environments.v1.json').text()) as { maps: { id: string; land?: { terrain?: string | null } }[] };
// Real-world battle terrain: every map's baked heightfield (scripts/maps/bake-terrain.py). The native manifest
// carries the bytes; the browser index names the file, and the worker fetches only the one its battle needs.
const terrain = await Promise.all([...new Set(maps.maps.flatMap(map => map.land?.terrain ? [map.land.terrain] : []))].sort().map(async id => {
  const file = Bun.file(`public/maps/terrain/${id}.ntf`);
  if (!(await file.exists())) throw new Error(`Missing baked terrain public/maps/terrain/${id}.ntf. Run python3 scripts/maps/bake-terrain.py ${id}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { id, sha256: digest(bytes), data: Buffer.from(bytes).toString('base64') };
}));
const shipPresets = summaries as Record<string, import('../../src/ships/blueprint').ShipDefinition>;
// Derived hull content: the two simulations must interpolate the same solved
// table or their goldens drift, so it ships in the manifest rather than being
// rebuilt per host.
const hydro = Object.entries(shipPresets).filter(([, definition]) => definition.hull.kind !== 'constructed-volume-v1').map(([id, definition]) => {
  const table = (hydrostatics.ships as Record<string, { contentHash: string }>)[id];
  if (table?.contentHash !== definition.contentHash) throw new Error(`Stale hydrostatic table: ${id}. Run bun run ship:hydrostatics`);
  return { id, ...table };
});
const manifest = {
  version: 1, rulesVersion: rules.version, missions: [pveMission], airProfiles: [legacyAir, pveAir], ships, hydrostatics: hydro,
  aircraft: await Promise.all([...new Set(Object.values(shipPresets).flatMap(def => def.airWing?.squadrons.map(s => s.modelId) ?? []))].map(async id => ({ id, ...aircraftGroundPose(id), deckGeometry: await aircraftDeckGeometry(id), bomb: aircraftBomb(id), torpedo: aircraftTorpedo(id) }))),
  terrain,
  maps,
  conditions: JSON.parse(await Bun.file('assets/maps/battle-conditions.v1.json').text()),
};
const json = JSON.stringify(manifest);
await mkdir('.build/naval-content', { recursive: true });
await Bun.write('.build/naval-content/manifest.json', json);
const index = {
  ...manifest,
  ships: ships.map(({ json, ...entry }) => ({ ...entry, url: '/models/runtime/' + entry.id + '.nsd' })),
  terrain: terrain.map(({ data, ...entry }) => ({ ...entry, url: `/maps/terrain/${entry.id}.ntf` })),
};
await Bun.write('.build/naval-content/index.json', JSON.stringify(index));
console.log(`Naval content: ${ships.length} definitions; SHA-256 ${digest(json)}`);

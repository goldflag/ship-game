import { aircraftBomb, aircraftTorpedo } from '../../src/simulation/aircraftWeapons';
import { aircraftGroundPose } from '../../src/simulation/aircraftGroundPose';
import { terrainField } from '../../src/maps/terrain';
import maps from '../../assets/maps/environments.v1.json';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { shipPresets } from '../../src/ships/presets';
import rules from '../../assets/gameplay/battle-rules.v1.json';
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const ships = await Promise.all(Object.entries(shipPresets).map(async ([id, definition]) => {
  const json = await Bun.file(`public/models/${id}.json`).text();
  if (JSON.parse(json).contentHash !== definition.contentHash) throw new Error(`Catalog content mismatch: ${id}`);
  return { id, contentHash: definition.contentHash, sha256: digest(json), json };
}));
const manifest = {
  version: 1, rulesVersion: rules.version, ships,
  aircraft: [...new Set(Object.values(shipPresets).flatMap(def => def.airWing?.squadrons.map(s => s.modelId) ?? []))].map(id => ({ id, ...aircraftGroundPose(id), bomb: aircraftBomb(id), torpedo: aircraftTorpedo(id) })),
  terrain: [...new Map(maps.maps.flatMap(map => map.land.islands.map(island => {
    const recipe = { ...island, style: map.land.style };
    return [`${island.seed}:${recipe.style}`, { seed: island.seed, style: recipe.style, samples: Array.from(terrainField(recipe)) }] as const;
  }))).values()],
  maps: JSON.parse(await Bun.file('assets/maps/environments.v1.json').text()),
  conditions: JSON.parse(await Bun.file('assets/maps/battle-conditions.v1.json').text()),
};
const json = JSON.stringify(manifest);
await mkdir('.build/naval-content', { recursive: true });
await Bun.write('.build/naval-content/manifest.json', json);
console.log(`Naval content: ${ships.length} definitions; SHA-256 ${digest(json)}`);

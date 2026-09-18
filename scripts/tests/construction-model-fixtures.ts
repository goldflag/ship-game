import type { ConstructionCatalog, ConstructionEquipment, ConstructionSource, Vec3 } from '../../src/ships/blueprint';
import { createStarterSource } from '../../src/ships/constructionStarter';

/** A test platform, not a playable preset: fixed original parts spaced for independent sweeps. */
export function equipmentReviewSource(catalog: ConstructionCatalog, kind: 'collection' | 'neighbors' | 'patrol' | 'overhead' = 'collection'): ConstructionSource {
  if (kind === 'patrol') return createStarterSource(catalog, 'patrol');
  const source = createStarterSource(catalog, 'blank');
  // These legacy fixtures exercise explicit magazine links and their original clearances.
  source.construction.version = 1;
  source.id = `equipment-review-${kind}`; source.revision = `equipment-review-${kind}-1`;
  source.name = kind === 'neighbors' ? 'Independent neighboring mounts' : 'Installed original equipment collection';
  source.construction.defaultThicknessMm = 16;
  source.construction.primitives = [{ id: 'platform', kind: 'box', position: [0, 0, 0], size: [80, 20, 200], rotationDeg: 0 }];
  const fitted = source.construction.equipment;
  const part = (id: string) => { const p = catalog.equipment.find(p => p.id === id); if (!p) throw new Error(`Review component missing: ${id}`); return p; };
  const put = (id: string, partId: string, position: Vec3, bearingDeg = 0, links: Partial<ConstructionEquipment> = {}) => {
    part(partId); fitted.push({ id, partId, position, bearingDeg, ...links });
  };
  const deck = (id: string, partId: string, x: number, z: number, bearing = 0, links: Partial<ConstructionEquipment> = {}) => {
    const socket = part(partId).sockets?.find(s => s.id === 'attachment');
    put(id, partId, [x, 10 - (socket?.position[1] ?? 0), z], bearing, links);
  };
  const gun = (id: string, partId: string, x: number, z: number, bearing: number) => {
    const canonical = catalog.weapons.parts.find(p => p.id === partId)!;
    const stock = canonical.ammoPerBarrel * (canonical.barrelCount ?? 2);
    const magazine = catalog.equipment.filter(p => p.kind === 'magazine' && (p.ammunitionCapacity ?? 0) >= stock)
      .sort((a, b) => a.ammunitionCapacity! - b.ammunitionCapacity!)[0];
    if (!magazine) throw new Error(`No magazine can hold the canonical ${stock}-round load of ${partId}`);
    put(`${id}-magazine`, magazine.id, [x, -9.984, z]);
    deck(id, partId, x, z, bearing, { magazineId: `${id}-magazine` });
  };
  if (kind === 'neighbors') {
    gun('near-a', 'us-5in38-mk30-mod0-single', -2.5, 0, 0);
    gun('near-b', 'us-5in38-mk30-mod0-single', 2.5, 0, 180);
    return source;
  }
  for (const [id, partId, x, z, bearing] of [
    ['dd-a', 'us-5in38-mk30-mod0-single', -22, -76, 37],
    ['dd-b', 'us-5in38-mk30-mod0-single', 22, -76, -73],
    ['cl-a', 'us-6in47-mk16-cleveland', -22, -38, 23],
    ['cl-b', 'us-6in47-mk16-cleveland', 22, -38, 180],
    ['bb-a', 'sk-c34-380-twin', -22, 4, 90],
    ['bb-b', 'sk-c34-380-twin', 22, 4, 270],
    ['aa-a', 'us-20mm-oerlikon-mk4-hsienyang', -22, 45, 90],
    ['aa-b', 'us-20mm-oerlikon-mk4-hsienyang', 22, 45, -90],
  ] as const) gun(id, partId, x, z, bearing);
  put('engine', 'generic-diesel-3000kw', [0, -9.984, 65]);
  deck('funnel', 'fletcher-funnel', 0, 65, 0, { powerSourceId: 'engine' });
  deck('mast', 'fletcher-aft-mast', 0, 42);
  deck('director', 'fletcher-mk37-director', 0, -70);
  for (const [id, x, bearing] of [['torpedo-a', -22, 90], ['torpedo-b', 22, -90]] as const) {
    put(`${id}-magazine`, 'generic-magazine-1000', [x, -9.984, 76]);
    deck(id, 'fletcher-quintuple-533', x, 76, bearing, { magazineId: `${id}-magazine` });
  }
  for (const [id, p, x] of [['large-screw', 'generic-propeller-4200', -12], ['small-screw', 'generic-propeller-1200', 12]] as const) {
    const seat = part(p).sockets!.find(s => s.id === 'attachment')!.position;
    put(id, p, [x, -9, 100 - seat[2]], 0, { powerSourceId: 'engine' });
  }
  for (const [id, p, x] of [['large-rudder', 'generic-rudder-4000', -12], ['small-rudder', 'generic-rudder-1000', 12]] as const) {
    const seat = part(p).sockets!.find(s => s.id === 'attachment')!.position;
    put(id, p, [x, -10 - seat[1], 95]);
  }
  if (kind === 'overhead') {
    source.name = 'Original AA with connected overhead obstruction';
    source.construction.primitives.push(
      { id: 'aa-pillar', kind: 'box', position: [-19, 11.5, 45], size: [.4, 3, 1], rotationDeg: 0 },
      { id: 'aa-beam', kind: 'box', position: [-22, 13, 45], size: [8, .5, 1], rotationDeg: 0 },
    );
  }
  return source;
}

/** Explicit small trial layout; valid loading is compiled, never rescaled or ballasted. */
export function equipmentCombatSource(catalog: ConstructionCatalog): ConstructionSource {
  const source = createStarterSource(catalog, 'patrol');
  source.id = 'equipment-combat-review'; source.revision = 'equipment-combat-review-1'; source.name = 'Equipment combat review';
  source.construction.boundaries = [{ id: 'forward-divider', axis: 'z', offset: -7.5, thicknessMm: 8 }, { id: 'aft-divider', axis: 'z', offset: 12, thicknessMm: 8 }];
  const mast = source.construction.equipment.find(p => p.id === 'mast')!; mast.position = [-2.5, 2.5, -5];
  source.construction.equipment.push(
    { id: 'aa-magazine', partId: 'generic-magazine-2000', position: [0, -2.484, -3], bearingDeg: 0 },
    { id: 'aa', partId: 'us-20mm-oerlikon-mk4-hsienyang', position: [2, 2.5, -3], bearingDeg: 90, magazineId: 'aa-magazine' },
    { id: 'director', partId: 'fletcher-mk37-director', position: [0, 2.5, 11], bearingDeg: 0 },
    { id: 'torpedo-bank', partId: 'fletcher-quintuple-533', position: [0, 2.6, 18], bearingDeg: 90, magazineId: 'magazine' },
  );
  return source;
}

/** A supported deck and wall for original fittings plus their connected routes.
 * This is separate from the weapon sweep fixture so new fittings cannot alter
 * its ammunition, mount count or independent articulation cases. */
export function deckFittingsFixture(catalog: ConstructionCatalog): ConstructionSource {
  const source = createStarterSource(catalog, 'blank');
  source.name = 'Deck fittings review';
  source.construction.primitives = [
    { id: 'review-deck', kind: 'box', size: [24, 2, 36], position: [0, 0, 0], rotationDeg: 0 },
    { id: 'review-wall', kind: 'box', size: [22, 3, .5], position: [0, 2.5, 15], rotationDeg: 0 },
  ];
  source.construction.surfaces = []; source.construction.boundaries = []; source.construction.loads = [];
  source.construction.equipment = [];
  const deck = ['twin-bitts', 'fairlead', 'capstan', 'anchor-windlass', 'mushroom-vent', 'cowl-vent',
    'deck-hatch', 'optical-rangefinder', 'static-searchlight', 'inclined-stairs', 'lifeboat-davits'];
  deck.forEach((name, i) => source.construction.equipment.push({
    id: `review-${name}`, partId: `generic-${name}`, position: [-8 + (i % 3) * 8, 1, -10 + Math.floor(i / 3) * 6], bearingDeg: 0,
  }));
  ['stowed-anchor', 'vertical-ladder', 'watertight-door'].forEach((name, i) => source.construction.equipment.push({
    id: `review-${name}`, partId: `generic-${name}`, position: [-7 + i * 3, 1.05, 14.75], bearingDeg: 0,
  }));
  source.construction.equipment.push(
    { id: 'review-railing', partId: 'generic-railing', position: [10, 1, -15], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, 26], [-6, 0, 26]] } },
    { id: 'review-chain', partId: 'generic-chain', position: [-10, 1.07, -5], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, 8]], slackM: 0 } },
    { id: 'review-second-bitts', partId: 'generic-twin-bitts', position: [-8, 1, -16], bearingDeg: 180 },
    { id: 'review-rope', partId: 'generic-rope', position: [-7.54, 1.46, -10.155], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, -5.69]], slackM: .2 } },
  );
  return source;
}

/** Independently supported original cruiser variants; preserves the smaller
 * legacy fixture's deliberate neighbor and obstruction arrangements. */
export function cruiserEquipmentFixture(catalog: ConstructionCatalog): ConstructionSource {
  const source = createStarterSource(catalog, 'blank');
  source.construction.version = 1;
  source.id = 'cruiser-equipment-review'; source.revision = 'cruiser-equipment-review-1';
  source.construction.defaultThicknessMm = 16;
  source.construction.primitives = [{ id: 'platform', kind: 'box', position: [0, 0, 0], size: [400, 20, 400], rotationDeg: 0 }];
  source.construction.equipment = [];
  const core = new Set([...equipmentReviewSource(catalog).construction.equipment, ...deckFittingsFixture(catalog).construction.equipment].map(e => e.partId));
  const parts = catalog.equipment.filter(p => !core.has(p.id));
  // Separate rows keep national variants supported without overlapping installations.
  const length = 400, firstStation = -160;
  const add = (id: string, partId: string, position: Vec3, links: Partial<ConstructionEquipment> = {}) => source.construction.equipment.push({ id, partId, position, bearingDeg: 0, ...links });
  const engine = parts.find(p => p.kind === 'engine')!;
  add('cruiser-engine', engine.id, [0, -9.984, 130]);
  parts.filter(p => p.kind === 'engine' && p.id !== engine.id).forEach((part, index) => {
    add('review-' + part.id, part.id, [0, -9.984, 80 - index * 40]);
  });
  let gun = 0, deck = 0, screw = 0, rudder = 0, bank = 0;
  for (const part of parts) {
    if (part.kind === 'engine' || part.kind === 'magazine') continue;
    const id = 'review-' + part.id, seat = part.sockets!.find(s => s.id === 'attachment')!;
    if (part.kind === 'gun') {
      const x = -160 + Math.floor(gun / 10) * 40, z = firstStation + gun++ % 10 * 32, magazineId = id + '-mag';
      add(magazineId, 'cruiser-magazine-50000', [x, -9.984, z]);
      add(id, part.id, [x, 10 - seat.position[1], z], { magazineId, gun: { initialElevationDeg: part.id === 'flak38-m43u-20-twin' ? 30 : 0 } });
    } else if (part.kind === 'torpedo-launcher') {
      const z = firstStation + bank++ * 40, magazineId = id + '-mag';
      add(magazineId, 'cruiser-magazine-50000', [0, -9.984, z]);
      add(id, part.id, [0, 10 - seat.position[1], z], { magazineId });
    } else if (part.kind === 'propeller') {
      add(id, part.id, [-12 + screw++ * 24, -9, length / 2 - seat.position[2]], { powerSourceId: 'cruiser-engine' });
    } else if (part.kind === 'rudder') {
      add(id, part.id, [-12 + rudder++ * 24, -10 - seat.position[1], length / 2 - 5]);
    } else if (seat.direction[2] === 1) {
      add(id, part.id, [20, 0, -length / 2 - seat.position[2]]);
    } else {
      const x = 40 + Math.floor(deck / 8) * 40, z = firstStation + deck++ % 8 * 40;
      add(id, part.id, [x, 10 - seat.position[1], z], part.kind === 'funnel' ? { powerSourceId: 'cruiser-engine' } : {});
    }
  }
  return source;
}

import type { ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionFittingDefinition, ConstructionSource, Vec3 } from '../../src/ships/blueprint';
import { createStarterSource } from '../../src/ships/constructionStarter';

/** Synthetic designs that fill the detail budget, for limit and scaling checks.
 * The generator is committed; the sources it builds are large, so they are built in the
 * test (or written to ignored `.build/`) and never stored in the repository. */
export interface DetailFixtureOptions {
  /** Catalog equipment rows: guns, deck fittings, linked wall fittings and connected paths. */
  equipment?: number;
  /** Design-local fitting instances (`partId: "design:…"`), counted apart from `equipment`. */
  customInstances?: number;
  id?: string;
}

/** Deck grid of the generated hull, in ship metres. */
const HULL: Vec3 = [22, 14, 248], HOUSE: Vec3 = [12, 6, 60];
const DECK = HULL[1] / 2, ROOF = DECK + HOUSE[1], HALF_X = HULL[0] / 2 - 1.2, HALF_Z = HULL[2] / 2 - 5;

/** Lanes that avoid the deckhouse footprint, so every seat is the open main deck. */
function* deckSeats(pitch: number, offset = 0): Generator<[number, number]> {
  for (let z = -HALF_Z + offset; z <= HALF_Z; z += pitch)
    for (let x = -HALF_X + offset; x <= HALF_X; x += pitch) {
      if (Math.abs(x) <= HOUSE[0] / 2 + 1 && Math.abs(z) <= HOUSE[2] / 2 + 1) continue;
      yield [Number(x.toFixed(3)), Number(z.toFixed(3))];
    }
}

/** Deckhouse roof first, then main-deck lanes offset from the catalog fittings. */
function* customSeats(): Generator<Vec3> {
  for (let z = -HOUSE[2] / 2 + .8; z <= HOUSE[2] / 2 - .8; z += 1.2)
    for (let x = -HOUSE[0] / 2 + .8; x <= HOUSE[0] / 2 - .8; x += 1.2)
      yield [Number(x.toFixed(3)), ROOF, Number(z.toFixed(3))];
  for (const [x, z] of deckSeats(2, 1)) yield [x, DECK, z];
}

/** Two definitions with solids and tubes, as `docs/construction-authoring.md` describes them. */
export function detailFittingDefinitions(): ConstructionFittingDefinition[] {
  return [
    {
      id: 'fit-bollard', name: 'Twin bollard', version: 1, attach: 'deck', material: 'steel', fill: .35,
      solids: [
        { id: 'base', kind: 'box', size: [1.3, .12, .5], position: [0, .06, 0], rotationDeg: 0 },
        { id: 'post-port', kind: 'cylinder', size: [.32, .62, .32], position: [-.38, .43, 0], rotationDeg: 0 },
        { id: 'post-stbd', kind: 'cylinder', size: [.32, .62, .32], position: [.38, .43, 0], rotationDeg: 0 },
      ],
      tubes: [{ id: 'cross-bar', points: [[-.38, .55, 0], [.38, .55, 0]], diameterM: .07 }],
    },
    {
      id: 'fit-davit', name: 'Radial davit', version: 1, attach: 'deck', massKg: 420,
      solids: [{ id: 'socket', kind: 'cylinder', size: [.45, .3, .45], position: [0, .15, 0], rotationDeg: 0 }],
      tubes: [
        { id: 'arm', diameterM: .16, points: [[0, 0, 0], [0, 2.2, 0], [0, 2.65, -.121], [0, 3.1, -.9]] },
        { id: 'stay', points: [[0, 1.2, 0], [0, 2.95, -.55]], diameterM: .05 },
      ],
    },
  ];
}

/** A hull carrying `equipment` catalog rows and `customInstances` design-local instances.
 * The mix follows a detailed superstructure: about 12% small guns, 12% linked wall fittings,
 * a handful of connected paths and the rest deck fittings. */
export function detailBudgetFixture(catalog: ConstructionCatalog, options: DetailFixtureOptions = {}): ConstructionSource {
  const wanted = options.equipment ?? 1000, customWanted = options.customInstances ?? 0;
  const source = createStarterSource(catalog, 'blank');
  source.id = options.id ?? `detail-budget-${wanted}`;
  source.name = `Detail budget ${wanted}`;
  source.revision = `${source.id}-1`;
  const c = source.construction;
  c.defaultThicknessMm = 16;
  c.primitives = [
    { id: 'hull', kind: 'box', size: HULL, position: [0, 0, 0], rotationDeg: 0 },
    { id: 'house', kind: 'box', size: HOUSE, position: [0, DECK + HOUSE[1] / 2, 0], rotationDeg: 0 },
  ];
  c.equipment = [];
  const part = (id: string): ConstructionEquipmentPart => {
    const found = catalog.equipment.find(p => p.id === id);
    if (!found) throw new Error(`Detail fixture needs catalog part ${id}`);
    return found;
  };
  const socketY = (id: string) => part(id).sockets?.find(s => s.id === 'attachment')?.position[1] ?? 0;
  const push = (item: ConstructionEquipment) => { c.equipment.push(item); return item; };

  const guns = Math.min(Math.round(wanted * .12), 160);
  const walls = Math.round(wanted * .12) - (Math.round(wanted * .12) % 2);
  const railings = Math.min(Math.max(Math.round(wanted * .015), wanted >= 64 ? 2 : 0), 16);
  // A rope needs two bitts to hang between, so each route costs three rows.
  const ropes = Math.min(Math.floor(wanted * .01), 8);
  const deck = Math.max(wanted - guns - walls - railings - ropes * 3, 0);

  // Small AA on a 5 m lattice: weapons are the fittings that test clearance against each other.
  const gunParts = ['flak38-20-single', 'type93-13-single', 'type96-25-kongo-single', 'us-20mm-oerlikon-mk4-hsienyang'];
  const gunSeats = deckSeats(5, 1.5);
  for (let i = 0; i < guns; i++) {
    const seat = gunSeats.next();
    if (seat.done) throw new Error('Detail fixture ran out of gun lanes');
    const partId = gunParts[i % gunParts.length];
    push({ id: `aa-${i}`, partId, position: [seat.value[0], DECK - socketY(partId), seat.value[1]], bearingDeg: (i % 4) * 90 });
  }
  // Linked mirrored pairs on the deckhouse sides, the editor's wall-fitting relationship.
  // Row 0 carries the full-height doors; the upper rows carry small openings.
  const wallRows: [centreY: number, parts: string[]][] = [
    [DECK + 1.15, ['generic-utility-door', 'generic-windowed-door']],
    [DECK + 3, ['generic-porthole', 'generic-rectangular-window']],
    [DECK + 4.3, ['generic-rounded-window', 'generic-louvered-vent']],
    [DECK + 5.4, ['generic-porthole', 'generic-round-wall-vent']],
  ];
  const columns = Math.floor(HOUSE[2] / 2.5);
  for (let i = 0; i < walls / 2; i++) {
    const row = wallRows[Math.floor(i / columns)];
    if (!row) throw new Error('Detail fixture ran out of deckhouse wall rows');
    const partId = row[1][i % row[1].length], p = part(partId);
    const z = -HOUSE[2] / 2 + 1.25 + (i % columns) * 2.5;
    const y = row[0] - p.boundsCenter[1];
    if (y + p.boundsCenter[1] + p.size[1] / 2 > ROOF - .15 || y + p.boundsCenter[1] - p.size[1] / 2 < DECK + .1)
      throw new Error(`Detail fixture put ${partId} through the edge of the deckhouse side`);
    const wall = { version: 1 as const, widthM: p.size[0], heightM: p.size[1] };
    push({ id: `wall-${i}-starboard`, partId, position: [HOUSE[0] / 2, y, z], bearingDeg: 90, wall: { ...wall, mirrorId: `wall-${i}-port` } });
    push({ id: `wall-${i}-port`, partId, position: [-HOUSE[0] / 2, y, z], bearingDeg: 270, wall: { ...wall, mirrorId: `wall-${i}-starboard` } });
  }
  // Connected routes: railings along the deck edge.
  for (let i = 0; i < railings; i++) {
    const partId = i % 2 ? 'generic-railing-two-rail' : 'generic-railing';
    const side = i % 2 ? 1 : -1, start = -HALF_Z + (Math.floor(i / 2) % 8) * 26;
    push({
      id: `rail-${i}`, partId, position: [side * HALF_X, DECK - socketY(partId), start], bearingDeg: 0,
      path: { points: [[0, 0, 0], [0, 0, 8], [side * -.6, 0, 16], [side * -.6, 0, 22]] },
    });
  }
  // Ropes hang between the rigging sockets of their own bitts, not on the deck.
  const rig = part('generic-twin-bitts').sockets!.find(s => s.id === 'rigging-starboard')!.position;
  for (let i = 0; i < ropes; i++) {
    const side = i % 2 ? 1 : -1, span = 5, z = -HALF_Z + 4 + Math.floor(i / 2) * 30, x = side * (HALF_X - .5);
    push({ id: `rope-bitts-${i}-a`, partId: 'generic-twin-bitts', position: [x, DECK, z], bearingDeg: 0 });
    push({ id: `rope-bitts-${i}-b`, partId: 'generic-twin-bitts', position: [x, DECK, z + span], bearingDeg: 180 });
    push({
      id: `rope-${i}`, partId: 'generic-rope', position: [x + rig[0], DECK + rig[1], z + rig[2]], bearingDeg: 0,
      path: { points: [[0, 0, 0], [0, 0, span - rig[2] * 2]], slackM: .05 },
    });
  }
  // Deck fittings fill the rest on a 2 m lattice offset from the gun lattice.
  const deckParts = ['generic-twin-bitts', 'generic-single-bollard', 'generic-t-head-bollard', 'generic-fairlead',
    'generic-mushroom-vent', 'generic-cowl-vent', 'generic-deck-hatch', 'generic-capstan'];
  const deckLanes = deckSeats(2);
  for (let i = 0; i < deck; i++) {
    const seat = deckLanes.next();
    if (seat.done) throw new Error('Detail fixture ran out of deck lanes');
    const partId = deckParts[i % deckParts.length];
    push({ id: `fitting-${i}`, partId, position: [seat.value[0], DECK - socketY(partId), seat.value[1]], bearingDeg: (i % 8) * 45 });
  }
  // Design-local instances fill the deckhouse roof first, then their own main-deck lanes.
  if (customWanted > 0) {
    c.fittings = detailFittingDefinitions();
    const seats = customSeats();
    for (let i = 0; i < customWanted; i++) {
      const seat = seats.next();
      if (seat.done) throw new Error('Detail fixture ran out of design-local lanes');
      const definition = c.fittings[i % c.fittings.length];
      push({ id: `local-${i}`, partId: `design:${definition.id}`, position: seat.value, bearingDeg: (i % 4) * 90 });
    }
  }
  return source;
}

import type {
  ConstructionAccessSettings,
  ConstructionBalcony,
  ConstructionBalconyPoint,
  ConstructionBilgeKeels,
  ConstructionBoundary,
  ConstructionCustomHull,
  ConstructionEquipment,
  ConstructionFittingDefinition,
  ConstructionFittingSolid,
  ConstructionFittingTube,
  ConstructionFreeformFace,
  ConstructionFreeformMesh,
  ConstructionFreeformShape,
  ConstructionHullPaintBand,
  ConstructionHullPaintBands,
  ConstructionHullPoint,
  ConstructionHullStation,
  ConstructionLoad,
  ConstructionPrimitive,
  ConstructionSolid,
  ConstructionSolidFace,
  ConstructionSolidPart,
  ConstructionSurfaceAssignment,
} from './blueprint';
import type { ConstructionBatch, ConstructionCommand } from './constructionCommands';

/** The one declaration of every command and source-record shape. The runtime validator, the patch
 * tables (`constructionPatches.ts`) and the published JSON Schema derive from these values; this
 * module has no runtime imports. Shapes only: ranges the native compiler owns are not repeated here. */
export type Spec =
  | { type: 'string'; enum?: readonly string[]; minLength?: number; maxLength?: number; doc?: string }
  | { type: 'number'; integer?: true; enum?: readonly number[]; minimum?: number; maximum?: number; doc?: string }
  | { type: 'boolean'; doc?: string }
  | { type: 'array'; items: Spec; minItems?: number; maxItems?: number; doc?: string }
  | { type: 'tuple'; name?: string; items: readonly Spec[]; doc?: string }
  | ObjectSpec;
export interface ObjectSpec {
  type: 'object';
  /** Named objects become `$defs` entries in the JSON Schema. */
  name?: string;
  fields: Record<string, Field>;
  doc?: string;
}
/** `nullable` exists only in patches: null removes that optional field. */
export type Field = Spec & { optional?: true; nullable?: true };
type Shape<T> = Record<keyof Required<T>, Field>;

const text = (doc?: string): Spec => ({ type: 'string', ...(doc ? { doc } : {}) });
const id = (doc = 'Stable source ID.'): Spec => ({ type: 'string', minLength: 1, doc });
const number = (doc?: string): Spec => ({ type: 'number', ...(doc ? { doc } : {}) });
const bool = (doc?: string): Spec => ({ type: 'boolean', ...(doc ? { doc } : {}) });
const choice = (values: readonly string[], doc?: string): Spec => ({ type: 'string', enum: values, ...(doc ? { doc } : {}) });
const list = (items: Spec, doc?: string): Spec => ({ type: 'array', items, ...(doc ? { doc } : {}) });
const vec3 = (doc = '[x, y, z] in metres.'): Spec => ({ type: 'tuple', name: 'Vec3', items: [number(), number(), number()], doc });
const angles = (doc: string): Spec => ({ type: 'tuple', name: 'AnglePair', items: [number(), number()], doc });
const optional = (spec: Spec): Field => ({ ...spec, optional: true });
const object = <T>(name: string | undefined, fields: Shape<T>, doc?: string): ObjectSpec => ({
  type: 'object',
  ...(name ? { name } : {}),
  fields,
  ...(doc ? { doc } : {}),
});

export const FACES = ['port', 'starboard', 'bottom', 'top', 'bow', 'stern', 'slope'] as const;
export const FINISHES = ['matte', 'satin', 'semi-gloss', 'gloss'] as const;
export const PRIMITIVE_KINDS = [
  'box', 'wedge', 'corner', 'inverse-corner', 'vertex', 'custom-hull', 'balcony', 'ballast', 'pyramid', 'cylinder',
  'half-cylinder', 'quarter-cylinder', 'quarter-cylinder-wall', 'prism', 'half-hemisphere', 'quarter-hemisphere', 'sphere',
  'hemisphere', 'sphere-octant', 'hemisphere-shell', 'half-hemisphere-shell', 'quarter-hemisphere-shell', 'parabolic-shell',
  'cone', 'hollow-cube', 'concave-corner', 'bridge', 'diagonal-bridge', 'rounded-bridge', 'bridge-panel',
  'diagonal-bridge-panel', 'rounded-bridge-panel', 'breakwater',
] as const;
const face = choice(FACES, 'Canonical source face.');
const material = choice(['steel', 'armor-steel']);

const hullPoint = object<ConstructionHullPoint>(undefined, {
  x: number('Fraction of half the beam; port negative.'),
  y: number('Fraction of depth.'),
  contour: optional(number('Position along the 0–8 outline (keel 4). Omitted on legacy nine-point sections.')),
});
const hullPoints = list(hullPoint, 'Ordered outline, port deck to keel to starboard deck: the same odd count (5–33) in every section.');
const station = object<ConstructionHullStation>('HullStation', { id: id('Stable section ID.'), t: number('0 bow to 1 stern.'), points: hullPoints });
const paintBand = object<ConstructionHullPaintBand>(undefined, { id: id(), upperY: number('Upper edge, hull-local metres.'), paint: text() });
const customHull = object<ConstructionCustomHull>('CustomHull', {
  version: { type: 'number', enum: [1] },
  stations: list(station, '4–24 sections.'),
  rake: number('Bow rake, 0–1.5.'),
  bulb: number('Bow bulb, 0–1.'),
  redPaintY: optional(number('Legacy red lower-hull coating below this hull-local Y.')),
  paintBands: optional(
    object<ConstructionHullPaintBands>(undefined, { version: { type: 'number', enum: [1] }, bands: list(paintBand, 'Bottom to top.') }),
  ),
  bilgeKeels: optional(
    object<ConstructionBilgeKeels>(undefined, {
      version: { type: 'number', enum: [1] },
      enabled: bool(),
      start: number('Fraction of hull length from the bow.'),
      end: number('Fraction of hull length from the bow.'),
      widthM: number(),
      thicknessM: number(),
      placement: number('Fraction of the outline from keel (0) to deck edge (1).'),
    }),
  ),
});
const index = (): Spec => ({ type: 'number', integer: true, minimum: 0 });
const meshFace = object<ConstructionFreeformFace>(undefined, { id: id(), name: face, corners: list(index()) });
const mesh = object<ConstructionFreeformMesh>('FreeformMesh', {
  version: { type: 'number', enum: [1] },
  label: text(),
  family: choice(['prism', 'rings', 'polyhedron']),
  vertices: list(vec3('Normalized local corner.')),
  reference: list(vec3('Undeformed position; retains mirror partners.')),
  faces: list(meshFace),
  rings: list(list(index())),
});
const solidFace = object<ConstructionSolidFace>(undefined, {
  corners: list(index(), 'Indices into the solid vertex pool, counter-clockwise seen from outside the part.'),
  group: optional(text('Surface group for armor and paint; omitted faces stay on their canonical side.')),
});
const solidPart = object<ConstructionSolidPart>(undefined, { id: id(), faces: list(solidFace, '4–128 polygons of one closed convex part.') });
const solid = object<ConstructionSolid>('CompoundSolid', {
  version: { type: 'number', enum: [1] },
  label: text(),
  vertices: list(vec3('Normalized local corner shared by every part.')),
  parts: list(solidPart, '1–256 interior-disjoint convex parts, unioned in order.'),
});
const balconyPoint = object<ConstructionBalconyPoint>(undefined, {
  id: id(),
  x: number(),
  z: number(),
  edge: choice(['open', 'railing', 'triple-railing', 'wall'], 'Treatment of the edge from this point to the next.'),
});
export const PRIMITIVE = object<ConstructionPrimitive>(
  'Primitive',
  {
    id: id(),
    kind: choice(PRIMITIVE_KINDS),
    size: vec3('Envelope [x, y, z] in metres, centered at position. A custom hull is [beam, depth, length].'),
    position: vec3('Envelope center in ship metres.'),
    rotationDeg: number('Yaw in degrees about +Y, counter-clockwise seen from above (opposite to equipment bearings).'),
    tilt: optional(
      object<NonNullable<ConstructionPrimitive['tilt']>>(undefined, { version: { type: 'number', enum: [1] }, pitchDeg: number(), rollDeg: number() }),
    ),
    vertices: optional(list(vec3('Normalized local corner.'), 'Eight corners of a `vertex` block: bow (-X,-Y) (+X,-Y) (+X,+Y) (-X,+Y), then stern.')),
    mesh: optional(mesh),
    solid: optional(solid),
    shaping: optional(
      object<ConstructionFreeformShape>(undefined, {
        version: { type: 'number', enum: [1] },
        edges: list({ type: 'number', integer: true, minimum: 0, maximum: 11 }),
        radius: number(),
        style: choice(['round', 'chamfer']),
      }),
    ),
    smoothGroup: optional(text()),
    customHull: optional(customHull),
    balcony: optional(
      object<ConstructionBalcony>(undefined, { version: { type: 'number', enum: [1] }, points: list(balconyPoint, '3–32 points.'), heightM: number(), wallThicknessM: number() }),
    ),
  },
  'Hull piece.',
);
export const EQUIPMENT = object<ConstructionEquipment>(
  'Equipment',
  {
    id: id(),
    partId: id('Exact retained catalog variant (`ship:catalog`).'),
    position: vec3('The retained part datum in ship metres; not necessarily its bounding-box center.'),
    bearingDeg: number('Clockwise degrees seen from above; 0 faces the bow.'),
    paint: optional(text('Named coating for this installation and its barbette.')),
    magazineId: optional(id()),
    powerSourceId: optional(id('Explicit engine for a propeller; omission uses native assignment.')),
    scale: optional(vec3('Custom fitting instances only: per-axis scale about the datum, 0.05–20; mass follows the volume.')),
    gun: optional(
      object<NonNullable<ConstructionEquipment['gun']>>(undefined, {
        barbetteHeightM: optional(number('Turret rise. Use the `turret-rise` command: it moves position Y with the rise.')),
        battery: optional(choice(['main', 'secondary'])),
        initialElevationDeg: optional(number()),
        traverseDeg: optional(number()),
        traverseLimitsDeg: optional(angles('[from, to] degrees.')),
        elevationMinDeg: optional(number()),
        elevationMaxDeg: optional(number()),
      }),
    ),
    launcher: optional(
      object<NonNullable<ConstructionEquipment['launcher']>>(undefined, {
        traverseLimitsDeg: angles('Absolute ship-relative [from, to] degrees.'),
        launchArcsDeg: list(angles('[from, to] degrees.'), '1–8 arcs.'),
      }),
    ),
    wall: optional(
      object<NonNullable<ConstructionEquipment['wall']>>(undefined, {
        version: { type: 'number', enum: [1] },
        widthM: number(),
        heightM: number(),
        mirrorId: optional(id('Linked partner reflected across ship X=0.')),
        turnDeg: optional({ type: 'number', enum: [90, 180, 270] }),
      }),
    ),
    path: optional(
      object<NonNullable<ConstructionEquipment['path']>>(undefined, {
        points: list(vec3('Equipment-local metres.'), '2–64 connected points.'),
        slackM: optional(number('Rope or chain midspan sag.')),
        heightM: optional(number('Railing height override.')),
        railCount: optional({ type: 'number', enum: [2, 3] }),
        access: optional(
          object<ConstructionAccessSettings>(undefined, {
            widthM: number(),
            standOffM: number(),
            handrails: choice(['both', 'left', 'right', 'none']),
            grabHeightM: number(),
          }),
        ),
      }),
    ),
  },
  'Fitted catalog part.',
);
export const FITTING_SOLID_KINDS = PRIMITIVE_KINDS.filter((kind) => kind !== 'custom-hull' && kind !== 'balcony' && kind !== 'ballast');
const fittingSolid = object<ConstructionFittingSolid>(
  'FittingSolid',
  {
    id: id('Unique among the solids and tubes of this fitting.'),
    kind: choice(FITTING_SOLID_KINDS, 'Hull-piece shape; hull-only kinds are excluded.'),
    size: vec3('Envelope [x, y, z] in metres, centered at position; at least 0.01 m.'),
    position: vec3('Envelope center in fitting-local metres; the datum (local origin, y = 0) seats on the deck.'),
    rotationDeg: PRIMITIVE.fields.rotationDeg,
    tilt: PRIMITIVE.fields.tilt,
    vertices: PRIMITIVE.fields.vertices,
    mesh: PRIMITIVE.fields.mesh,
    shaping: PRIMITIVE.fields.shaping,
    paint: optional(text('Named coating; omission follows the instance paint, then the ship paint.')),
  },
  'One shape of a custom fitting: a hull-piece shape without armor, surfaces or structure.',
);
const fittingTube = object<ConstructionFittingTube>(
  'FittingTube',
  {
    id: id('Unique among the solids and tubes of this fitting.'),
    points: list(vec3('Fitting-local metres.'), '2–256 connected points; segments of at least 1 cm, 100 m in total.'),
    diameterM: number('0.01–2 m.'),
    paint: optional(text()),
  },
  'Round tube swept along a polyline: pipes, davit arms, stays, light masts.',
);
export const FITTING = object<ConstructionFittingDefinition>(
  'Fitting',
  {
    id: id('Definition ID; instances are equipment with `partId: "design:<id>"`.'),
    name: { type: 'string', minLength: 1, maxLength: 80 },
    version: { type: 'number', enum: [1] },
    attach: choice(['deck'], 'Seats on a deck at the local origin. `wall` and `internal` are reserved.'),
    solids: list(fittingSolid, 'At most 256.'),
    tubes: list(fittingTube, 'At most 128.'),
    material: optional(choice(['steel', 'aluminium', 'brass', 'wood'], 'Density basis; omission is steel.')),
    fill: optional(number('Solid fraction of the shape volume, 0.01–1; omission is 1.')),
    massKg: optional(number('Explicit mass; overrides volume × density × fill.')),
  },
  'Design-local fitting definition: non-structural shapes that add mass only. Shells, armor, modules and flooding ignore it.',
);
export const BOUNDARY = object<ConstructionBoundary>(
  'Boundary',
  { id: id(), axis: choice(['x', 'y', 'z']), offset: number('Ship metres along the axis.'), thicknessMm: number() },
  'Internal deck or bulkhead.',
);
export const LOAD = object<ConstructionLoad>('Load', { id: id(), name: text(), center: vec3(), size: vec3(), massKg: number() }, 'Named box load.');
export const SURFACE = object<ConstructionSurfaceAssignment>(
  'SurfaceAssignment',
  {
    primitiveId: id(),
    face,
    panelId: optional(id('Custom-hull panel (`ship:inspect --panels`); omission assigns the whole side.')),
    thicknessMm: number(),
    material,
    paint: text(),
    open: optional(bool()),
  },
  'Armor, material, paint or opening of one source face.',
);
const surfaceTarget: Spec = {
  type: 'object',
  name: 'SurfaceTarget',
  fields: { primitiveId: SURFACE.fields.primitiveId, face, panelId: SURFACE.fields.panelId },
};

/** Every field optional; objects merge recursively; arrays, tuples and scalars replace; null removes an optional field. */
export function patchSpec(record: ObjectSpec, name?: string, omit: readonly string[] = []): ObjectSpec {
  const fields: Record<string, Field> = {};
  for (const [key, field] of Object.entries(record.fields)) {
    if (omit.includes(key)) continue;
    const { optional: wasOptional, nullable: _, ...spec } = field;
    fields[key] = { ...(spec.type === 'object' ? patchSpec(spec) : spec), optional: true, ...(wasOptional ? { nullable: true as const } : {}) };
  }
  return { type: 'object', ...(name ? { name } : {}), fields, ...(record.doc ? { doc: record.doc } : {}) };
}
/** Fields a patch never changes, with the reason. Everything else in the record is patchable. */
export const UNPATCHABLE = {
  primitive: { id: 'IDs are stable; copy then remove to rename.' },
  equipment: { id: 'IDs are stable; copy then remove to rename.' },
  fitting: { id: 'Instances reference the ID; define a new fitting and re-point the instances to rename.' },
} as const;
export const PRIMITIVE_PATCH = patchSpec(PRIMITIVE, 'PrimitivePatch', Object.keys(UNPATCHABLE.primitive));
export const EQUIPMENT_PATCH = patchSpec(EQUIPMENT, 'EquipmentPatch', Object.keys(UNPATCHABLE.equipment));
export const FITTING_PATCH = patchSpec(FITTING, 'FittingPatch', Object.keys(UNPATCHABLE.fitting));

type Op = ConstructionCommand['op'];
type CommandFields<K extends Op> = Record<Exclude<keyof Required<Extract<ConstructionCommand, { op: K }>>, 'op'>, Field>;
const ids = list(id(), 'IDs of hull pieces, equipment, boundaries or loads.');
const removable = list(id(), 'IDs of hull pieces, equipment, boundaries, loads or custom fitting definitions.');
const mirror = optional(bool('Also target the opposite face or panel of the same primitive.'));
export const COMMANDS = {
  name: { doc: 'Rename the design.', fields: { name: text() } },
  'construction-version': { doc: 'Set the construction format together with its equipment migration.', fields: { version: { type: 'number', enum: [1, 2] } } },
  skin: { doc: 'Set the default structural skin.', fields: { thicknessMm: number() } },
  finish: { doc: 'Set the ship-wide sheen; omission restores original finishes.', fields: { finish: optional(choice(FINISHES)) } },
  'ship-paint': { doc: 'Set the ship paint; omission restores naval gray.', fields: { paint: optional({ type: 'string', minLength: 1, maxLength: 64 }) } },
  primitive: { doc: 'Add or replace a whole hull piece by ID.', fields: { value: PRIMITIVE } },
  'primitive-patch': { doc: 'Merge fields into an existing hull piece.', fields: { id: id(), changes: PRIMITIVE_PATCH } },
  'hull-sections': {
    doc: 'Resize a custom hull to this many sections by interpolation or simplification.',
    fields: { id: id(), count: { type: 'number', integer: true, minimum: 4, maximum: 24 } },
  },
  'hull-station': {
    doc: 'Edit one existing custom-hull section.',
    fields: { id: id(), stationId: id(), changes: { type: 'object', fields: { t: optional(station.fields.t), points: optional(hullPoints) } } },
  },
  equipment: { doc: 'Add or replace a whole fitting by ID. A linked wall partner follows.', fields: { value: EQUIPMENT } },
  'equipment-patch': { doc: 'Merge fields into an existing fitting. A linked wall partner follows.', fields: { id: id(), changes: EQUIPMENT_PATCH } },
  fitting: {
    doc: 'Add or replace a whole custom fitting definition by ID. Fit it with `equipment` rows whose partId is `design:<id>`; every instance follows a change.',
    fields: { value: FITTING },
  },
  'fitting-patch': { doc: 'Merge fields into an existing custom fitting definition; `solids` and `tubes` replace whole.', fields: { id: id(), changes: FITTING_PATCH } },
  'turret-rise': {
    doc: 'Set a gun’s rise above its deck attachment; position Y moves by the change so the attachment stays put, as in the editor.',
    fields: { id: id(), heightM: { type: 'number', minimum: 0, maximum: 30 } },
  },
  copy: {
    doc: 'Copy hull pieces, equipment and loads to new IDs. Default offset is 1 m to starboard; choose mirror or offset, not both.',
    fields: {
      copies: { type: 'array', minItems: 1, items: { type: 'object', fields: { from: id(), to: id('New unique ID.') } } },
      mirror: optional(bool('Reflect across ship X=0.')),
      offset: optional(vec3()),
    },
  },
  boundary: { doc: 'Add or replace a boundary by ID.', fields: { value: BOUNDARY } },
  load: { doc: 'Add or replace a load by ID.', fields: { value: LOAD } },
  remove: {
    doc: 'Remove records. The last hull piece is kept; a linked wall partner goes too. A custom fitting definition is refused while instances outside this command still use it.',
    fields: { ids: removable },
  },
  move: { doc: 'Translate pieces, equipment, loads and boundary offsets.', fields: { ids, delta: vec3('[x, y, z] metres: +X starboard, +Y up, −Z bow.') } },
  rotate: { doc: 'Yaw hull pieces and equipment about their own datums.', fields: { ids, degrees: number('Added to each `rotationDeg` and `bearingDeg`, then normalized to 0–360; wall fittings are skipped.') } },
  surface: { doc: 'Assign a whole face record.', fields: { value: SURFACE } },
  'surface-patch': {
    doc: 'Change some values of faces; unassigned faces start from what they inherit.',
    fields: {
      targets: list(surfaceTarget),
      changes: {
        type: 'object',
        fields: {
          thicknessMm: optional(SURFACE.fields.thicknessMm),
          material: optional(material),
          paint: optional(SURFACE.fields.paint),
          open: optional(bool()),
        },
      },
      mirror,
    },
  },
  'surface-remove': { doc: 'Remove face assignments so the faces inherit again (panel from side, side from ship).', fields: { targets: list(surfaceTarget), mirror } },
  catalog: { doc: 'Adopt another retained parts-catalog revision.', fields: { revision: id() } },
  vertices: {
    doc: 'Move a vertex, edge, face or ring of a freeform block, as the editor does.',
    fields: {
      id: id(),
      selection: { type: 'object', fields: { mode: choice(['vertex', 'edge', 'face', 'ring']), index: index() } },
      delta: vec3('Ship-space metres.'),
      mirror: optional({ type: 'tuple', items: [bool(), bool(), bool()], doc: 'Mirror across the local X, Y and Z planes.' }),
      nearby: optional(bool()),
    },
  },
} satisfies { [K in Op]: { doc: string; fields: CommandFields<K> } };
export const COMMAND_OPS = Object.keys(COMMANDS) as Op[];
export const MAX_BATCH_COMMANDS = 10_000;
const BATCH: Record<Exclude<keyof Required<ConstructionBatch>, 'commands'> | 'expectedFileHash', Field> = {
  version: { type: 'number', enum: [1] },
  expectedRevision: text('`revision` from inspect.'),
  expectedFileHash: optional(text('`fileRevision` from inspect. Required and checked by `ship:apply`; the browser ignores it.')),
  label: text('History label.'),
};

/** Machine-readable command failure. `commandIndex` is the zero-based index into `commands`; `path` is relative to that command. */
export class ConstructionCommandError extends Error {
  override name = 'ConstructionCommandError';
  constructor(
    readonly detail: string,
    readonly commandIndex?: number,
    readonly op?: string,
    readonly path?: string,
    readonly value?: unknown,
  ) {
    super((commandIndex === undefined ? 'Batch' : `Command ${commandIndex} (${op ?? 'unknown'})`) + ': ' + detail);
  }
  toJSON() {
    return { error: this.message, commandIndex: this.commandIndex, op: this.op, path: this.path, value: this.value };
  }
}

const shown = (value: unknown) => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return String(value);
  const json = JSON.stringify(value) ?? String(value);
  return json.length > 80 ? json.slice(0, 77) + '...' : json;
};
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
/** Up to three near matches, nearest first; empty when nothing is plausibly a typo. */
export function closestMatches(wanted: string, known: Iterable<string>): string[] {
  const bare = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = bare(wanted),
    scored: [number, string][] = [];
  if (!target) return [];
  for (const candidate of known) {
    const other = bare(candidate);
    if (Math.abs(other.length - target.length) > 8 && !other.includes(target) && !target.includes(other)) continue;
    // Abbreviations such as gun-fwd for gun-forward are subsequences rather than near edits.
    const within = (short: string, long: string) => short.length >= 3 && [...long].reduce((n, c) => (c === short[n] ? n + 1 : n), 0) === short.length;
    const score = Math.min(distance(target, other), within(target, other) || within(other, target) ? 2 : Infinity);
    if (score <= Math.max(2, Math.floor(target.length / 3))) scored.push([score, candidate]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).slice(0, 3).map((entry) => entry[1]);
}
export const suggestion = (wanted: unknown, known: Iterable<string>) => {
  const matches = typeof wanted === 'string' ? closestMatches(wanted, known) : [];
  return matches.length ? '; closest: ' + matches.map((match) => JSON.stringify(match)).join(', ') : '';
};

type Fail = (detail: string, path: string, value: unknown) => never;
const join = (path: string, key: string) => (path ? path + '.' + key : key);
function check(value: unknown, spec: Spec, path: string, fail: Fail): void {
  const expected = (what: string) => fail(`${path} must be ${what}, got ${shown(value)}`, path, value);
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') expected('a string');
      else if (spec.enum && !spec.enum.includes(value)) fail(`${path} must be one of ${spec.enum.map(shown).join(', ')}, got ${shown(value)}${suggestion(value, spec.enum)}`, path, value);
      else if (value.length < (spec.minLength ?? 0) || value.length > (spec.maxLength ?? Infinity))
        expected(spec.maxLength ? `a string of ${spec.minLength ?? 0} to ${spec.maxLength} characters` : 'a non-empty string');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) expected(spec.integer ? 'a finite integer' : 'a finite number');
      else if (spec.enum && !spec.enum.includes(value)) expected(spec.enum.length === 1 ? String(spec.enum[0]) : 'one of ' + spec.enum.join(', '));
      else if ((spec.integer && !Number.isInteger(value)) || value < (spec.minimum ?? -Infinity) || value > (spec.maximum ?? Infinity))
        expected(
          (spec.integer ? 'an integer' : 'a number') +
            (spec.minimum !== undefined && spec.maximum !== undefined
              ? ` from ${spec.minimum} to ${spec.maximum}`
              : spec.minimum !== undefined
                ? ` of at least ${spec.minimum}`
                : spec.maximum !== undefined
                  ? ` of at most ${spec.maximum}`
                  : ''),
        );
      return;
    case 'boolean':
      if (typeof value !== 'boolean') expected('true or false');
      return;
    case 'array':
      if (!Array.isArray(value)) return expected('an array');
      if (value.length < (spec.minItems ?? 0)) expected(`an array of at least ${spec.minItems} item${spec.minItems === 1 ? '' : 's'}`);
      if (value.length > (spec.maxItems ?? Infinity)) fail(`${path} accepts at most ${spec.maxItems} items, got ${value.length}`, path, value.length);
      for (let i = 0; i < value.length; i++) check(value[i], spec.items, `${path}[${i}]`, fail);
      return;
    case 'tuple':
      if (!Array.isArray(value) || value.length !== spec.items.length) return expected(`an array of ${spec.items.length} values`);
      for (let i = 0; i < value.length; i++) check(value[i], spec.items[i], `${path}[${i}]`, fail);
      return;
    case 'object':
      return checkFields(value, spec.fields, path, fail);
  }
}
function checkFields(value: unknown, fields: Record<string, Field>, path: string, fail: Fail, ignored: readonly string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path || 'it'} must be an object, got ${shown(value)}`, path, value);
  const record = value as Record<string, unknown>;
  // An undefined property is an omitted one: editor code builds commands such as {op:'finish', finish: undefined}.
  for (const key of Object.keys(record))
    if (!Object.hasOwn(fields, key) && !ignored.includes(key) && record[key] !== undefined)
      fail(`unknown field ${join(path, key)}${suggestion(key, [...Object.keys(fields), ...ignored])}. Accepted: ${Object.keys(fields).join(', ') || 'none'}`, join(path, key), record[key]);
  for (const [key, field] of Object.entries(fields)) {
    const item = record[key];
    if (item === undefined) {
      if (!field.optional) fail(`${join(path, key)} is required`, join(path, key), undefined);
    } else if (item === null && field.nullable) continue;
    else check(item, field, join(path, key), fail);
  }
}

/** Shape check of the batch envelope; throws `ConstructionCommandError` without a command index. */
export function validateBatchShape(batch: unknown): void {
  const fail: Fail = (detail, path, value) => {
    throw new ConstructionCommandError(detail, undefined, undefined, path, value);
  };
  checkFields(batch, BATCH, '', fail, ['commands']);
  const commands = (batch as { commands?: unknown }).commands;
  if (!Array.isArray(commands)) fail(`commands must be an array, got ${shown(commands)}`, 'commands', commands);
  else if (commands.length > MAX_BATCH_COMMANDS) fail(`commands accepts at most ${MAX_BATCH_COMMANDS} commands, got ${commands.length}`, 'commands', commands.length);
}
/** Shape check of one command: known op, no unknown or missing fields, right types, finite numbers. */
export function validateCommandShape(command: unknown, commandIndex: number): void {
  const op = (command as { op?: unknown } | null)?.op;
  const fail: Fail = (detail, path, value) => {
    throw new ConstructionCommandError(detail, commandIndex, typeof op === 'string' ? op : undefined, path, value);
  };
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail(`it must be an object, got ${shown(command)}`, '', command);
  if (typeof op !== 'string' || !Object.hasOwn(COMMANDS, op))
    fail(`unknown op ${shown(op)}${suggestion(op, COMMAND_OPS)}. Known ops: ${COMMAND_OPS.join(', ')}`, 'op', op);
  checkFields(command, COMMANDS[op as Op].fields, '', fail, ['op']);
}

type Json = Record<string, unknown>;
/** JSON Schema (draft 2020-12) for a `ConstructionBatch`, derived from the specs above. */
export function constructionBatchJsonSchema(): Json {
  const defs: Record<string, Json> = {};
  const fieldsSchema = (fields: Record<string, Field>, extra: Record<string, Json> = {}): Json => ({
    type: 'object',
    properties: { ...extra, ...Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, fieldSchema(field)])) },
    required: [...Object.keys(extra), ...Object.keys(fields).filter((key) => !fields[key].optional)],
    additionalProperties: false,
  });
  const fieldSchema = (field: Field): Json => (field.nullable ? { anyOf: [schema(field), { type: 'null' }] } : schema(field));
  const described = (spec: Spec, body: Json): Json => (spec.doc ? { description: spec.doc, ...body } : body);
  const schema = (spec: Spec): Json => {
    switch (spec.type) {
      case 'string':
        return described(spec, { type: 'string', ...(spec.enum ? { enum: [...spec.enum] } : {}), ...(spec.minLength ? { minLength: spec.minLength } : {}), ...(spec.maxLength ? { maxLength: spec.maxLength } : {}) });
      case 'number':
        return described(spec, {
          type: spec.integer ? 'integer' : 'number',
          ...(spec.enum ? { enum: [...spec.enum] } : {}),
          ...(spec.minimum !== undefined ? { minimum: spec.minimum } : {}),
          ...(spec.maximum !== undefined ? { maximum: spec.maximum } : {}),
        });
      case 'boolean':
        return described(spec, { type: 'boolean' });
      case 'array':
        return described(spec, {
          type: 'array',
          items: schema(spec.items),
          ...(spec.minItems ? { minItems: spec.minItems } : {}),
          ...(spec.maxItems ? { maxItems: spec.maxItems } : {}),
        });
      case 'tuple': {
        const body = { type: 'array', prefixItems: spec.items.map(schema), items: false, minItems: spec.items.length };
        if (!spec.name) return described(spec, body);
        defs[spec.name] ??= body;
        return described(spec, { $ref: '#/$defs/' + spec.name });
      }
      case 'object':
        if (!spec.name) return described(spec, fieldsSchema(spec.fields));
        defs[spec.name] ??= described(spec, fieldsSchema(spec.fields));
        return { $ref: '#/$defs/' + spec.name };
    }
  };
  const commands = COMMAND_OPS.map((op) => ({ title: op, description: COMMANDS[op].doc, ...fieldsSchema(COMMANDS[op].fields, { op: { const: op } }) }));
  const batch = fieldsSchema(BATCH);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ConstructionBatch',
    description: 'One atomic transaction of construction commands. Commands apply in order; any failure leaves the source unchanged.',
    ...batch,
    properties: {
      ...(batch.properties as Json),
      commands: { type: 'array', maxItems: MAX_BATCH_COMMANDS, items: { oneOf: commands } },
    },
    required: [...(batch.required as string[]), 'commands'],
    $defs: defs,
  };
}

/** Conventions every command value follows; verified against docs/shipbuilding.md. */
export const CONSTRUCTION_CONVENTIONS = {
  units: 'Metres, kilograms, millimetres for plate thickness (`…Mm`), degrees for angles.',
  axes: '+X starboard, +Y up, −Z bow (`coordinates: "meters-y-up-bow-negative-z"`). Compilation never recenters a design.',
  bearings: 'Equipment `bearingDeg` is clockwise degrees seen from above: 0 faces the bow, 90 starboard. A hull piece `rotationDeg` is yaw about +Y, counter-clockwise seen from above.',
  ids: 'IDs are stable and unique across hull pieces, equipment, boundaries, loads and custom fitting definitions. Commands never rename; keep existing IDs.',
  equipmentPosition: 'Equipment `position` is the retained catalog part datum, not necessarily its bounding-box center; `ship:catalog` lists size, bounds center and sockets.',
  primitivePosition: 'A hull piece `position` is the center of its `size` envelope. A custom hull `size` is [beam, depth, length].',
  patches: 'In `primitive-patch` and `equipment-patch`, objects merge, arrays replace and null removes an optional field.',
  validity: 'Commands are checked for shape only. Geometry, fit, loading and launch validity belong to the native compiler (`ship:apply --dry-run`, `ship:compile`).',
  errors: 'A malformed command fails the whole batch: `Command <zero-based index> (<op>): <path> …, got <value>`.',
} as const;

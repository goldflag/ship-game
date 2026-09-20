import { editableMesh } from './constructionMesh';
import { customHullPanels, mirroredPanelId } from './constructionPanels';
import { editableCustomHull, customHullPrimitive, setSectionCount } from './customHullModel';
import { patchPrimitive, patchEquipment, type PrimitivePatch, type EquipmentPatch } from './constructionPatches';
import { copyConstructionSelection, mirroredFace } from './constructionEditor';
import { setBarbetteHeight } from './constructionArmament';
import { ConstructionCommandError, suggestion, validateBatchShape, validateCommandShape } from './constructionCommandSchema';
import type {
  ConstructionBoundary,
  ConstructionEquipment,
  ConstructionHullStation,
  ConstructionLoad,
  ConstructionPrimitive,
  ConstructionSource,
  ConstructionSurfaceAssignment,
  Vec3,
} from './blueprint';
import {
  assignConstructionSurfaces,
  decodeConstructionSource,
  moveConstructionSelection,
  newConstructionId,
  removeConstructionSelection,
  rotateConstructionSelection,
  surfaceKey,
  mirroredEquipment,
} from './constructionEditor';
import {
  canEditVertices,
  selectionCorners,
  freeformEdit,
  replaceVertexPrimitives,
  type HullSelection,
  type MirrorAxes,
} from './constructionVertex';

export { ConstructionCommandError } from './constructionCommandSchema';
type SurfaceTarget = Pick<ConstructionSurfaceAssignment, 'primitiveId' | 'face' | 'panelId'>;
/** Commands edit the existing source contract; they never accept derived physics. Every member has a
 * spec of the same fields in `constructionCommandSchema.ts`; tsc and the schema test fail on drift. */
export type ConstructionCommand =
  | { op: 'name'; name: string }
  | { op: 'construction-version'; version: ConstructionSource['construction']['version'] }
  | { op: 'skin'; thicknessMm: number }
  | { op: 'finish'; finish?: ConstructionSource['construction']['finish'] }
  | { op: 'ship-paint'; paint?: string }
  | { op: 'primitive'; value: ConstructionPrimitive }
  | { op: 'primitive-patch'; id: string; changes: PrimitivePatch }
  | { op: 'hull-sections'; id: string; count: number }
  | { op: 'hull-station'; id: string; stationId: string; changes: Partial<Pick<ConstructionHullStation, 't' | 'points'>> }
  | { op: 'equipment'; value: ConstructionEquipment }
  | { op: 'equipment-patch'; id: string; changes: EquipmentPatch }
  | { op: 'turret-rise'; id: string; heightM: number }
  | { op: 'copy'; copies: { from: string; to: string }[]; mirror?: boolean; offset?: Vec3 }
  | { op: 'boundary'; value: ConstructionBoundary }
  | { op: 'load'; value: ConstructionLoad }
  | { op: 'remove'; ids: string[] }
  | { op: 'move'; ids: string[]; delta: Vec3 }
  | { op: 'rotate'; ids: string[]; degrees: number }
  | { op: 'surface'; value: ConstructionSurfaceAssignment }
  | {
      op: 'surface-patch';
      targets: SurfaceTarget[];
      changes: Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>;
      mirror?: boolean;
    }
  | { op: 'surface-remove'; targets: SurfaceTarget[]; mirror?: boolean }
  | { op: 'catalog'; revision: string }
  | { op: 'vertices'; id: string; selection: HullSelection; delta: Vec3; mirror?: MirrorAxes; nearby?: boolean };
export interface ConstructionBatch {
  version: 1;
  expectedRevision: string;
  label: string;
  commands: ConstructionCommand[];
}

function upsert<T extends { id: string }>(rows: T[], value: T) {
  const i = rows.findIndex((row) => row.id === value.id);
  if (i < 0) rows.push(structuredClone(value));
  else rows[i] = structuredClone(value);
}

type Fail = (detail: string, path?: string, value?: unknown) => never;
/** One shape-checked command against the draft. `fail` reports a command the draft cannot honour. */
function applyCommand(draft: ConstructionSource, command: ConstructionCommand, fail: Fail): void {
  const data = draft.construction;
  const allIds = () => [...data.primitives, ...data.equipment, ...data.boundaries, ...data.loads].map((p) => p.id);
  const unknown = (what: string, id: string, path: string, known: Iterable<string>) =>
    fail(`unknown ${what} ${JSON.stringify(id)}${suggestion(id, known)}`, path, id);
  const requireIds = (ids: string[], path: (i: number) => string) => {
    const known = new Set(allIds());
    ids.forEach((id, i) => known.has(id) || unknown('source ID', id, path(i), known));
    return new Set(ids);
  };
  const primitive = (id: string, path: string) =>
    data.primitives.find((p) => p.id === id) ??
    (allIds().includes(id)
      ? fail(`${JSON.stringify(id)} is not a hull piece`, path, id)
      : unknown('hull piece ID', id, path, data.primitives.map((p) => p.id)));
  const fitting = (id: string, path: string) =>
    data.equipment.find((p) => p.id === id) ??
    (allIds().includes(id) ? fail(`${JSON.stringify(id)} is not equipment`, path, id) : unknown('equipment ID', id, path, data.equipment.map((p) => p.id)));
  const customHull = (id: string) => {
    const part = primitive(id, 'id');
    return part.kind === 'custom-hull' && part.customHull ? part : fail(`${JSON.stringify(id)} is a ${part.kind}, not a custom hull`, 'id', id);
  };
  const equipment = (value: ConstructionEquipment) => {
    upsert(data.equipment, value);
    const twin = data.equipment.find((p) => p.id === value.wall?.mirrorId);
    if (twin && twin.wall?.mirrorId === value.id) {
      const mirrored = mirroredEquipment(value);
      upsert(data.equipment, { ...mirrored, id: twin.id, wall: { ...mirrored.wall!, mirrorId: value.id } });
    }
  };
  /** Selection keys of the targets; `assigned` additionally requires each named target to hold an assignment. */
  const surfaceKeys = (targets: SurfaceTarget[], mirror: boolean | undefined, assigned: boolean) => {
    const keys = new Set<string>(),
      stored = assigned ? new Set(data.surfaces.map((s) => surfaceKey(s.primitiveId, s.face, s.panelId))) : undefined;
    targets.forEach((target, i) => {
      const part = primitive(target.primitiveId, `targets[${i}].primitiveId`);
      const held = stored?.has(surfaceKey(part.id, target.face, target.panelId));
      // A stored override may outlive its panel after a section change, so removal needs the assignment, not the panel.
      if (assigned && !held) fail(`${surfaceKey(part.id, target.face, target.panelId)} has no assignment to remove`, `targets[${i}]`, target);
      if (!assigned && target.panelId !== undefined) requirePanel(part, target.face, target.panelId, `targets[${i}].panelId`);
      keys.add(surfaceKey(part.id, target.face, target.panelId));
      if (mirror) keys.add(surfaceKey(part.id, mirroredFace(target.face, part.kind), mirroredPanelId(target.panelId)));
    });
    return keys;
  };
  const requirePanel = (part: ConstructionPrimitive, face: string, panelId: string, path: string) => {
    const panels = customHullPanels(part).filter((panel) => panel.face === face);
    if (!panels.some((panel) => panel.panelId === panelId))
      fail(`unknown ${face} panel ${JSON.stringify(panelId)} on ${JSON.stringify(part.id)}${suggestion(panelId, panels.map((panel) => panel.panelId!))}`, path, panelId);
  };
  switch (command.op) {
    case 'name':
      draft.name = command.name;
      break;
    case 'construction-version':
      data.version = command.version;
      break;
    case 'finish':
      if (command.finish === undefined) delete data.finish;
      else data.finish = command.finish;
      break;
    case 'ship-paint':
      if (command.paint === undefined) delete data.paint;
      else data.paint = command.paint;
      break;
    case 'skin':
      data.defaultThicknessMm = command.thicknessMm;
      break;
    case 'catalog':
      data.catalogRevision = command.revision;
      break;
    case 'primitive':
      upsert(data.primitives, command.value);
      break;
    case 'primitive-patch':
      upsert(data.primitives, patchPrimitive(primitive(command.id, 'id'), command.changes));
      break;
    case 'hull-sections': {
      const part = customHull(command.id);
      const hull = editableCustomHull(part);
      setSectionCount(hull, command.count);
      upsert(data.primitives, { ...part, ...customHullPrimitive(hull, part) });
      break;
    }
    case 'hull-station': {
      const stations = customHull(command.id).customHull!.stations;
      const station = stations.find((s) => s.id === command.stationId);
      if (!station) return unknown('section ID', command.stationId, 'stationId', stations.map((s) => s.id));
      Object.assign(station, structuredClone(command.changes));
      break;
    }
    case 'equipment':
      equipment(command.value);
      break;
    case 'equipment-patch':
      equipment(patchEquipment(fitting(command.id, 'id'), command.changes));
      break;
    case 'turret-rise': {
      // Same helper as the editor's Turret rise: position Y follows the rise so the deck attachment stays put.
      const part = structuredClone(fitting(command.id, 'id'));
      setBarbetteHeight(part, command.heightM);
      equipment(part);
      break;
    }
    case 'copy': {
      const ids = requireIds(command.copies.map((p) => p.from), (i) => `copies[${i}].from`);
      const destinations = new Map(command.copies.map((p) => [p.from, p.to]));
      const known = new Set(allIds());
      command.copies.forEach((pair, i) => {
        if (known.has(pair.to)) fail(`destination ID ${JSON.stringify(pair.to)} already exists; copy destination IDs must be new and unique`, `copies[${i}].to`, pair.to);
      });
      if (ids.size !== command.copies.length || new Set(destinations.values()).size !== ids.size)
        fail('copy destination IDs must be new and unique; source IDs must not repeat', 'copies');
      const wall = data.boundaries.find((p) => ids.has(p.id));
      if (wall) fail(`${JSON.stringify(wall.id)} is a boundary; copy accepts hull pieces, equipment and loads`, 'copies', wall.id);
      if (command.mirror && command.offset) fail('choose mirror or offset, then move the copies separately', 'offset', command.offset);
      copyConstructionSelection(draft, ids, { ids: destinations, mirror: command.mirror, offset: command.offset });
      break;
    }
    case 'boundary':
      upsert(data.boundaries, command.value);
      break;
    case 'load':
      upsert(data.loads, command.value);
      break;
    case 'remove':
      removeConstructionSelection(draft, requireIds(command.ids, (i) => `ids[${i}]`));
      break;
    case 'move': {
      const ids = requireIds(command.ids, (i) => `ids[${i}]`);
      moveConstructionSelection(draft, ids, command.delta);
      for (const wall of data.boundaries) if (ids.has(wall.id)) wall.offset += command.delta[{ x: 0, y: 1, z: 2 }[wall.axis]];
      break;
    }
    case 'rotate': {
      const ids = requireIds(command.ids, (i) => `ids[${i}]`);
      command.ids.forEach((id, i) => {
        if (data.boundaries.some((w) => w.id === id) || data.loads.some((l) => l.id === id))
          fail(`${JSON.stringify(id)} is a boundary or load; rotate accepts hull pieces and equipment only`, `ids[${i}]`, id);
      });
      rotateConstructionSelection(draft, ids, command.degrees);
      break;
    }
    case 'surface': {
      const { primitiveId, face, panelId, ...values } = command.value;
      const part = primitive(primitiveId, 'value.primitiveId');
      if (panelId !== undefined) requirePanel(part, face, panelId, 'value.panelId');
      assignConstructionSurfaces(draft, new Set([surfaceKey(primitiveId, face, panelId)]), values);
      break;
    }
    case 'surface-patch':
      assignConstructionSurfaces(draft, surfaceKeys(command.targets, command.mirror, false), command.changes);
      break;
    case 'surface-remove': {
      const keys = surfaceKeys(command.targets, command.mirror, true);
      data.surfaces = data.surfaces.filter((s) => !keys.has(surfaceKey(s.primitiveId, s.face, s.panelId)));
      break;
    }
    case 'vertices': {
      const part = primitive(command.id, 'id');
      if (!canEditVertices(part)) fail(`${JSON.stringify(command.id)} is a ${part.kind}, not an editable freeform shape`, 'id', command.id);
      if (!selectionCorners(command.selection, editableMesh(part)).length)
        fail(`unknown ${command.selection.mode} ${command.selection.index} on ${JSON.stringify(command.id)}`, 'selection.index', command.selection.index);
      replaceVertexPrimitives(
        draft,
        freeformEdit(draft, command.id, command.selection, command.delta, command.mirror ?? [false, false, false], command.nearby ?? false),
      );
      break;
    }
    default:
      command satisfies never;
  }
}

function settled(draft: ConstructionSource): ConstructionSource {
  const decoded = decodeConstructionSource(draft),
    data = decoded.construction;
  const ids = [...data.primitives, ...data.equipment, ...data.boundaries, ...data.loads].map((p) => p.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated !== undefined)
    throw new Error(`Source IDs must be unique across pieces, equipment, boundaries and loads; ${JSON.stringify(repeated)} repeats.`);
  return decoded;
}
const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
function run(draft: ConstructionSource, command: ConstructionCommand, index: number): void {
  try {
    applyCommand(draft, command, (detail, path, value) => {
      throw new ConstructionCommandError(detail, index, command.op, path, value);
    });
  } catch (cause) {
    if (cause instanceof ConstructionCommandError) throw cause;
    throw new ConstructionCommandError(reason(cause), index, command.op);
  }
}
/** The source syntax check runs once per batch; on failure, replay finds the first command whose result it rejects. */
function blame(source: ConstructionSource, commands: ConstructionCommand[], cause: unknown): ConstructionCommandError {
  const invalid = (index?: number) =>
    new ConstructionCommandError('result is not a valid source: ' + reason(cause), index, index === undefined ? undefined : commands[index].op);
  const draft = structuredClone(source);
  if (commands.length > 500) return invalid();
  try {
    settled(draft);
  } catch {
    return invalid();
  }
  for (let i = 0; i < commands.length; i++) {
    run(draft, commands[i], i);
    try {
      settled(draft);
    } catch {
      return invalid(i);
    }
  }
  return invalid();
}

/** Atomic, shared browser/CLI transaction. Every command is shape-checked against
 * `constructionCommandSchema.ts` before the first one applies; failures never partially apply
 * and throw `ConstructionCommandError` naming the command. Physically invalid results are allowed. */
export function applyConstructionBatch(
  source: ConstructionSource,
  batch: ConstructionBatch,
  revision = newConstructionId('revision'),
): ConstructionSource {
  validateBatchShape(batch);
  if (batch.expectedRevision !== source.revision)
    throw new Error('Design revision changed. Read the current source before applying this batch.');
  batch.commands.forEach(validateCommandShape);
  const draft = structuredClone(source);
  batch.commands.forEach((command, index) => run(draft, command, index));
  let decoded: ConstructionSource;
  try {
    decoded = settled(draft);
  } catch (cause) {
    throw blame(source, batch.commands, cause);
  }
  if (JSON.stringify(decoded) === JSON.stringify(source)) return structuredClone(source);
  decoded.revision = revision;
  return decoded;
}

/** The batch that turns `before` into `after`: every editor operation expressed on a scratch copy
 * becomes commands for the one edit door. Rows are matched by stable ID; a face assignment that
 * disappears while its primitive stays becomes a `surface-remove`. Upserts precede the
 * removal so the protected last hull block is never the one being replaced. */
export function constructionDiffCommands(before: ConstructionSource, after: ConstructionSource): ConstructionCommand[] {
  const commands: ConstructionCommand[] = [],
    removed: string[] = [];
  const a = after.construction,
    b = before.construction;
  if (a.version !== b.version) commands.push({ op: 'construction-version', version: a.version });
  if (after.name !== before.name) commands.push({ op: 'name', name: after.name });
  if (a.finish !== b.finish) commands.push({ op: 'finish', finish: a.finish });
  if (a.paint !== b.paint) commands.push({ op: 'ship-paint', paint: a.paint });
  if (a.defaultThicknessMm !== b.defaultThicknessMm) commands.push({ op: 'skin', thicknessMm: a.defaultThicknessMm });
  if (a.catalogRevision !== b.catalogRevision) commands.push({ op: 'catalog', revision: a.catalogRevision });
  const table = <T extends { id: string }>(rows: (value: T) => ConstructionCommand, was: T[], is: T[]) => {
    const kept = new Set(is.map((row) => row.id)),
      previous = new Map(was.map((row) => [row.id, JSON.stringify(row)]));
    for (const row of was) if (!kept.has(row.id)) removed.push(row.id);
    for (const row of is) if (previous.get(row.id) !== JSON.stringify(row)) commands.push(rows(structuredClone(row)));
  };
  table((value) => ({ op: 'primitive', value }), b.primitives, a.primitives);
  table((value) => ({ op: 'equipment', value }), b.equipment, a.equipment);
  table((value) => ({ op: 'boundary', value }), b.boundaries, a.boundaries);
  table((value) => ({ op: 'load', value }), b.loads, a.loads);
  if (removed.length) commands.push({ op: 'remove', ids: removed });
  const key = (surface: ConstructionSurfaceAssignment) => surfaceKey(surface.primitiveId, surface.face, surface.panelId);
  const previous = new Map(b.surfaces.map((surface) => [key(surface), JSON.stringify(surface)])),
    kept = new Set(a.surfaces.map(key));
  const cleared = b.surfaces.filter((surface) => !kept.has(key(surface)) && a.primitives.some((part) => part.id === surface.primitiveId));
  if (cleared.length)
    commands.push({
      op: 'surface-remove',
      targets: cleared.map(({ primitiveId, face, panelId }) => ({ primitiveId, face, ...(panelId === undefined ? {} : { panelId }) })),
    });
  for (const surface of a.surfaces)
    if (previous.get(key(surface)) !== JSON.stringify(surface)) commands.push({ op: 'surface', value: structuredClone(surface) });
  return commands;
}

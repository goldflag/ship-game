import { customHullPanels } from './constructionPanels';
import type { ConstructionBoundary, ConstructionEquipment, ConstructionLoad, ConstructionPrimitive, ConstructionSource, ConstructionSurfaceAssignment, Vec3 } from './blueprint';
import { CONSTRUCTION_FACES, assignConstructionSurfaces, decodeConstructionSource, moveConstructionSelection, newConstructionId, removeConstructionSelection, rotateConstructionSelection, surfaceKey } from './constructionEditor';
import { freeformEdit, replaceVertexPrimitives, type HullSelection, type MirrorAxes } from './constructionVertex';

/** Commands edit the existing source contract; they never accept derived physics. */
export type ConstructionCommand =
  | { op: 'name'; name: string }
  | { op: 'construction-version'; version: ConstructionSource['construction']['version'] }
  | { op: 'skin'; thicknessMm: number }
  | { op: 'primitive'; value: ConstructionPrimitive }
  | { op: 'equipment'; value: ConstructionEquipment }
  | { op: 'boundary'; value: ConstructionBoundary }
  | { op: 'load'; value: ConstructionLoad }
  | { op: 'remove'; ids: string[] }
  | { op: 'move'; ids: string[]; delta: Vec3 }
  | { op: 'rotate'; ids: string[]; degrees: number }
  | { op: 'surface'; value: ConstructionSurfaceAssignment }
  | { op: 'catalog'; revision: string }
  | { op: 'vertices'; id: string; selection: HullSelection; delta: Vec3; mirror?: MirrorAxes; nearby?: boolean };
export interface ConstructionBatch {
  version: 1;
  expectedRevision: string;
  label: string;
  commands: ConstructionCommand[];
}

function upsert<T extends { id: string }>(rows: T[], value: T) {
  const i = rows.findIndex(row => row.id === value.id);
  if (i < 0) rows.push(structuredClone(value)); else rows[i] = structuredClone(value);
}

/** Atomic, shared browser/CLI transaction. Syntax failures never partially apply. */
export function applyConstructionBatch(source: ConstructionSource, batch: ConstructionBatch, revision = newConstructionId('revision')): ConstructionSource {
  if (batch.version !== 1 || !Array.isArray(batch.commands) || batch.commands.length > 10_000 || typeof batch.label !== 'string') throw new Error('Expected a version-1 command batch with at most 10,000 commands.');
  if (batch.expectedRevision !== source.revision) throw new Error('Design revision changed. Read the current source before applying this batch.');
  const draft = structuredClone(source), data = draft.construction;
  const requireIds = (ids: string[]) => {
    const known = new Set([...data.primitives, ...data.equipment, ...data.boundaries, ...data.loads].map(p => p.id));
    if (!Array.isArray(ids) || ids.some(id => !known.has(id))) throw new Error('Command references an unknown source ID.');
    return new Set(ids);
  };
  for (const command of batch.commands) {
    switch (command.op) {
      case 'name': draft.name = command.name; break;
      case 'construction-version': data.version = command.version; break;
      case 'skin': data.defaultThicknessMm = command.thicknessMm; break;
      case 'catalog': data.catalogRevision = command.revision; break;
      case 'primitive': upsert(data.primitives, command.value); break;
      case 'equipment': upsert(data.equipment, command.value); break;
      case 'boundary': upsert(data.boundaries, command.value); break;
      case 'load': upsert(data.loads, command.value); break;
      case 'remove': removeConstructionSelection(draft, requireIds(command.ids)); break;
      case 'move': {
        const ids = requireIds(command.ids);
        moveConstructionSelection(draft, ids, command.delta);
        for (const wall of data.boundaries) if (ids.has(wall.id)) wall.offset += command.delta[{ x: 0, y: 1, z: 2 }[wall.axis]];
        break;
      }
      case 'rotate': {
        const ids = requireIds(command.ids);
        if (data.boundaries.some(w => ids.has(w.id)) || data.loads.some(l => ids.has(l.id))) throw new Error('Rotate accepts hull pieces and equipment only.');
        rotateConstructionSelection(draft, ids, command.degrees); break;
      }
      case 'surface': {
        const { primitiveId, face, panelId, ...values } = command.value;
        if (!CONSTRUCTION_FACES.includes(face)) throw new Error('Unknown source face.');
        requireIds([primitiveId]);
        if (!data.primitives.some(p => p.id === primitiveId)) throw new Error('Surface assignments require a hull primitive.');
        if (panelId !== undefined && !customHullPanels(data.primitives.find(p => p.id === primitiveId)!).some(panel => panel.face === face && panel.panelId === panelId)) throw new Error('Unknown custom hull panel.');
        assignConstructionSurfaces(draft, new Set([surfaceKey(primitiveId, face, panelId)]), values); break;
      }
      case 'vertices':
        if (!['vertex', 'edge', 'face'].includes(command.selection.mode) || !Number.isInteger(command.selection.index) || command.selection.index < 0 || command.selection.index >= ({ vertex: 8, edge: 12, face: 6 }[command.selection.mode])) throw new Error('Unknown vertex, edge or face.');
        requireIds([command.id]);
        if (!data.primitives.some(p => p.id === command.id && ['box', 'vertex'].includes(p.kind))) throw new Error('Vertex editing requires a box or vertex hull.');
        replaceVertexPrimitives(draft, freeformEdit(draft, command.id, command.selection, command.delta, command.mirror ?? [false, false, false], command.nearby ?? false)); break;
      default: throw new Error('Unknown construction command.');
    }
  }
  const decoded = decodeConstructionSource(draft);
  const ids = [...data.primitives, ...data.equipment, ...data.boundaries, ...data.loads].map(p => p.id);
  if (new Set(ids).size !== ids.length) throw new Error('Source IDs must be unique across pieces, equipment, boundaries and loads.');
  if (JSON.stringify(decoded) === JSON.stringify(source)) return structuredClone(source);
  decoded.revision = revision;
  return decoded;
}

/** The batch that turns `before` into `after`: every editor operation expressed on a scratch copy
 * becomes commands for the one edit door. Rows are matched by stable ID; a face assignment can only
 * disappear with its primitive, because the command set has no removal for one. Upserts precede the
 * removal so the protected last hull block is never the one being replaced. */
export function constructionDiffCommands(before: ConstructionSource, after: ConstructionSource): ConstructionCommand[] {
  const commands: ConstructionCommand[] = [], removed: string[] = [];
  const a = after.construction, b = before.construction;
  if (a.version !== b.version) commands.push({ op: 'construction-version', version: a.version });
  if (after.name !== before.name) commands.push({ op: 'name', name: after.name });
  if (a.defaultThicknessMm !== b.defaultThicknessMm) commands.push({ op: 'skin', thicknessMm: a.defaultThicknessMm });
  if (a.catalogRevision !== b.catalogRevision) commands.push({ op: 'catalog', revision: a.catalogRevision });
  const table = <T extends { id: string }>(rows: (value: T) => ConstructionCommand, was: T[], is: T[]) => {
    const kept = new Set(is.map(row => row.id)), previous = new Map(was.map(row => [row.id, JSON.stringify(row)]));
    for (const row of was) if (!kept.has(row.id)) removed.push(row.id);
    for (const row of is) if (previous.get(row.id) !== JSON.stringify(row)) commands.push(rows(structuredClone(row)));
  };
  table(value => ({ op: 'primitive', value }), b.primitives, a.primitives);
  table(value => ({ op: 'equipment', value }), b.equipment, a.equipment);
  table(value => ({ op: 'boundary', value }), b.boundaries, a.boundaries);
  table(value => ({ op: 'load', value }), b.loads, a.loads);
  if (removed.length) commands.push({ op: 'remove', ids: removed });
  const key = (surface: ConstructionSurfaceAssignment) => surfaceKey(surface.primitiveId, surface.face, surface.panelId);
  const previous = new Map(b.surfaces.map(surface => [key(surface), JSON.stringify(surface)])), kept = new Set(a.surfaces.map(key));
  for (const surface of b.surfaces) if (!kept.has(key(surface)) && a.primitives.some(part => part.id === surface.primitiveId)) throw new Error('A face assignment cannot be removed by command; assign its default values instead.');
  for (const surface of a.surfaces) if (previous.get(key(surface)) !== JSON.stringify(surface)) commands.push({ op: 'surface', value: structuredClone(surface) });
  return commands;
}

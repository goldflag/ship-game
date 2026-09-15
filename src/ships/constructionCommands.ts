import type { ConstructionBoundary, ConstructionEquipment, ConstructionLoad, ConstructionPrimitive, ConstructionSource, ConstructionSurfaceAssignment, Vec3 } from './blueprint';
import { CONSTRUCTION_FACES, assignConstructionSurfaces, decodeConstructionSource, moveConstructionSelection, newConstructionId, removeConstructionSelection, rotateConstructionSelection, surfaceKey } from './constructionEditor';
import { freeformEdit, replaceVertexPrimitives, type HullSelection, type MirrorAxes } from './constructionVertex';

/** Commands edit the existing source contract; they never accept derived physics. */
export type ConstructionCommand =
  | { op: 'name'; name: string }
  | { op: 'skin'; thicknessMm: number }
  | { op: 'primitive'; value: ConstructionPrimitive }
  | { op: 'equipment'; value: ConstructionEquipment }
  | { op: 'boundary'; value: ConstructionBoundary }
  | { op: 'load'; value: ConstructionLoad }
  | { op: 'remove'; ids: string[] }
  | { op: 'move'; ids: string[]; delta: Vec3 }
  | { op: 'rotate'; ids: string[]; degrees: number }
  | { op: 'surface'; value: ConstructionSurfaceAssignment }
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
      case 'skin': data.defaultThicknessMm = command.thicknessMm; break;
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
        const { primitiveId, face, ...values } = command.value;
        if (!CONSTRUCTION_FACES.includes(face)) throw new Error('Unknown source face.');
        requireIds([primitiveId]);
        if (!data.primitives.some(p => p.id === primitiveId)) throw new Error('Surface assignments require a hull primitive.');
        assignConstructionSurfaces(draft, new Set([surfaceKey(primitiveId, face)]), values); break;
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

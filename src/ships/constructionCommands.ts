import { editableMesh } from './constructionMesh';
import { customHullPanels, mirroredPanelId } from './constructionPanels';
import { editableCustomHull, customHullPrimitive, setSectionCount } from './customHullModel';
import { patchPrimitive, patchEquipment, type PrimitivePatch, type EquipmentPatch } from './constructionPatches';
import { copyConstructionSelection, mirroredFace } from './constructionEditor';
import type { ConstructionBoundary, ConstructionEquipment, ConstructionHullStation, ConstructionLoad, ConstructionPrimitive, ConstructionSource, ConstructionSurfaceAssignment, Vec3 } from './blueprint';
import { CONSTRUCTION_FACES, assignConstructionSurfaces, decodeConstructionSource, moveConstructionSelection, newConstructionId, removeConstructionSelection, rotateConstructionSelection, surfaceKey, mirroredEquipment } from './constructionEditor';
import { canEditVertices, selectionCorners, freeformEdit, replaceVertexPrimitives, type HullSelection, type MirrorAxes } from './constructionVertex';

/** Commands edit the existing source contract; they never accept derived physics. */
export type ConstructionCommand =
  | { op: 'name'; name: string }
  | { op: 'construction-version'; version: ConstructionSource['construction']['version'] }
  | { op: 'skin'; thicknessMm: number }
  | { op: 'primitive'; value: ConstructionPrimitive }
  | { op: 'primitive-patch'; id: string; changes: PrimitivePatch }
  | { op: 'hull-sections'; id: string; count: number }
  | { op: 'hull-station'; id: string; stationId: string; changes: Partial<Pick<ConstructionHullStation, 't' | 'points'>> }
  | { op: 'equipment'; value: ConstructionEquipment }
  | { op: 'equipment-patch'; id: string; changes: EquipmentPatch }
  | { op: 'copy'; copies: { from: string; to: string }[]; mirror?: boolean; offset?: Vec3 }
  | { op: 'boundary'; value: ConstructionBoundary }
  | { op: 'load'; value: ConstructionLoad }
  | { op: 'remove'; ids: string[] }
  | { op: 'move'; ids: string[]; delta: Vec3 }
  | { op: 'rotate'; ids: string[]; degrees: number }
  | { op: 'surface'; value: ConstructionSurfaceAssignment }
  | { op: 'surface-patch'; targets: Pick<ConstructionSurfaceAssignment, 'primitiveId' | 'face' | 'panelId'>[]; changes: Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>; mirror?: boolean }
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
  const equipment = (value: ConstructionEquipment) => {
    upsert(data.equipment, value);
    const twin = data.equipment.find(p => p.id === value.wall?.mirrorId);
    if (twin && twin.wall?.mirrorId === value.id) upsert(data.equipment, { ...mirroredEquipment(value), id: twin.id, wall: { ...value.wall!, mirrorId: value.id } });
  };
  for (const command of batch.commands) {
    switch (command.op) {
      case 'name': draft.name = command.name; break;
      case 'construction-version': data.version = command.version; break;
      case 'skin': data.defaultThicknessMm = command.thicknessMm; break;
      case 'catalog': data.catalogRevision = command.revision; break;
      case 'primitive': upsert(data.primitives, command.value); break;
      case 'primitive-patch': {
        const part = data.primitives.find(p => p.id === command.id);
        if (!part) throw new Error('Unknown hull primitive ID.');
        upsert(data.primitives, patchPrimitive(part, command.changes)); break;
      }
      case 'hull-sections': {
        const part = data.primitives.find(p => p.id === command.id && p.kind === 'custom-hull');
        if (!part) throw new Error('Section count requires a custom hull ID.');
        const hull = editableCustomHull(part); setSectionCount(hull, command.count);
        upsert(data.primitives, { ...part, ...customHullPrimitive(hull, part) }); break;
      }
      case 'hull-station': {
        const part = data.primitives.find(p => p.id === command.id && p.kind === 'custom-hull');
        const station = part?.customHull?.stations.find(s => s.id === command.stationId);
        if (!station) throw new Error('Unknown custom hull section ID.');
        if (!command.changes || typeof command.changes !== 'object' || Array.isArray(command.changes) || Object.keys(command.changes).some(key => !['t', 'points'].includes(key))) throw new Error('Section changes accept t and points only.');
        Object.assign(station, structuredClone(command.changes)); break;
      }
      case 'equipment': equipment(command.value); break;
      case 'equipment-patch': {
        const part = data.equipment.find(p => p.id === command.id);
        if (!part) throw new Error('Unknown equipment ID.');
        equipment(patchEquipment(part, command.changes)); break;
      }
      case 'copy': {
        if (!Array.isArray(command.copies) || !command.copies.length) throw new Error('Copy requires source/destination ID pairs.');
        if (command.mirror !== undefined && typeof command.mirror !== 'boolean') throw new Error('Copy mirror must be a boolean.');
        if (command.offset !== undefined && (!Array.isArray(command.offset) || command.offset.length !== 3 || !command.offset.every(Number.isFinite))) throw new Error('Copy offset must contain three finite coordinates.');
        const ids = requireIds(command.copies.map(p => p.from));
        const destinations = new Map(command.copies.map(p => [p.from, p.to]));
        const known = new Set([...data.primitives, ...data.equipment, ...data.boundaries, ...data.loads].map(p => p.id));
        if (ids.size !== command.copies.length || new Set(destinations.values()).size !== ids.size || [...destinations.values()].some(id => typeof id !== 'string' || !id.length || known.has(id))) throw new Error('Copy destination IDs must be new and unique; source IDs must not repeat.');
        if (data.boundaries.some(p => ids.has(p.id))) throw new Error('Copy accepts hull pieces, equipment and loads, not boundaries.');
        if (command.mirror && command.offset) throw new Error('Choose mirror or offset, then move the copies separately.');
        copyConstructionSelection(draft, ids, { ids: destinations, mirror: command.mirror, offset: command.offset });
        break;
      }
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
      case 'surface-patch': {
        if (!Array.isArray(command.targets) || !command.changes || typeof command.changes !== 'object' || Array.isArray(command.changes) || Object.keys(command.changes).some(key => !['thicknessMm', 'material', 'paint', 'open'].includes(key))) throw new Error('Expected surface targets and armor, material, paint or opening changes.');
        if (command.mirror !== undefined && typeof command.mirror !== 'boolean') throw new Error('Surface mirror must be a boolean.');
        const keys = new Set<string>();
        for (const target of command.targets) {
          const part = data.primitives.find(p => p.id === target.primitiveId);
          if (!part || !CONSTRUCTION_FACES.includes(target.face)) throw new Error('Unknown hull primitive or face.');
          if (target.panelId !== undefined && !customHullPanels(part).some(p => p.face === target.face && p.panelId === target.panelId)) throw new Error('Unknown custom hull panel.');
          keys.add(surfaceKey(part.id, target.face, target.panelId));
          if (command.mirror) keys.add(surfaceKey(part.id, mirroredFace(target.face, part.kind), mirroredPanelId(target.panelId)));
        }
        assignConstructionSurfaces(draft, keys, command.changes); break;
      }
      case 'vertices': {
        requireIds([command.id]);
        const primitive=data.primitives.find(p=>p.id===command.id);
        if(!primitive||!canEditVertices(primitive))throw new Error('Select an editable freeform shape.');
        if(!['vertex','edge','face','ring'].includes(command.selection.mode)||!Number.isInteger(command.selection.index)||!selectionCorners(command.selection,editableMesh(primitive)).length)throw new Error('Unknown vertex, edge, face or ring.');
        replaceVertexPrimitives(draft, freeformEdit(draft, command.id, command.selection, command.delta, command.mirror ?? [false, false, false], command.nearby ?? false)); break;
      }
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

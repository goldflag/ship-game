import type { ConstructionEquipment, ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { applyConstructionBatch, type ConstructionCommand } from '../../ships/constructionCommands';
import { mirroredEquipment, mirroredPrimitive } from '../../ships/constructionEditor';
import { mirrorTwin, mirrorTwinEquipment } from './placement';
import { carriedIds, carriedPoses } from '../../ships/constructionParents';

/** Mirror editing: with Mirror on, an edit to a piece also reaches the piece that already mirrors it
 * across the centerline. Twins are found by geometry, as for mirrored armor and paint, so nothing
 * links them in the source: a pair edited with Mirror off stops being twins until it matches again.
 * Linked wall fittings keep their own `mirrorId` partner and are left to the command layer. */

export const mirroredDelta = (delta: Vec3): Vec3 => [-delta[0] || 0, delta[1], delta[2]];

/** Each edited piece or fitting with a separate twin. `taken` pieces already take part in the edit
 * (the edited ones unless told otherwise), so none of them follows as a twin. */
export function mirrorTwins(source: ConstructionSource, ids: ReadonlySet<string>, taken: ReadonlySet<string> = ids): Map<string, string> {
  const twins = new Map<string, string>(), claimed = new Set<string>(taken);
  const { primitives, equipment } = source.construction;
  // A whole-ship selection holds both sides of every pair.
  if (!ids.size || taken.size >= primitives.length + equipment.length && primitives.every(p => taken.has(p.id)) && equipment.every(p => taken.has(p.id))) return twins;
  for (const primitive of source.construction.primitives) {
    if (!ids.has(primitive.id)) continue;
    const twin = mirrorTwin(source, primitive, claimed);
    if (twin && twin.id !== primitive.id) { twins.set(primitive.id, twin.id); claimed.add(twin.id); }
  }
  for (const item of source.construction.equipment) {
    if (!ids.has(item.id) || item.wall) continue;
    const twin = mirrorTwinEquipment(source, item);
    if (twin && !twin.wall && !claimed.has(twin.id)) { twins.set(item.id, twin.id); claimed.add(twin.id); }
  }
  return twins;
}

/** A twin takes the reflected shape and pose of its edited partner and keeps what is its own. */
export function twinPrimitive(edited: ConstructionPrimitive, twin: Pick<ConstructionPrimitive, 'id' | 'smoothGroup'>): ConstructionPrimitive {
  const { smoothGroup: _, ...reflected } = mirroredPrimitive(edited);
  return { ...reflected, id: twin.id, ...(twin.smoothGroup === undefined ? {} : { smoothGroup: twin.smoothGroup }) };
}
function twinEquipment(edited: ConstructionEquipment, twin: ConstructionEquipment): ConstructionEquipment {
  const reflected = mirroredEquipment(edited), out: ConstructionEquipment = { ...structuredClone(twin), position: reflected.position, bearingDeg: reflected.bearingDeg };
  if (reflected.path) out.path = reflected.path;
  if (edited.gun?.barbetteHeightM !== undefined || twin.gun?.barbetteHeightM !== undefined) {
    out.gun = { ...out.gun };
    if (edited.gun?.barbetteHeightM === undefined) delete out.gun.barbetteHeightM; else out.gun.barbetteHeightM = edited.gun.barbetteHeightM;
  }
  return out;
}

/** Freeform replacements with the twins of the blocks they reshape. The shaped block's own twin
 * follows it even when nearby-corner matching already moved some of that twin's corners. */
export function withTwinReplacements(source: ConstructionSource, replacements: ConstructionPrimitive[], primaryId?: string): ConstructionPrimitive[] {
  const primitives = source.construction.primitives, primary = primitives.find(p => p.id === primaryId);
  const primaryTwin = primary && mirrorTwin(source, primary);
  const kept = primaryTwin && primaryTwin.id !== primaryId ? replacements.filter(p => p.id !== primaryTwin.id) : replacements;
  const twins = mirrorTwins(source, new Set(kept.map(p => p.id)));
  return [...kept, ...kept.flatMap(p => { const twin = primitives.find(other => other.id === twins.get(p.id)); return twin ? [twinPrimitive(p, twin)] : []; })];
}

const commandIds = (command: ConstructionCommand): string[] => {
  switch (command.op) {
    case 'primitive': case 'equipment': return [command.value.id];
    case 'primitive-patch': case 'equipment-patch': case 'hull-sections': case 'hull-station': case 'vertices': return [command.id];
    case 'move': case 'rotate': case 'remove': return command.ids;
    default: return [];
  }
};

/** The batch, followed by the same edit reflected onto each edited piece's twin: a moved, turned,
 * resized or reshaped piece gives its twin the mirrored result, and a removed piece takes its twin along. */
export function withMirroredEdits(source: ConstructionSource, commands: ConstructionCommand[]): ConstructionCommand[] {
  const twins = mirrorTwins(source, new Set(commands.flatMap(commandIds)));
  // Moved, turned and removed rows take what they carry (`parent`) along; a twin among those riders already follows the edit.
  const carrying = new Set(commands.flatMap(c => (c.op === 'move' || c.op === 'rotate' || c.op === 'remove' ? c.ids : [])));
  const riders = carriedIds(source.construction, carrying);
  for (const [id, twinId] of twins) if (riders.has(twinId)) twins.delete(id);
  if (!twins.size) return commands;
  let next: ConstructionSource;
  // An invalid batch is left for the revision door to refuse with its own message.
  try { next = applyConstructionBatch(source, { version: 1, expectedRevision: source.revision, label: 'Mirror edit', commands }); } catch { return commands; }
  const before = source.construction, after = next.construction, out = [...commands], removed: string[] = [];
  for (const [id, twinId] of twins) {
    const was = before.primitives.find(p => p.id === id);
    if (was) {
      const is = after.primitives.find(p => p.id === id), twin = before.primitives.find(p => p.id === twinId)!;
      if (!is) removed.push(twinId);
      else if (JSON.stringify(is) !== JSON.stringify(was)) out.push({ op: 'primitive', value: twinPrimitive(is, twin) });
      continue;
    }
    const item = before.equipment.find(p => p.id === id), now = after.equipment.find(p => p.id === id), twin = before.equipment.find(p => p.id === twinId);
    if (!item || !twin) continue;
    if (!now) removed.push(twinId);
    else if (JSON.stringify(now) !== JSON.stringify(item)) out.push({ op: 'equipment', value: twinEquipment(now, twin) });
  }
  // A twin reshaped by an upsert carries nothing by itself: its riders take the same rigid change of pose.
  const upserted = new Set(out.flatMap(c => (c.op === 'primitive' || c.op === 'equipment' ? [c.value.id] : [])));
  for (const [id, twinId] of twins) {
    if (!carrying.has(id)) continue;
    const command = out.find(c => (c.op === 'primitive' || c.op === 'equipment') && c.value.id === twinId);
    if (!command || (command.op !== 'primitive' && command.op !== 'equipment')) continue;
    const was = [...before.primitives, ...before.equipment].find(p => p.id === twinId)!;
    const is = command.value;
    const turn = 'bearingDeg' in is ? is.bearingDeg - (was as ConstructionEquipment).bearingDeg : -(is.rotationDeg - (was as ConstructionPrimitive).rotationDeg);
    for (const value of carriedPoses(before, twinId, was.position, is.position, turn, new Set([...upserted, ...riders]))) {
      out.push({ op: 'equipment', value });
      upserted.add(value.id);
    }
  }
  if (removed.length) out.push({ op: 'remove', ids: removed });
  return out;
}

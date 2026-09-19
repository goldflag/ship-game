/** Edits of what is already on the ship: remove, copy, center, move, reseat and raise. Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { reseatBalcony } from '../balconyPlacement';
import { wallNormal, seatWallFitting } from '../../../ships/constructionWallFittings';
import { constructionSnapFeatures } from '../snapping';
import { integrateConstructionMagazines, setBarbetteHeight } from '../../../ships/constructionArmament';
import type { ConstructionPrimitive, Vec3 } from '../../../ships/blueprint';
import { copyConstructionSelection, mirroredEquipment } from '../../../ships/constructionEditor';
import { applyConstructionBatch, constructionDiffCommands, type ConstructionCommand } from '../../../ships/constructionCommands';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import { offCenterline } from '../placement';
import { mirroredMoveConstraint, blockPlacementAllowed, OVERLAP_NOTICE } from '../blockMovement';
import { mirroredDelta } from '../mirrorEditing';
import { LIMITS, AXIS } from '../builderToolState';
import type { BuilderTool } from '../builderTool';

/** Raising moves the gunhouse while preserving its deck connection and low magazine. */
export function raiseTurrets(this: BuilderTool, ids: string[], height: (current: number) => number): ConstructionSubmission {
  const next = structuredClone(this.source);
  ids = [...ids, ...this.twinsOf(ids).values()];
  if (next.construction.version === 1) integrateConstructionMagazines(next, this.catalog);
  for (const item of next.construction.equipment) {
    if (ids.includes(item.id) && this.partOf(item)?.kind === 'gun') setBarbetteHeight(item, height(item.gun?.barbetteHeightM ?? 0));
  }
  return this.run('Raise turrets', constructionDiffCommands(this.source, next));
}

export function removePieces(this: BuilderTool, ids: ReadonlySet<string>, label = 'Remove selection'): ConstructionSubmission | undefined {
  ids = new Set([...ids].filter(this.selectable));
  if (!ids.size) return undefined;
  const refused = this.refused(); if (refused) return refused;
  ids = new Set([...ids, ...this.twinsOf(ids).values()]);
  const keep = this.data.primitives.every(part => ids.has(part.id)) ? this.data.primitives[0]?.id : undefined;
  const outcome = this.command(label, [{ op: 'remove', ids: [...ids] }]);
  this.update({ selected: new Set([...this.state.selected].filter(id => !ids.has(id) || id === keep)),
    surfaces: new Set([...this.state.surfaces].filter(key => ![...ids].some(id => id !== keep && key.startsWith(`${id}:`)))),
    ...(keep ? { notice: 'Kept the last hull block. Add another block before removing it.' } : {}) });
  return outcome;
}

export function copy(this: BuilderTool, mirrorCopy = false): ConstructionSubmission | undefined {
  const { selected } = this.state;
  if (!selected.size) return undefined;
  if (this.data.primitives.length + this.selectedPrimitives.length > LIMITS.primitives || this.data.equipment.length + this.selectedEquipment.length > LIMITS.equipment) { this.door.setError('This copy would exceed the design limit. Select fewer pieces or remove a section first.'); return undefined; }
  const next = structuredClone(this.source);
  if (this.selectedEquipment.length && this.selectedEquipment.every(e => e.wall) && !this.selectedPrimitives.length) {
    const commands: ConstructionCommand[] = [], copied: string[] = [], handled = new Set<string>();
    for (const original of this.selectedEquipment) {
      if (handled.has(original.id)) continue;
      handled.add(original.id);
      if (original.wall!.mirrorId) handled.add(original.wall!.mirrorId);
      if (mirrorCopy && original.wall!.mirrorId) { this.notify('This fitting already has a linked mirror.'); continue; }
      if (mirrorCopy && !offCenterline(original.position)) { this.notify('A centerline fitting cannot have a separate mirrored partner.'); continue; }
      const a = structuredClone(original), b = mirroredEquipment(original);
      b.id = this.newId('equipment');
      if (mirrorCopy) {
        copied.push(b.id);
        a.wall!.mirrorId = b.id; b.wall!.mirrorId = a.id;
        commands.push({ op: 'equipment', value: a }, { op: 'equipment', value: b });
      } else {
        a.id = this.newId('equipment'); copied.push(a.id);
        const r = a.bearingDeg * Math.PI / 180, spacing = this.partOf(a)!.size[0] + .25;
        a.position[0] += Math.cos(r)*spacing; a.position[2] += Math.sin(r)*spacing;
        if (original.wall!.mirrorId) {
          copied.push(b.id);
          a.wall!.mirrorId = b.id;
          const twin = mirroredEquipment(a);
          Object.assign(b, twin, { id: b.id, wall: { ...twin.wall!, mirrorId: a.id } });
          commands.push({ op: 'equipment', value: a }, { op: 'equipment', value: b });
        } else { delete a.wall!.mirrorId; commands.push({ op: 'equipment', value: a }); }
      }
    }
    if (!commands.length) return undefined;
    if (this.data.equipment.length + copied.length > LIMITS.equipment) { this.door.setError('This copy would exceed the fittings limit. Remove a fitting first.'); return undefined; }
    const outcome = this.run(mirrorCopy ? 'Link mirrored fittings' : 'Copy wall fittings', commands);
    if (outcome.accepted) this.update({ selected: new Set(copied), surfaces: new Set() });
    return outcome;
  }
  const copied = copyConstructionSelection(next, selected, { mirror: mirrorCopy });
  if (!copied.length) return undefined;
  if (!blockPlacementAllowed(this.source, next.construction.primitives.filter(p => copied.includes(p.id)))) { this.update({ notice: OVERLAP_NOTICE }); return undefined; }
  const outcome = this.run(mirrorCopy ? 'Mirror selection' : 'Copy selection', constructionDiffCommands(this.source, next));
  if (!outcome.accepted) return outcome;
  this.update({ selected: new Set(copied), surfaces: new Set(), notice: mirrorCopy ? 'Mirrored a copy across the centerline.' : 'Copied the selection 1 m to starboard.' });
  return outcome;
}

export function centerSelection(this: BuilderTool): ConstructionSubmission | undefined {
  const centers = constructionSnapFeatures(this.source, this.catalog).filter(f => this.state.selected.has(f.owner) && f.kind === 'center');
  if (!centers.length) return undefined;
  const x = (Math.min(...centers.map(f => f.point[0])) + Math.max(...centers.map(f => f.point[0]))) / 2;
  // Centering places the selection itself; a twin would only land on top of it.
  return this.movePieces([...this.state.selected], [-x, 0, 0], false);
}

/** Keep balcony edits and their physical seating in one undo transaction. */
export function editPrimitive(this: BuilderTool, label: string, value: ConstructionPrimitive) {
  const before = this.data.primitives.find(p => p.id === value.id);
  return this.edit(label, [{ op: 'primitive', value: before ? reseatBalcony(this.source, before, value) : value }]);
}

/** A finished move drag or nudge retains the native overlap constraint. Twins outside the selection travel the reflected path. */
export function movePieces(this: BuilderTool, ids: string[], requested: Vec3, mirror = true): ConstructionSubmission | undefined {
  ids = ids.filter(this.selectable);
  if (!ids.length) return undefined;
  const refused = this.refused(); if (refused) return refused;
  const moving = new Set(ids), twins = new Set(mirror ? this.twinsOf(moving, this.state.selected).values() : []);
  let delta = mirroredMoveConstraint(this.source, moving, twins)(requested);
  if (delta.some((value, axis) => Math.abs(value - requested[axis]) > 1e-7)) this.update({ notice: OVERLAP_NOTICE });
  const wall = this.data.equipment.find(e => moving.has(e.id) && e.wall);
  if (wall) { const normal = wallNormal(wall.bearingDeg), d = delta.reduce((sum, v, k) => sum + v * normal[k], 0); delta = delta.map((v, k) => v - d * normal[k]) as Vec3; }
  if (delta.every(value => value === 0)) return undefined;
  const commands: ConstructionCommand[] = [{ op: 'move', ids, delta }];
  if (twins.size) commands.push({ op: 'move', ids: [...twins], delta: mirroredDelta(delta) });
  for (const wall of this.data.boundaries) if (moving.has(wall.id)) commands.push({ op: 'boundary', value: { ...wall, offset: wall.offset + delta[AXIS[wall.axis]] } });
  if (this.data.equipment.some(e=>moving.has(e.id)&&e.wall) && this.compiled) {
    const next=applyConstructionBatch(this.source,{version:1,expectedRevision:this.source.revision,label:'Move fittings',commands});
    for (const item of next.construction.equipment) {
      if (!item.wall || JSON.stringify(item.position)===JSON.stringify(this.data.equipment.find(e=>e.id===item.id)?.position)) continue;
      const part=this.partOf(item); if (part) commands.push({op:'equipment',value:seatWallFitting(item,part,this.compiled.surfaces)});
    }
  }
  const outcome = this.run('Move selection', commands);
  if (!outcome.accepted) return outcome;
  this.update({ selected: moving, surfaces: new Set() });
  return outcome;
}

/** Placing new hull pieces, fittings and room boundaries. Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { seatWallFitting } from '../../../ships/constructionWallFittings';
import type { ConstructionBoundary, ConstructionEquipment, Vec3 } from '../../../ships/blueprint';
import { mirroredEquipment } from '../../../ships/constructionEditor';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import { offCenterline } from '../placement';
import { blockPlacementAllowed, placementBlocks, OVERLAP_NOTICE } from '../blockMovement';
import type { BuilderPlacement } from '../builderScene';
import { BOUNDARY_NAMES, LIMITS } from '../builderToolState';
import type { BuilderTool } from '../builderTool';

/** A click or a finished stroke: one piece per point plus mirrored twins, as one undoable edit. */
export function placeAt(this: BuilderTool, points: Vec3[], bearingDeg?: number, hullPlacement?: Extract<BuilderPlacement, { kind: 'hull' }>): ConstructionSubmission | undefined {
  const piece = hullPlacement ?? this.piece, active = this.active, { mirror } = this.state;
  if (!piece) return undefined;
  const refused = this.refused(); if (refused) return refused;
  if (piece.kind === 'hull' && active?.kind === 'shape') {
    const pieces = placementBlocks(piece, points, mirror, () => this.newId('hull'));
    if (!blockPlacementAllowed(this.source, pieces)) { this.update({ notice: OVERLAP_NOTICE }); return undefined; }
    if (this.data.primitives.length + pieces.length > LIMITS.primitives) { this.door.setError(`A design supports up to ${LIMITS.primitives} hull pieces. Use larger pieces or remove a section before adding more.`); return undefined; }
    return this.run(pieces.length > 1 ? 'Lay hull pieces' : 'Place hull piece', pieces.map(value => ({ op: 'primitive', value })));
  }
  if (piece.kind === 'equipment' && active?.kind === 'part') {
    const parts: ConstructionEquipment[] = [];
    for (const point of points) {
      // The viewport already snaps the face plane; retain the exact socket height.
      parts.push({ id: this.newId('equipment'), partId: active.id, position: [...point], bearingDeg: bearingDeg ?? piece.bearingDeg, ...(piece.wall ? { wall: { ...piece.wall } } : {}), ...(this.state.layer === 'fittings' && this.state.fittingPaint ? { paint: this.state.fittingPaint } : {}) });
      if (piece.wall && points.length > 1 && this.compiled) parts[parts.length-1]=seatWallFitting(parts.at(-1)!,active.part,this.compiled.surfaces);
      if (mirror && offCenterline(point)) {
        const original = parts.at(-1)!, twin = { ...mirroredEquipment(original), id: this.newId('equipment') };
        if (original.wall) { original.wall.mirrorId = twin.id; twin.wall = { ...twin.wall!, mirrorId: original.id }; }
        parts.push(twin);
      }
    }
    if (this.data.equipment.length + parts.length > LIMITS.equipment) { this.door.setError(`A design supports up to ${LIMITS.equipment} fittings. Remove a fitting before adding more.`); return undefined; }
    return this.run(parts.length > 1 ? 'Place fittings' : `Place ${active.name}`, parts.map(value => ({ op: 'equipment', value })));
  }
  return undefined;
}

export function addBoundary(this: BuilderTool, axis: ConstructionBoundary['axis'], offset: number): ConstructionSubmission | undefined {
  if (this.data.boundaries.length >= LIMITS.boundaries) { this.door.setError(`A design supports up to ${LIMITS.boundaries} decks and bulkheads. Merge rooms before adding more.`); return undefined; }
  if (this.data.boundaries.some(wall => wall.axis === axis && Math.abs(wall.offset - offset) < 1e-6)) { this.update({ notice: `A ${BOUNDARY_NAMES[axis].toLowerCase()} already sits here.` }); return undefined; }
  return this.run(`Add ${BOUNDARY_NAMES[axis].toLowerCase()}`, [{ op: 'boundary', value: { id: this.newId('boundary'), axis, offset, thicknessMm: 10 } }]);
}

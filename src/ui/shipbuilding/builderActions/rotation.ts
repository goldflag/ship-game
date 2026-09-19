/** Turning: the rotate tool, quarter turns of blocks, wall fittings and fitted parts. Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { blockAngles, rotateBlock, withBlockAngles } from '../../../ships/constructionOrientation';
import { seatWallFitting, turnedWallFitting } from '../../../ships/constructionWallFittings';
import type { ConstructionEquipment } from '../../../ships/blueprint';
import type { ConstructionCommand } from '../../../ships/constructionCommands';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import { normalizedBearing } from '../editorNumbers';
import type { BuilderTool } from '../builderTool';

export function rotateSelectedBlock(this: BuilderTool, axis: number, degrees: number) {
  const p = this.rotationPrimitive;
  if (!p || this.locked || ![0, 1, 2].includes(axis) || !Number.isFinite(degrees) || Math.abs(degrees % 360) < 1e-8) return;
  return this.edit('Rotate block', [{ op: 'primitive', value: rotateBlock(p, axis, degrees) }]);
}

export function setBlockAngle(this: BuilderTool, axis: number, degrees: number) {
  const p = this.rotationPrimitive;
  if (!p || this.locked || ![0, 1, 2].includes(axis) || !Number.isFinite(degrees) || Math.abs(degrees) > 3600) return;
  const angles = blockAngles(p); angles[axis] = degrees;
  return this.edit('Set block angle', [{ op: 'primitive', value: withBlockAngles(p, angles) }]);
}

export function resetBlockRotation(this: BuilderTool) {
  const p = this.rotationPrimitive;
  if (p && !this.locked && blockAngles(p).some(n => n !== 0)) this.edit('Reset block orientation', [{ op: 'primitive', value: withBlockAngles(p, [0, 0, 0]) }]);
}

export function rotate(this: BuilderTool, fine = false): ConstructionSubmission | undefined {
  const piece = this.piece;
  // Wall fittings keep facing out of their wall; R spins them a quarter turn within it.
  if (piece?.kind === 'equipment' && piece.wall) { this.update({ wallTurn: normalizedBearing(this.state.wallTurn + (fine ? -90 : 90)) }); return undefined; }
  const walls = this.selectedEquipment.filter(e => e.wall);
  if (!piece && walls.length && walls.length === this.state.selected.size) return this.turnWallFittings(walls, fine ? -90 : 90);
  if (piece?.kind === 'hull') return this.turn(1, fine ? -90 : 90);
  if (piece && piece.kind !== 'boundary') { this.update({ bearing: normalizedBearing(this.state.bearing + (fine ? 1 : 15)) }); return undefined; }
  if (this.state.selected.size) return this.command('Rotate selection', this.mirrored([{ op: 'rotate', ids: [...this.state.selected], degrees: this.selectedPrimitives.length ? fine ? -90 : 90 : fine ? 1 : 15 }]));
  return undefined;
}

/** Quarter-turn wall fittings about their wall normals in place; linked partners follow through the command layer. */
export function turnWallFittings(this: BuilderTool, items: readonly ConstructionEquipment[], degrees: number): ConstructionSubmission | undefined {
  if (this.locked) return undefined;
  if (!this.compiled) { this.notify('Wait for the hull to finish compiling before turning wall fittings.'); return undefined; }
  const commands: ConstructionCommand[] = [], handled = new Set<string>();
  for (const item of items) {
    const part = this.catalog.equipment.find(p => p.id === item.partId);
    if (!part || handled.has(item.id)) continue;
    handled.add(item.id); if (item.wall?.mirrorId) handled.add(item.wall.mirrorId);
    commands.push({ op: 'equipment', value: seatWallFitting(turnedWallFitting(item, part, degrees), part, this.compiled.surfaces) });
  }
  return commands.length ? this.run(commands.length > 1 ? 'Turn wall fittings' : 'Turn wall fitting', commands) : undefined;
}

/** A quarter turn of hull blocks about a ship axis: the block about to be placed, else each selected block in place. */
export function turn(this: BuilderTool, axis: number, degrees: number): ConstructionSubmission | undefined {
  if (this.locked || ![0, 1, 2].includes(axis)) return undefined;
  const piece = this.piece, { bearing, tilt } = this.state;
  if (piece) {
    if (piece.kind !== 'hull') return axis === 1 ? this.rotate(degrees < 0) : undefined;
    if (axis !== 1 && piece.shape === 'balcony') { this.notify('Balconies turn about the vertical axis only.'); return undefined; }
    const turned = rotateBlock({ id: '', kind: piece.shape, size: piece.size, position: [0, 0, 0], rotationDeg: normalizedBearing(Math.round(bearing / 90) * 90), ...(tilt ? { tilt } : {}) }, axis, degrees);
    this.update({ bearing: turned.rotationDeg, tilt: turned.tilt });
    return undefined;
  }
  const blocks = this.selectedPrimitives;
  if (axis === 1 || !blocks.length) return axis === 1 ? this.rotate(degrees < 0) : undefined;
  return this.edit(blocks.length > 1 ? 'Rotate blocks' : 'Rotate block', blocks.map(p => ({ op: 'primitive', value: rotateBlock(p, axis, degrees) })));
}

/** Empty ids rotate the cursor; fitted parts rotate in place as one source edit. */
export function rotateFittings(this: BuilderTool, ids: string[], degrees: number): ConstructionSubmission | undefined {
  if (!Number.isFinite(degrees) || Math.abs(degrees % 360) < 1e-6 || this.locked) return undefined;
  if (!ids.length) {
    if (this.piece?.kind === 'equipment') this.update({ bearing: normalizedBearing(this.state.bearing + degrees) });
    return undefined;
  }
  ids = ids.filter(id => this.selectable(id) && this.data.equipment.some(item => item.id === id && !item.wall));
  if (!ids.length) return undefined;
  return this.edit('Rotate fittings', [{ op: 'rotate', ids, degrees }]);
}

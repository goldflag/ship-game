/** Armor, paint, openings and finishes on hull faces and fittings. Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { hullPaintBands } from '../../../ships/hullPaintBands';
import { CONSTRUCTION_PAINTS, constructionShipPaint, isConstructionSurfaceFinish } from '../../../ships/constructionPaints';
import type { ConstructionSource } from '../../../ships/blueprint';
import { assignConstructionSurfaces, surfaceSelectionKey } from '../../../ships/constructionEditor';
import type { ConstructionCommand } from '../../../ships/constructionCommands';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import type { SlotItem } from '../builderLayers';
import { mirrorTwinEquipment } from '../placement';
import type { SurfaceValues } from '../builderToolState';
import type { BuilderTool } from '../builderTool';

/** Face assignments as complete records, created from the skin default exactly as the editor helpers do. */
export function surfaceCommands(this: BuilderTool, keys: ReadonlySet<string>, values: SurfaceValues): ConstructionCommand[] {
  const draft = { ...this.source, construction: { ...this.data, surfaces: this.data.surfaces.map(surface => ({ ...surface })) } };
  assignConstructionSurfaces(draft, keys, values);
  return draft.construction.surfaces.filter(surface => keys.has(surfaceSelectionKey(surface))).map(value => ({ op: 'surface', value }));
}

export function applyItem(this: BuilderTool, item: SlotItem, keys: ReadonlySet<string>, thickness = this.state.customMm): ConstructionSubmission | undefined {
  if (!keys.size) return undefined;
  const target = this.withMirrorFaces(keys);
  const assign = (label: string, values: SurfaceValues) => this.run(label, this.surfaceCommands(target, values));
  switch (item.kind) {
    case 'thickness': thickness = item.mm; // falls through
    case 'armor': return assign(`Assign ${thickness} mm armor`, { thicknessMm: thickness, material: thickness > 0 ? 'armor-steel' : 'steel', open: false });
    case 'opening': return assign('Open faces to sea', { open: true });
    case 'paint': return assign(`Paint ${item.name.toLowerCase()}`, { paint: item.id });
    default: return undefined;
  }
}

export function setFinish(this: BuilderTool, finish?: ConstructionSource['construction']['finish']): ConstructionSubmission | undefined {
  if (finish !== undefined && !isConstructionSurfaceFinish(finish)) return undefined;
  return this.run('Set ship surface finish', [{ op: 'finish', finish }]);
}

/** Ship paint coats every face and fitting without a colour of its own. Faces and fittings wearing
 * the previous ship paint follow the change; decks, boot topping and other accents stay. */
export function setShipPaint(this: BuilderTool, paint?: string): ConstructionSubmission | undefined {
  if (paint && !CONSTRUCTION_PAINTS.some(entry => entry.id === paint)) return undefined;
  const previous = constructionShipPaint(this.source), next = paint ?? 'naval-gray';
  if (paint === this.data.paint) return undefined;
  const commands: ConstructionCommand[] = [{ op: 'ship-paint', paint }];
  if (previous !== next) for (const surface of this.data.surfaces) if (surface.paint === previous) commands.push({ op: 'surface', value: { ...surface, paint: next } });
  if (paint) for (const item of this.data.equipment) if (this.partOf(item)?.path?.kind !== 'rope' && (item.paint === previous || item.paint === paint)) commands.push({ op: 'equipment-patch', id: item.id, changes: { paint: null } });
  return this.run('Set ship paint', commands);
}

/** Paint whole installations without changing the shared component or other instances. */
export function paintFittings(this: BuilderTool, ids: readonly string[], paint?: string): ConstructionSubmission | undefined {
  if (paint && !CONSTRUCTION_PAINTS.some(entry => entry.id === paint)) return undefined;
  const targets = new Set(ids);
  const fittings = this.data.equipment.filter(item => this.partOf(item)?.placement !== 'internal');
  if (this.state.mirror) for (const item of fittings) if (targets.has(item.id)) {
    const twin = mirrorTwinEquipment(this.source, item); if (twin) targets.add(twin.id);
  }
  const commands = fittings.filter(item => targets.has(item.id)).map((item): ConstructionCommand => {
    const value = { ...item }; if (paint) value.paint = paint; else delete value.paint;
    return { op: 'equipment', value };
  });
  if (!commands.length) return undefined;
  const outcome = this.run(paint ? 'Paint fittings' : 'Restore original fitting finish', commands);
  if (outcome.accepted) this.update({ fittingPaint: paint });
  return outcome;
}

export function applyScheme(this: BuilderTool, id: 'two-tone' | 'disruptive'): ConstructionSubmission {
  const keys = [...this.editableKeys];
  const coated = new Set(this.data.primitives.filter(p => p.kind === 'custom-hull' && hullPaintBands(p.customHull).length > 0).map(p => p.id));
  const redBottom = new Set(this.editableSurfaces.filter(s => s.face === 'bottom' && !coated.has(s.primitiveId)).map(surfaceSelectionKey));
  if (id === 'two-tone') return this.run('Apply two-tone paint', [
    ...this.surfaceCommands(new Set(keys.filter(key => key.endsWith(':top'))), { paint: 'deck-gray' }),
    ...this.surfaceCommands(redBottom, { paint: 'red-oxide' }),
    ...this.surfaceCommands(new Set(keys.filter(key => !key.endsWith(':top') && !redBottom.has(key))), { paint: 'naval-gray' })]);
  return this.run('Apply disruptive paint', this.data.primitives.flatMap(primitive => this.surfaceCommands(new Set(keys.filter(key => key.startsWith(`${primitive.id}:`) && !key.endsWith(':bottom'))), { paint: Math.abs(Math.floor(primitive.position[2] / 12)) % 2 ? 'sea-blue' : 'light-gray' })));
}

/** A face sweep: the Paint tool assigns the active card to every face the drag crossed and their mirrors; Opening sets them all to the first face's opposite state. */
export function applyFaces(this: BuilderTool, keys: readonly string[]): ConstructionSubmission | undefined {
  if (this.locked || !this.faceLayer) return undefined;
  if (!this.compiled && !this.retained) { this.update({ notice: 'Face editing resumes when this source has a compiled preview.' }); return undefined; }
  const editable = keys.filter(key => this.editableKeys.has(key));
  if (!editable.length) { if (keys.length) this.update({ notice: 'This fixed equipment support follows its fitting. Choose a hull face to edit.' }); return undefined; }
  const target = new Set(editable), tool = this.state.tool;
  if (tool === 'opening') {
    const first = this.editableSurfaces.find(entry => surfaceSelectionKey(entry) === editable[0])!;
    return this.run(first.open ? 'Close skin' : 'Open faces to sea', this.surfaceCommands(this.withMirrorFaces(target), { open: !first.open }));
  }
  return tool === 'apply' && this.active ? this.applyItem(this.active, target) : undefined;
}

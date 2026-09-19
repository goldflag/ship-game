/** Clicks and box selection resolved by the viewport.
 * Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { surfaceSelectionKey } from '../../../ships/constructionEditor';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import { canEditVertices } from '../../../ships/constructionVertex';
import type { BuilderPick } from '../builderScene';
import { type BuilderToolState, AXIS } from '../builderToolState';
import type { BuilderTool } from '../builderTool';

export function choose(this: BuilderTool, id: string, additive = false) {
  if (!this.selectable(id)) return;
  const patch: Partial<BuilderToolState> = {};
  const freeform = this.state.freeform;
  if (freeform && !additive && id !== freeform.baseline.id) {
    const part = this.data.primitives.find((part) => part.id === id && canEditVertices(part));
    patch.freeform = part ? { designId: this.source.id, baseline: structuredClone(part) } : undefined;
  }
  if (!additive) patch.selected = new Set([id]);
  else {
    const next = new Set(this.state.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patch.selected = next;
  }
  this.update(patch);
}

/** A click resolved by the viewport: measure, face assignment, boundaries, merge, erase or selection by tool. */
export function pick(this: BuilderTool, hit?: BuilderPick): ConstructionSubmission | undefined {
  if (this.locked) return undefined;
  const { layer, tool } = this.state;
  if (!hit) {
    this.clearSelection();
    return undefined;
  }
  if (tool === 'measure') {
    const current = this.state.measure;
    this.update({ measure: !current || current.to ? { from: hit.point } : { ...current, to: hit.point } });
    return undefined;
  }
  if (tool === 'erase') return hit.id ? this.erase(hit.id) : undefined;
  if (layer === 'paint' && hit.id) {
    const fitting = this.data.equipment.find((item) => item.id === hit.id);
    if (fitting) {
      if (tool === 'apply' && this.active?.kind === 'paint') return this.paintFittings([fitting.id], this.active.id);
      if (tool === 'eyedrop') {
        if (fitting.paint)
          this.update({ slots: { ...this.state.slots, paint: fitting.paint }, tool: 'apply', notice: 'Paint picked from fitting.' });
        else this.update({ notice: 'This fitting uses its original component finish. Choose a paint to recolor it.' });
      } else {
        this.update({ surfaces: new Set() });
        this.choose(fitting.id, hit.additive);
      }
      return undefined;
    }
  }
  if (layer === 'armor' || layer === 'paint') {
    if (!hit.additive) this.update({ selected: new Set() });
    if (!hit.surface) {
      if (!hit.additive) this.update({ surfaces: new Set() });
      if (hit.id && tool === 'select') this.choose(hit.id, hit.additive);
      else if (!hit.additive) this.update({ selected: new Set() });
      return undefined;
    }
    if (!this.compiled && !this.retained) {
      this.update({ notice: 'Face editing resumes when this source has a compiled preview.' });
      return undefined;
    }
    if (!this.editableKeys.has(hit.surface)) {
      this.update({ notice: 'This fixed equipment support follows its fitting. Choose a hull face to edit.' });
      return undefined;
    }
    const surface = this.editableSurfaces.find((entry) => surfaceSelectionKey(entry) === hit.surface)!;
    switch (tool) {
      case 'apply':
        return this.applyFaces([hit.surface]);
      case 'area': {
        // Armor's Fill pours the active card over every face with this name; Paint's Area gathers them into a selection.
        if (layer === 'armor')
          return this.active
            ? this.applyItem(
                this.active,
                new Set(this.editableSurfaces.filter((entry) => entry.face === surface.face).map(surfaceSelectionKey)),
              )
            : undefined;
        const next = hit.additive ? new Set(this.state.surfaces) : new Set<string>();
        for (const entry of this.editableSurfaces) if (entry.face === surface.face) next.add(surfaceSelectionKey(entry));
        this.update({ surfaces: next });
        return undefined;
      }
      case 'eyedrop':
        if (layer === 'armor')
          this.update({
            customMm: surface.thicknessMm,
            slots: { ...this.state.slots, armor: 'armor' },
            notice: `Armor thickness set to ${surface.thicknessMm} mm from the picked face.`,
            tool: 'apply',
          });
        else
          this.update({
            slots: { ...this.state.slots, paint: surface.paint },
            notice: 'Paint slot set from the picked face.',
            tool: 'apply',
          });
        return undefined;
      case 'opening':
        return this.applyFaces([hit.surface]);
      default: {
        const next = hit.additive ? new Set(this.state.surfaces) : new Set<string>();
        if (next.has(hit.surface)) next.delete(hit.surface);
        else next.add(hit.surface);
        this.update({ surfaces: next });
        return undefined;
      }
    }
  }
  if (layer === 'internals' && (tool === 'deck' || tool === 'bulkhead' || tool === 'longitudinal')) {
    const axis = tool === 'deck' ? 'y' : tool === 'bulkhead' ? 'z' : 'x';
    return this.addBoundary(axis, hit.placement[AXIS[axis]]);
  }
  if (layer === 'internals' && tool === 'merge') {
    if (hit.id && this.data.boundaries.some((wall) => wall.id === hit.id))
      return this.run('Merge rooms', [{ op: 'remove', ids: [hit.id] }]);
    this.update({ notice: 'Click a deck or bulkhead to merge the rooms on either side.' });
    return undefined;
  }
  if (hit.id) this.choose(hit.id, hit.additive);
  else if (!hit.additive) this.clearSelection();
  return undefined;
}

export function boxSelect(this: BuilderTool, ids: string[], additive: boolean) {
  if (this.locked || this.state.layer === 'armor') return;
  ids = ids.filter(this.selectable);
  this.update({ tool: 'select', surfaces: new Set(), selected: new Set(additive ? [...this.state.selected, ...ids] : ids) });
}

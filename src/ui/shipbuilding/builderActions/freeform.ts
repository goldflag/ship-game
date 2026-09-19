/** Freeform hull sessions: enter, selection mode, commit and split. Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { editableMesh } from '../../../ships/constructionMesh';
import type { ConstructionPrimitive } from '../../../ships/blueprint';
import { constructionDiffCommands } from '../../../ships/constructionCommands';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import { canEditVertices, splitVertexPrimitive, type HullSelectionMode } from '../../../ships/constructionVertex';
import { twinPrimitive, withTwinReplacements } from '../mirrorEditing';
import { freeformSelection } from '../builderToolState';
import type { BuilderTool } from '../builderTool';

/** True when a single editable block entered freeform editing, so the caller closes the drawer. */
export function enterFreeform(this: BuilderTool): boolean {
  const part = this.selectedPrimitives[0];
  if (!part || this.state.selected.size !== 1 || !canEditVertices(part)) return false;
  const converted=editableMesh(part);
  if(converted.mesh&&!part.mesh&&!this.commitFreeform([converted])?.accepted)return false;
  // The session keeps the selection mode last used; a new editor starts on faces.
  this.update({ tool: 'select', layer: 'hull', surfaces: new Set(), freeformSettings:{...this.state.freeformSettings,selection:freeformSelection(converted,this.state.freeformSettings.selection.mode)}, freeform: { designId: this.source.id, baseline: structuredClone(part) } });
  return true;
}

/** Vertex, edge, face or ring selection (1–4 while shaping); a mode the block lacks is ignored. */
export function setFreeformMode(this: BuilderTool, mode: HullSelectionMode) {
  const primitive = this.freeformPrimitive, selection = freeformSelection(primitive, mode);
  if (primitive && selection.mode === mode && mode !== this.state.freeformSettings.selection.mode) this.changeFreeformSettings({ selection });
}

/** With Mirror on, the reshaped blocks' twins take the mirrored shape in the same edit. */
export function commitFreeform(this: BuilderTool, replacements: ConstructionPrimitive[]): ConstructionSubmission | undefined {
  const known = replacements.filter(part => this.data.primitives.some(existing => existing.id === part.id));
  const shaped = this.state.mirror ? withTwinReplacements(this.source, known, this.state.freeform?.baseline.id) : known;
  return shaped.length ? this.run('Shape freeform hull', shaped.map(value => ({ op: 'primitive', value }))) : undefined;
}

export function splitFreeform(this: BuilderTool) {
  const primitive = this.freeformPrimitive, settings = this.state.freeformSettings;
  if (!primitive) return;
  try {
    const twin = this.state.mirror ? this.freeformTwin : undefined;
    const next = structuredClone(this.source), ids = splitVertexPrimitive(next, primitive.id, settings.splitAxis, settings.count);
    if (twin) {
      // The twin splits into the reflected pieces, which run the other way along its mirrored local X.
      const twins = splitVertexPrimitive(next, twin.id, settings.splitAxis, settings.count), pieces = next.construction.primitives;
      ids.forEach((id, i) => { const at = pieces.findIndex(p => p.id === twins[settings.splitAxis === 0 ? ids.length - 1 - i : i]); pieces[at] = twinPrimitive(pieces.find(p => p.id === id)!, pieces[at]); });
    }
    this.run('Split hull block', constructionDiffCommands(this.source, next));
    this.update({ selected: new Set([ids[0]]), freeform: undefined });
  } catch (cause) { this.fail(cause); }
}

/** Mirror editing helpers: the twins an edit reaches and the faces across the centerline. Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { mirroredPanelId } from '../../../ships/constructionPanels';
import { mirroredFace, surfaceKey, surfaceSelectionKey, type ConstructionFace } from '../../../ships/constructionEditor';
import type { ConstructionCommand } from '../../../ships/constructionCommands';
import { mirrorTwin } from '../placement';
import { mirrorTwins, withMirroredEdits } from '../mirrorEditing';
import type { BuilderTool } from '../builderTool';

/** The separate twin of each of these pieces and fittings; a twin that is `within` the edit moves with it instead. */
export function twinsOf(this: BuilderTool, ids: Iterable<string>, within?: ReadonlySet<string>): Map<string, string> {
  const edited = new Set(ids);
  return this.state.mirror ? mirrorTwins(this.source, edited, within ? new Set([...edited, ...within]) : edited) : new Map();
}

export function mirrored(this: BuilderTool, commands: ConstructionCommand[]) { return this.state.mirror ? withMirroredEdits(this.source, commands) : commands; }

/** Mirror placement reaches the twin face across the centerline, including the far side of a straddling piece. */
export function withMirrorFaces(this: BuilderTool, keys: ReadonlySet<string>): Set<string> {
  if (!this.state.mirror) return new Set(keys);
  const out = new Set(keys), editableKeys = this.editableKeys;
  for (const key of keys) {
    const surface = this.editableSurfaces.find(surface => surfaceSelectionKey(surface) === key);
    if (!surface) continue;
    const { primitiveId, face, panelId } = surface;
    const primitive = this.data.primitives.find(part => part.id === primitiveId), twin = primitive && mirrorTwin(this.source, primitive);
    const reflected = primitive && twin ? surfaceKey(twin.id, mirroredFace(face as ConstructionFace, primitive.kind), mirroredPanelId(panelId)) : undefined;
    if (reflected && editableKeys.has(reflected)) out.add(reflected);
  }
  return out;
}

/** Native layout suggestions: request and apply. Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { constructionDiffCommands } from '../../../ships/constructionCommands';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import type { BuilderTool } from '../builderTool';

export async function suggest(this: BuilderTool, selectedPart = false) {
  if (this.pathPart) { this.update({ notice: 'Click connected points on the ship, then press Enter to finish this path.' }); return; }
  const request = this.context.suggest;
  if (!request || this.locked) return;
  const source = this.source, data = this.data, active = this.active;
  const fittedKinds = new Set(data.equipment.map(instance => this.partOf(instance)?.kind));
  const ids = selectedPart ? (active?.kind === 'part' ? [active.id] : []) : this.catalog.equipment.filter(part => {
    if (part.kind === 'magazine' || part.placement !== 'internal' || fittedKinds.has(part.kind)) return false;
    fittedKinds.add(part.kind); return true;
  }).map(part => part.id).slice(0, 16);
  if (!ids.length) { this.update({ notice: selectedPart ? 'Choose a fitting slot to place by suggestion.' : 'Every internal family is already fitted.' }); return; }
  this.door.setBusy('Finding a layout'); this.update({ suggestion: undefined }); const revision = source.revision;
  const abort = new AbortController(); this.suggestionRequest?.abort(); this.suggestionRequest = abort;
  try {
    const proposed = await request(structuredClone(source), ids, abort.signal);
    if (abort.signal.aborted) return;
    if (proposed.source.id !== source.id || proposed.source.construction.catalogRevision !== data.catalogRevision) throw new Error('The layout belongs to a different design or equipment catalog. Request a new suggestion.');
    this.update({ suggestion: { proposal: proposed, revision } });
  } catch (cause) { if (!abort.signal.aborted) this.fail(cause); }
  finally { if (this.suggestionRequest === abort) this.suggestionRequest = undefined; this.door.setBusy(''); }
}

export function applySuggestion(this: BuilderTool): ConstructionSubmission | undefined {
  const suggestion = this.state.suggestion;
  if (!suggestion || this.source.revision !== suggestion.revision) return undefined;
  const next = structuredClone(this.source), proposal = suggestion.proposal.source.construction;
  next.construction.equipment = structuredClone(proposal.equipment); next.construction.boundaries = structuredClone(proposal.boundaries); next.construction.loads = structuredClone(proposal.loads);
  for (const item of next.construction.equipment) if (this.state.fittingPaint && !this.data.equipment.some(existing => existing.id === item.id) && this.partOf(item)?.placement !== 'internal') item.paint = this.state.fittingPaint;
  const outcome = this.run('Apply suggested layout', constructionDiffCommands(this.source, next));
  this.update({ suggestion: undefined });
  return outcome;
}

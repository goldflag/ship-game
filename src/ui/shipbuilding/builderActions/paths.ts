/** Connected routes and two-click ladders: pending points, finish and draw.
 * Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import { accessDefaults, accessLayout, isAccessKind } from '../../../../assets/parts/construction/access_geometry';
import { equipmentOverLimit } from '../../../ships/constructionCustomFittings';
import { fittedLadder } from '../../../ships/constructionLadders';
import type { Vec3 } from '../../../ships/blueprint';
import { mirroredEquipment } from '../../../ships/constructionEditor';
import type { ConstructionSubmission } from '../../../ships/constructionRevisionOwner';
import { pathSlackLimit, pathProblem } from '../../../ships/constructionPaths';
import { appendPathPoint, pathEquipment } from '../pathDrawing';
import { LIMITS } from '../builderToolState';
import type { BuilderTool } from '../builderTool';

export function drawLadder(this: BuilderTool, points: Vec3[], bearingDeg: number): ConstructionSubmission | undefined {
  const part = this.pathPart;
  if (!part?.path || !(part.path.kind === 'ladder' || isAccessKind(part.path.kind)) || this.refused()) return;
  const problem = pathProblem(points);
  if (problem) {
    this.door.setError(problem);
    return;
  }
  const item = pathEquipment(this.newId('ladder'), part.id, points, 0, bearingDeg);
  if (isAccessKind(part.path.kind)) item.path!.access = accessDefaults(part.path.kind);
  if (this.state.fittingPaint) item.paint = this.state.fittingPaint;
  const parts = [item];
  if (this.state.mirror && points.some((p) => Math.abs(p[0]) > 1e-6)) parts.push({ ...mirroredEquipment(item), id: this.newId('ladder') });
  if (isAccessKind(part.path.kind) && !accessLayout(part.path.kind, item.path!.points, item.path!.access!)) {
    this.door.setError(
      part.path.kind === 'inclined-ladder'
        ? 'Use a 0.5–12 m rise and a 30–75° incline.'
        : 'Click two points straight up the supporting wall, 0.5–12 m apart.',
    );
    return;
  }
  if (part.path.kind === 'ladder' && (!this.compiled || parts.some((e) => !fittedLadder(part, e, this.compiled!.surfaces)))) {
    this.door.setError('Every rung needs a closed hull side behind both ends. Move away from edges or turn Mirror off.');
    return;
  }
  const outcome = this.run(
    `Draw ${part.name}`,
    parts.map((value) => ({ op: 'equipment', value })),
  );
  if (outcome.accepted) this.update({ pathPoints: [], selected: new Set(parts.map((p) => p.id)), tool: 'select' });
  return outcome;
}

export function addPathPoint(this: BuilderTool, point: Vec3, bearingDeg = 0) {
  if (this.locked) return;
  if ((this.pathPart?.path?.kind === 'ladder' || isAccessKind(this.pathPart?.path?.kind)) && this.state.pathPoints.length) {
    const points = appendPathPoint(this.state.pathPoints, point);
    if (points.length === 2) this.drawLadder(points, this.state.pathBearing);
    return;
  }
  if (this.state.pathPoints.length >= 64) {
    this.update({ notice: '64 points reached. Finish this path before starting another.' });
    return;
  }
  if (!this.locked)
    this.update({
      pathPoints: appendPathPoint(this.state.pathPoints, point),
      pathBearing: this.state.pathPoints.length ? this.state.pathBearing : bearingDeg,
      selected: new Set(),
      surfaces: new Set(),
    });
}

/** The route and its mirrored copy become one undoable edit; the new fittings are then selected. */
export function finishPath(this: BuilderTool): ConstructionSubmission | undefined {
  const pathPart = this.pathPart,
    { pathPoints, ropeSlack, mirror } = this.state;
  if (!pathPart) return undefined;
  const refused = this.refused();
  if (refused) return refused;
  if (pathPart.path?.kind === 'ladder' || isAccessKind(pathPart.path?.kind)) return this.drawLadder(pathPoints, this.state.pathBearing);
  const slackM = pathPart.path?.kind === 'rope' ? Math.min(ropeSlack, pathSlackLimit(pathPoints)) : 0,
    problem = pathProblem(pathPoints, slackM);
  if (problem) {
    this.update({ notice: problem });
    return undefined;
  }
  const item = pathEquipment(this.newId('path'), pathPart.id, pathPoints, slackM);
  if (pathPart.path?.kind === 'railing')
    Object.assign(item.path!, { heightM: this.state.railingHeight, railCount: pathPart.path?.railCount ?? 3 });
  if (this.state.fittingPaint) item.paint = this.state.fittingPaint;
  const parts = [item];
  if (mirror && pathPoints.some((point) => Math.abs(point[0]) > 1e-6)) parts.push({ ...mirroredEquipment(item), id: this.newId('path') });
  if (equipmentOverLimit(this.data, parts, LIMITS.equipment)) {
    this.update({ notice: 'The fittings limit is reached. Remove a fitting before adding this path.' });
    return undefined;
  }
  const outcome = this.run(
    `Draw ${pathPart.path!.kind} path`,
    parts.map((value) => ({ op: 'equipment', value })),
  );
  this.update({ pathPoints: [], selected: new Set(parts.map((part) => part.id)), tool: 'select' });
  return outcome;
}

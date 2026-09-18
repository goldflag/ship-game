import init, { ConstructionOverlap } from '../../generated/naval-wasm/naval_wasm';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import type { BuilderPlacement } from './builderScene';
import { customHullPrimitive, makeHull } from '../../ships/customHullModel';
import { mirroredPrimitive } from '../../ships/constructionEditor';
import { placementBalcony } from '../../ships/constructionBalcony';

export const OVERLAP_PREVIEW_NOTICE = 'Leave 10% outside; keep ballast separate.';
export const OVERLAP_NOTICE = 'Keep at least 10% of each hull block outside the others. Ballast blocks cannot overlap.';
/** The editor opens its revision door only after these native gesture queries are ready. */
export const initBlockGeometry = () => init();
const scenes = new WeakMap<ConstructionPrimitive[], ConstructionOverlap>();
function scene(primitives: ConstructionPrimitive[]) {
  let value = scenes.get(primitives);
  if (!value) { value = new ConstructionOverlap(JSON.stringify(primitives)); scenes.set(primitives, value); }
  return value;
}

/** Reuse exact native solids during a drag. Rust certifies swept intervals, so fast
 * pointer jumps cannot bypass the limit. Existing invalid drafts can recover. */
export function blockMoveConstraint(source: ConstructionSource, selected: ReadonlySet<string>): (delta: Vec3) => Vec3 {
  if (!source.construction.primitives.some(p => selected.has(p.id))) return delta => delta.every(Number.isFinite) ? delta : [0, 0, 0];
  let native: ConstructionOverlap;
  try { native = scene(source.construction.primitives); } catch { return () => [0, 0, 0]; }
  const ids = JSON.stringify([...selected]);
  return delta => {
    if (!delta.every(Number.isFinite)) return [0, 0, 0];
    try { return (JSON.parse(native.movement(ids, JSON.stringify(delta))) as Vec3).map(v => Math.abs(v) < 1e-6 ? 0 : v) as Vec3; }
    catch { return [0, 0, 0]; }
  };
}
export function blockPlacementAllowed(source: ConstructionSource, additions: ConstructionPrimitive[]): boolean {
  if (!additions.length) return true;
  try { return scene(source.construction.primitives).placement(JSON.stringify(additions)); }
  catch { return false; }
}
/** Preview and commit construct the same batch, including mirrored pieces. */
export function placementBlocks(piece: Extract<BuilderPlacement, { kind: 'hull' }>, points: Vec3[], mirror: boolean, newId: () => string): ConstructionPrimitive[] {
  const blocks: ConstructionPrimitive[] = [];
  for (const position of points) {
    const p: ConstructionPrimitive = { id: newId(), kind: piece.shape, size: [...piece.size], position: [...position], rotationDeg: piece.rotationDeg,
      ...(piece.shape === 'balcony' ? { balcony: piece.balcony ? structuredClone(piece.balcony) : placementBalcony(position, piece.rotationDeg) } : {}),
      ...(piece.shape === 'custom-hull' ? { customHull: customHullPrimitive(makeHull(0)).customHull } : {}) };
    blocks.push(p);
    if (mirror && Math.abs(position[0]) > 1e-6) blocks.push({ ...mirroredPrimitive(p), id: newId() });
  }
  return blocks;
}

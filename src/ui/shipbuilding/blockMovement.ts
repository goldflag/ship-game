import init, { ConstructionOverlap } from '../../generated/naval-wasm/naval_wasm';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import type { BuilderPlacement } from './builderScene';
import { customHullPrimitive } from '../../ships/customHullModel';
import { makeHull } from '../../ships/customHullStarter';
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
const restScenes = new WeakMap<ConstructionPrimitive[], { key: string; scene: ConstructionOverlap }>();
/** Mirror editing: `twins` travel the reflected path of `selected`. A move along the ship is one rigid
 * move of both sides. Across the beam each side is held by the stationary pieces, and the pair stops
 * at the last of seven samples that leaves both sides their 10% outside each other. */
export function mirroredMoveConstraint(source: ConstructionSource, selected: ReadonlySet<string>, twins: ReadonlySet<string>): (delta: Vec3) => Vec3 {
  if (!twins.size) return blockMoveConstraint(source, selected);
  const primitives = source.construction.primitives, reflect = (delta: Vec3): Vec3 => [-delta[0] || 0, delta[1], delta[2]];
  const together = blockMoveConstraint(source, new Set([...selected, ...twins])), own = blockMoveConstraint(source, selected), reflected = blockMoveConstraint(source, twins);
  const movers = primitives.filter(p => selected.has(p.id)), followers = primitives.filter(p => twins.has(p.id));
  const placed = (delta: Vec3) => {
    const key = JSON.stringify([...selected, ...twins]);
    let rest = restScenes.get(primitives);
    if (rest?.key !== key) { rest?.scene.free(); rest = { key, scene: new ConstructionOverlap(JSON.stringify(primitives.filter(p => !selected.has(p.id) && !twins.has(p.id)))) }; restScenes.set(primitives, rest); }
    const moved = (parts: ConstructionPrimitive[], by: Vec3) => parts.map(p => ({ ...p, position: p.position.map((v, k) => v + by[k]) }));
    return rest.scene.placement(JSON.stringify([...moved(movers, delta), ...moved(followers, reflect(delta))]));
  };
  // A pair that already overlaps too far keeps the single-sided rule, so it can still be pulled apart.
  let strict: boolean | undefined;
  return delta => {
    if (!delta.every(Number.isFinite)) return [0, 0, 0];
    if (Math.abs(delta[0]) < 1e-9) return together(delta);
    const a = own(delta), b = reflect(reflected(reflect(delta))), held = Math.hypot(...b) < Math.hypot(...a) ? b : a;
    if (!movers.length || !followers.length || held.every(v => v === 0)) return held;
    try {
      strict ??= placed([0, 0, 0]);
      if (!strict || placed(held)) return held;
      let low = 0, high = 1;
      for (let i = 0; i < 6; i++) { const mid = (low + high) / 2; if (placed(held.map(v => v * mid) as Vec3)) low = mid; else high = mid; }
      return held.map(v => v * low) as Vec3;
    } catch { return [0, 0, 0]; }
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
    const p: ConstructionPrimitive = { id: newId(), kind: piece.shape, size: [...piece.size], position: [...position], rotationDeg: piece.rotationDeg, ...(piece.tilt ? { tilt: { ...piece.tilt } } : {}),
      ...(piece.shape === 'balcony' ? { balcony: piece.balcony ? structuredClone(piece.balcony) : placementBalcony(position, piece.rotationDeg) } : {}),
      ...(piece.shape === 'custom-hull' ? { customHull: customHullPrimitive(makeHull()).customHull } : {}) };
    blocks.push(p);
    if (mirror && Math.abs(position[0]) > 1e-6) blocks.push({ ...mirroredPrimitive(p), id: newId() });
  }
  return blocks;
}

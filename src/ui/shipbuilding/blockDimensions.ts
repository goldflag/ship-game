import type { ConstructionPrimitive, Vec3 } from '../../ships/blueprint';
import { cornerVertices } from '../../ships/constructionVertex';
import { envelopeVertices } from '../../ships/freeformShape';

/** Local width, height and length; freeform size is a scale, not the edited bounds. */
export function blockDimensions(primitive: ConstructionPrimitive): Vec3 {
  if (primitive.kind !== 'vertex' && !primitive.mesh) return [...primitive.size];
  const points = envelopeVertices(primitive);
  if (!points.length) return [...primitive.size];
  return [0, 1, 2].map(axis => {
    let min = Infinity, max = -Infinity;
    for (const point of points) { min = Math.min(min, point[axis]); max = Math.max(max, point[axis]); }
    return (max - min) * primitive.size[axis];
  }) as Vec3;
}

/** Resize the measured solid without discarding its freeform shape or moving its pivot. */
export function resizeBlock(primitive: ConstructionPrimitive, axis: number, metres: number): ConstructionPrimitive {
  const next = structuredClone(primitive), current = blockDimensions(primitive)[axis];
  if (!Number.isFinite(metres) || metres <= 0 || current <= 0) return next;
  const factor = metres / current;
  if (next.mesh) next.mesh.vertices.forEach(point => { point[axis] *= factor; });
  else if (next.kind === 'vertex') {
    next.vertices = cornerVertices(next);
    next.vertices.forEach(point => { point[axis] *= factor; });
  } else next.size[axis] *= factor;
  return next;
}

export const dimensionText = (size: Vec3) => size.map(value => Number(value.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 })).join(' × ') + ' m';

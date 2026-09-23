import type { ConstructionResult, Vec3 } from './blueprint';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const object = (value: Json | undefined): value is { [key: string]: Json } => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new Error('The compiler returned an invalid compact construction result.');
function index(value: Json, length: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= length) throw invalid();
  return value;
}

/** Only the worker/cache envelope is compact. Restore the ordinary definition
 * before exposing it to the editor, port or battle; keep JSON.parse's independent
 * mutable arrays, including coordinates repeated within one face. */
export function decodeConstructionResult(json: string): ConstructionResult {
  const packet = JSON.parse(json) as Json;
  if (!object(packet)) throw invalid();
  let result: Json = packet;
  if ('format' in packet) {
    if (packet.format !== 'naval-construction-result' || packet.version !== 1 || !object(packet.result) || !Array.isArray(packet.vertices))
      throw invalid();
    result = packet.result;
    const vertices = packet.vertices;
    for (const point of vertices) {
      if (!Array.isArray(point) || point.length !== 3 || !point.every((n) => typeof n === 'number' && Number.isFinite(n))) throw invalid();
    }
    function expand(value: Json): void {
      if (Array.isArray(value)) {
        for (const item of value) expand(item);
      } else if (object(value)) {
        for (const key of Object.keys(value)) {
          const child = value[key];
          // A visual mesh fitting's `vertices` is its vertex count; every other `vertices` is an indexed point list.
          if (key === 'vertices' && typeof child === 'number') continue;
          if (key === 'vertices') {
            if (!Array.isArray(child)) throw invalid();
            value[key] = child.map((i) => (vertices[index(i, vertices.length)] as Vec3).slice());
          } else expand(child);
        }
      }
    }
    expand(result);
    if ('hullSurfaceIndices' in packet) {
      const indices = packet.hullSurfaceIndices,
        definition = result.definition;
      if (
        !Array.isArray(indices) ||
        !Array.isArray(result.surfaces) ||
        !object(definition) ||
        !object(definition.hull) ||
        !object(definition.hull.volume) ||
        'surfaces' in definition.hull.volume
      )
        throw invalid();
      const surfaces = result.surfaces;
      definition.hull.volume.surfaces = indices.map((i) => structuredClone(surfaces[index(i, surfaces.length)]));
    }
    if ('loadingFromDefinition' in packet) {
      if (packet.loadingFromDefinition !== true || !object(result.definition) || !object(result.definition.loading) || 'loading' in result)
        throw invalid();
      result.loading = structuredClone(result.definition.loading);
    }
  }
  if (
    !object(result) ||
    typeof result.sourceId !== 'string' ||
    typeof result.revision !== 'string' ||
    typeof result.contentHash !== 'string' ||
    !Array.isArray(result.surfaces) ||
    !Array.isArray(result.diagnostics)
  )
    throw invalid();
  return result as unknown as ConstructionResult;
}

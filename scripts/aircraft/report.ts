/** Reinspection uses Math.hypot for articulated vertex travel. Its final bit
 * can differ across JavaScript engines/platforms even for identical GLB bytes.
 * Allow only that calculation's roundoff; hashes and all other fields stay exact. */
export function aircraftReportMatches(actual: unknown, retained: unknown, path = '$'): boolean {
  if (actual === retained) return true;
  if (typeof actual === 'number' && typeof retained === 'number' &&
      /\.joints\.\d+\.maximumVertexTravel$/.test(path) && Number.isFinite(actual) && Number.isFinite(retained)) {
    return Math.abs(actual - retained) <= 4 * Number.EPSILON * Math.max(Math.abs(actual), Math.abs(retained));
  }
  if (!actual || !retained || typeof actual !== 'object' || typeof retained !== 'object' ||
      Array.isArray(actual) !== Array.isArray(retained)) return false;
  const left = actual as Record<string, unknown>, right = retained as Record<string, unknown>;
  const keys = Object.keys(left), otherKeys = Object.keys(right);
  return keys.length === otherKeys.length && keys.every((key, i) => key === otherKeys[i] &&
    aircraftReportMatches(left[key], right[key], `${path}.${key}`));
}

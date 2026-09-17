import type { ConstructionEquipment, ConstructionPrimitive } from './blueprint';

/** Objects merge, arrays replace, and null removes an optional field. IDs never change. */
type Patch<T> = { [K in keyof T]?: (NonNullable<T[K]> extends readonly unknown[] ? T[K] : NonNullable<T[K]> extends object ? Patch<NonNullable<T[K]>> : T[K]) | (undefined extends T[K] ? null : never) };
export type PrimitivePatch = Patch<Omit<ConstructionPrimitive, 'id'>>;
export type EquipmentPatch = Patch<Omit<ConstructionEquipment, 'id'>>;
type Fields = { [key: string]: true | Fields };
const primitiveFields: Fields = {
  kind: true, size: true, position: true, rotationDeg: true, vertices: true, smoothGroup: true,
  customHull: { version: true, stations: true, rake: true, bulb: true, redPaintY: true },
  balcony: { version: true, points: true, heightM: true, wallThicknessM: true },
  shaping: { version: true, edges: true, radius: true, style: true },
};
const equipmentFields: Fields = {
  partId: true, position: true, bearingDeg: true, magazineId: true, powerSourceId: true, paint: true,
  gun: { barbetteHeightM: true, barbettePaint: true, battery: true, initialElevationDeg: true, traverseDeg: true, traverseLimitsDeg: true, elevationMinDeg: true, elevationMaxDeg: true },
  wall: { version: true, widthM: true, heightM: true, mirrorId: true },
  path: { points: true, slackM: true }, launcher: { traverseLimitsDeg: true, launchArcsDeg: true },
};
function merge(target: Record<string, unknown>, changes: unknown, fields: Fields) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Patch changes must be an object.');
  for (const [key, value] of Object.entries(changes)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`Unknown patch field: ${key}`);
    if (value === null) { delete target[key]; continue; }
    if (fields[key] === true) target[key] = structuredClone(value);
    else {
      const nested = target[key] && typeof target[key] === 'object' ? structuredClone(target[key]) : {};
      merge(nested as Record<string, unknown>, value, fields[key]);
      target[key] = nested;
    }
  }
}
export function patchPrimitive(part: ConstructionPrimitive, changes: PrimitivePatch): ConstructionPrimitive {
  const next = structuredClone(part); merge(next as unknown as Record<string, unknown>, changes, primitiveFields); return next;
}
export function patchEquipment(part: ConstructionEquipment, changes: EquipmentPatch): ConstructionEquipment {
  const next = structuredClone(part); merge(next as unknown as Record<string, unknown>, changes, equipmentFields); return next;
}

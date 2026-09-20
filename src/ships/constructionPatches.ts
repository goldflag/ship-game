import type { ConstructionEquipment, ConstructionPrimitive } from './blueprint';
import { EQUIPMENT_PATCH, PRIMITIVE_PATCH, type ObjectSpec } from './constructionCommandSchema';

/** Objects merge, arrays replace, and null removes an optional field. IDs never change. */
type Patch<T> = { [K in keyof T]?: (NonNullable<T[K]> extends readonly unknown[] ? T[K] : NonNullable<T[K]> extends object ? Patch<NonNullable<T[K]>> : T[K]) | (undefined extends T[K] ? null : never) };
export type PrimitivePatch = Patch<Omit<ConstructionPrimitive, 'id'>>;
export type EquipmentPatch = Patch<Omit<ConstructionEquipment, 'id'>>;
type Fields = { [key: string]: true | Fields };
/** Derived from the record specs, so a source field added there is patchable at once;
 * `constructionPatches.test.ts` fails when the blueprint types gain a field the specs lack. */
const patchFields = (spec: ObjectSpec): Fields =>
  Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => [key, field.type === 'object' ? patchFields(field) : true]));
export const PRIMITIVE_PATCH_FIELDS = patchFields(PRIMITIVE_PATCH);
export const EQUIPMENT_PATCH_FIELDS = patchFields(EQUIPMENT_PATCH);
function merge(target: Record<string, unknown>, changes: unknown, fields: Fields) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Patch changes must be an object.');
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
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
  const next = structuredClone(part); merge(next as unknown as Record<string, unknown>, changes, PRIMITIVE_PATCH_FIELDS); return next;
}
export function patchEquipment(part: ConstructionEquipment, changes: EquipmentPatch): ConstructionEquipment {
  const next = structuredClone(part); merge(next as unknown as Record<string, unknown>, changes, EQUIPMENT_PATCH_FIELDS); return next;
}

/** Input validators shared by the compileShip sections. Every failure throws `path: message`. */
import type { Vec3 } from './blueprintTypes';

export type Rec = Record<string, unknown>;
export const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
export const record = (value: unknown, path: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(path, 'expected an object');
export const text = (value: unknown, path: string): string =>
  typeof value === 'string' && value.length > 0 && value.length <= 500 ? value : fail(path, 'expected nonempty text (at most 500 characters)');
export const numeric = (value: unknown, path: string, min = -1e9, max = 1e9): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail(path, `expected a finite number in [${min}, ${max}]`);
export const list = (value: unknown, path: string, max = 256): unknown[] =>
  Array.isArray(value) && value.length <= max ? value : fail(path, `expected an array with at most ${max} entries`);
export const literal = (value: unknown, choices: unknown[], path: string) => { if (!choices.includes(value)) fail(path, `expected ${choices.join(' or ')}`); };
export const id = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(result) || ['constructor', 'prototype', '__proto__'].includes(result)) fail(path, 'expected a stable lowercase kebab-case ID');
  return result;
};
export const vector = (value: unknown, path: string, min = -10000): Vec3 => {
  const v = list(value, path, 3);
  if (v.length !== 3) fail(path, 'expected three coordinates');
  return v.map((n, i) => numeric(n, `${path}[${i}]`, min, 10000)) as Vec3;
};
export function unique(values: Record<string, unknown>[], path: string): void {
  const ids = new Set<string>();
  values.forEach((v, i) => { const key = id(v.id, `${path}[${i}].id`); if (ids.has(key)) fail(path, `duplicate ID ${key}`); ids.add(key); });
}
export function volumes(value: unknown, path: string, max = 256): Record<string, unknown>[] {
  const values = list(value, path, max).map((v, i) => record(v, `${path}[${i}]`));
  unique(values, path);
  values.forEach((v, i) => { vector(v.center, `${path}[${i}].center`); vector(v.size, `${path}[${i}].size`, .001); });
  return values;
}

export function validateTriangle(value: unknown, vertices: Vec3[], path: string): void {
  const ids=list(value,path,3).map(i=>numeric(i,path,0,vertices.length-1));
  if (ids.length!==3 || ids.some(i=>!Number.isInteger(i))) fail(path,'expected three vertex indices');
  const [a,b,c]=ids.map(i=>vertices[i]), u=b.map((v,i)=>v-a[i]), v=c.map((n,i)=>n-a[i]);
  if (Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-8) fail(path,'degenerate triangle');
}

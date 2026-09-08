import { Matrix4 } from 'three';

export interface ReferenceNode {
  visual?: string;
  transform?: { matrix?: number[][]; rotation?: number[][] };
  nodes?: Record<string, ReferenceNode> | ReferenceNode[];
}
export type Scheme = Record<string, Record<string, ReferenceNode>>;
export interface ReferencePack {
  vehicle: string;
  name: string;
  url: string;
  fetchedAt: string;
  scheme: Scheme;
  models: Record<string, { geometry: Record<string, { position: number[]; index: number[] }> }>;
  omitted: string[];
}
export function vehicleId(input: string): string {
  const value = input.trim();
  if (/^[a-z0-9]{3,40}$/.test(value)) return value;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'gamemodels3d.com') throw new Error('Use a GameModels3D World of Warships vehicle URL or model ID.');
  const match = url.pathname.match(/^\/(?:en\/)?games\/worldofwarships\/vehicles\/([a-z0-9]{3,40})\/?$/);
  if (!match) throw new Error('Use a World of Warships vehicle page URL.');
  return match[1];
}
export function embeddedJson(text: string, marker: RegExp): any {
  const match = marker.exec(text);
  if (!match) throw new Error('GameModels3D did not expose a model on this page. Check the URL or load a local GLB.');
  const start = match.index + match[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Incomplete model data from GameModels3D. Try loading again.');
}
export function defaultComponents(scheme: Scheme, hull = 'A_Hull'): string[] {
  const groups = new Map<string, string>();
  const prefix = hull.split('_')[0].replace(/\d+$/, '');
  const matching = new RegExp(`^(${prefix}\\d*|AB)_`);
  for (const key of Object.keys(scheme).sort()) {
    if (key.endsWith('_Hull') || !matching.test(key)) continue;
    const group = key.replace(matching, '');
    if (!groups.has(group)) groups.set(group, key);
  }
  return [...groups.values()];
}
const children = (node: ReferenceNode): [string, ReferenceNode][] => Object.entries(node.nodes ?? {});
export function assembleReference(scheme: Scheme, hull: string, components: string[]): ReferenceNode {
  if (!scheme[hull]) throw new Error('Select an available hull configuration.');
  const root: ReferenceNode = { nodes: structuredClone(scheme[hull]) };
  const find = (node: ReferenceNode, key: string): ReferenceNode | undefined => {
    for (const [name, child] of children(node)) { if (name === key) return child; const found = find(child, key); if (found) return found; }
  };
  for (const component of components) {
    if (component.endsWith('_Hull')) continue;
    for (const [name, payload] of Object.entries(scheme[component] ?? {})) {
      const target = find(root, name);
      if (!target) continue;
      for (const [key, value] of Object.entries(payload)) if (key !== 'transform') (target as any)[key] = structuredClone(value);
      if (payload.transform?.rotation) {
        const matrix = new Matrix4();
        if (target.transform?.matrix) matrix.fromArray(target.transform.matrix.flat());
        matrix.multiply(new Matrix4().fromArray(payload.transform.rotation.flat()));
        target.transform = { matrix: Array.from({ length: 4 }, (_, i) => matrix.elements.slice(i * 4, i * 4 + 4)) };
      }
    }
  }
  return root;
}

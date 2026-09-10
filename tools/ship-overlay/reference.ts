import { Matrix4 } from 'three';

export interface ReferenceNode {
  visual?: string;
  transform?: { matrix?: number[][]; rotation?: number[][] };
  nodes?: Record<string, ReferenceNode> | ReferenceNode[];
}
export type Scheme = Record<string, Record<string, ReferenceNode>>;
/** GameModels3D publishes three.js-style phong definitions next to each model; texture paths are relative to its data root. */
export interface ReferenceMaterial { color?: number; specular?: number; shininess?: number; map?: string; specularMap?: string; aoMap?: string; normalMap?: string }
export interface ReferenceGeometry { position: number[]; index: number[]; uv?: number[]; groups?: { start: number; count: number; material: number }[] }
export interface ReferenceModel { geometry: Record<string, ReferenceGeometry>; materials?: Record<string, Record<string, ReferenceMaterial[]>> }
export interface ReferencePack {
  kind?: 'ship' | 'aircraft';
  vehicle: string;
  name: string;
  url: string;
  fetchedAt: string;
  scheme: Scheme;
  /** Paint scheme ID to display name; `default` is the plain source finish. */
  paints: Record<string, string>;
  models: Record<string, ReferenceModel>;
  omitted: string[];
}
export interface AircraftReference { id: string; name: string; category: string; path: string }
/** Read the public aircraft index as JSON, never execute the source page. */
export function aircraftReferences(page: string): AircraftReference[] {
  const misc = embeddedJson(page, /const\s+misc\s*=\s*/);
  const result: AircraftReference[] = [];
  for (const [category, items] of Object.entries(misc)) {
    if (!/^[a-z]+$/.test(category) || !items || typeof items !== 'object') continue;
    for (const [id, item] of Object.entries(items)) {
      if (!/^p[a-z]a[a-z]\d{3}$/.test(id) || !item || typeof item !== 'object') continue;
      const { name, scheme } = item as { name?: unknown; scheme?: unknown };
      if (typeof name !== 'string' || typeof scheme !== 'string' || !/^common\/visual\/[a-zA-Z0-9_/-]+$/.test(scheme)) continue;
      result.push({ id, name, category, path: scheme });
    }
  }
  if (!result.length) throw new Error('GameModels3D exposed no supported aircraft. Load a local GLB instead.');
  return result;
}
export function aircraftScheme(aircraft: AircraftReference): Scheme {
  // Match the source viewer's X reflection; loadGame applies the shared Z conversion.
  return { HullDefault: { aircraft: { visual: aircraft.path, transform: { matrix: [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] } } } };
}
/** World of Warships vehicles on GameModels3D that match roster presets. Presets without a WoWS counterpart have no suggestion. */
export const suggestedVehicles: Record<string, string> = {
  bismarck: 'pgsb708', yamato: 'pjsb018', iowa: 'pasb018', 'king-george-v': 'pbsb107',
  baltimore: 'pasc108', mogami: 'pjsc009', 'enterprise-cv6': 'pasa518', shokaku: 'pjsa108',
  'type-viic': 'pgss206', fletcher: 'pasd021', yukikaze: 'pjsd718', fubuki: 'pjsd106',
  'liberty-cargo': 'pasx003', 'liberty-collier': 'pasx003',
};
export const vehicleUrl = (id: string) => `https://gamemodels3d.com/en/games/worldofwarships/vehicles/${id}`;
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
export const isHullConfiguration = (key: string): boolean => /^[A-Z]+\d*_Hull(?:_\d{4})?$/.test(key) || key === 'HullDefault';
export const texturePath = (path: unknown): path is string => typeof path === 'string' && /^[a-zA-Z0-9_./-]+\.(?:jpg|jpeg|png)$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');

/** Keeps only recognised phong fields with safe texture paths, for the paints a vehicle actually offers. */
export function sanitizeMaterials(raw: unknown, paints: Iterable<string>): Record<string, ReferenceMaterial[]> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const result: Record<string, ReferenceMaterial[]> = {};
  for (const paint of new Set(['default', ...paints])) {
    const list = (raw as Record<string, unknown>)[paint];
    if (!Array.isArray(list) || !list.length) continue;
    result[paint] = list.map(entry => {
      const m: ReferenceMaterial = {};
      if (!entry || typeof entry !== 'object') return m;
      for (const key of ['color', 'specular', 'shininess'] as const) { const v = (entry as any)[key]; if (Number.isFinite(v)) m[key] = v; }
      for (const key of ['map', 'specularMap', 'aoMap', 'normalMap'] as const) { const v = (entry as any)[key]; if (texturePath(v)) m[key] = v; }
      return m;
    });
  }
  return Object.keys(result).length ? result : undefined;
}
/** Material list for a paint, falling back to the plain finish. */
export const paintMaterials = (model: ReferenceModel, geometryKey: string, paint: string): ReferenceMaterial[] | undefined => {
  const byPaint = model.materials?.[geometryKey] ?? model.materials?.[''];
  return byPaint?.[paint] ?? byPaint?.default;
};

/** Validated draw groups; invalid or absent groups draw the whole geometry with one material. */
export function geometryGroups(geometry: ReferenceGeometry): { start: number; count: number; material: number }[] {
  const groups = geometry.groups;
  if (!Array.isArray(groups) || !groups.length) return [];
  const valid = groups.every(g => g && Number.isInteger(g.start) && Number.isInteger(g.count) && Number.isInteger(g.material) && g.start >= 0 && g.count >= 0 && g.material >= 0 && g.material < 64 && g.start + g.count <= geometry.index.length);
  return valid ? groups.map(g => ({ start: g.start, count: g.count, material: g.material })) : [];
}
export function defaultComponents(scheme: Scheme, hull = 'A_Hull'): string[] {
  const groups = new Map<string, string>();
  const prefix = hull.split('_')[0].replace(/\d+$/, '');
  const matching = new RegExp(`^(${prefix}\\d*|AB\\d*)_`);
  for (const key of Object.keys(scheme).sort()) {
    if (isHullConfiguration(key)) continue;
    if (key.endsWith('Default')) { groups.set(key, key); continue; }
    if (!matching.test(key)) continue;
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
    if (isHullConfiguration(component)) continue;
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

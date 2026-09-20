/** Rule-file armor scheme generation behind `ship:armor`.
 *
 * A scheme is written the way a protection table is written — a belt from this frame to that one, a
 * deck over the magazines — and turned into `surface-patch` commands. Nothing here decides whether
 * the plating is sensible; the native compiler still judges mass, coverage and fit. */
import type { ConstructionPrimitive, ConstructionSource } from '../../src/ships/blueprint';
import type { ConstructionCommand } from '../../src/ships/constructionCommands';
import { FACES } from '../../src/ships/constructionCommandSchema';
import { contourAt, hullEdgeFace, hullEdgeId } from '../../src/ships/customHullTopology';

export type Face = (typeof FACES)[number];
export interface ArmorRule {
  /** Reported back with the rule's targets; defaults to its index. */
  name?: string;
  primitives?: string[];
  primitivePrefix?: string;
  faces?: Face[];
  panels?: string[];
  /** Inclusive ship-metre window a target must lie within; an unbounded end is omitted. */
  z?: [number | null, number | null];
  y?: [number | null, number | null];
  changes: { thicknessMm?: number; material?: 'steel' | 'armor-steel'; paint?: string; open?: boolean };
  /** Default true: the same rule reaches the opposite panel or side. */
  mirror?: boolean;
}
export interface ArmorTarget {
  primitiveId: string;
  face: Face;
  panelId?: string;
  /** Extent of this target in ship metres, for the report and for the range filters. */
  z: [number, number];
  y: [number, number];
}
export interface RuleReport {
  rule: number;
  name: string;
  targets: ArmorTarget[];
  /** Why a rule that named something explicitly matched nothing of it. */
  unmatched?: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const range = (value: unknown, where: string): [number | null, number | null] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(where + ' is [min, max] in ship metres; use null for an open end.');
  return value.map((entry, index) => {
    if (entry === null) return null;
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error(where + '[' + index + '] must be a number or null.');
    return entry;
  }) as [number | null, number | null];
};
const strings = (value: unknown, where: string) => {
  if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== 'string' || !entry))
    throw new Error(where + ' must be a non-empty array of strings.');
  return value as string[];
};
export const MAX_RULES = 64;

/** A bare array of rules, or `{version: 1, rules: [...]}`. Everything is checked before anything is generated. */
export function parseArmorRules(document: unknown): ArmorRule[] {
  const rules = Array.isArray(document) ? document : isObject(document) && Array.isArray(document.rules) ? document.rules : undefined;
  if (!rules) throw new Error('An armor scheme is a JSON array of rules, or an object with a `rules` array.');
  if (!rules.length) throw new Error('The armor scheme is empty.');
  if (rules.length > MAX_RULES)
    throw new Error('An armor scheme holds at most ' + MAX_RULES + ' rules; this one has ' + rules.length + '.');
  return rules.map((entry, index) => {
    const where = 'Rule ' + index;
    if (!isObject(entry)) throw new Error(where + ' must be an object.');
    const known = new Set(['name', 'primitives', 'primitivePrefix', 'faces', 'panels', 'z', 'y', 'changes', 'mirror']);
    const unknown = Object.keys(entry).filter((key) => !known.has(key));
    if (unknown.length) throw new Error(where + ' has unknown field ' + unknown.join(', ') + '. Accepted: ' + [...known].join(', ') + '.');
    if (!isObject(entry.changes)) throw new Error(where + ' needs a `changes` object: thicknessMm, material, paint or open.');
    const changes = entry.changes as ArmorRule['changes'];
    const fields = new Set(['thicknessMm', 'material', 'paint', 'open']);
    const strange = Object.keys(changes).filter((key) => !fields.has(key));
    if (strange.length)
      throw new Error(where + ' `changes` has unknown field ' + strange.join(', ') + '. Accepted: ' + [...fields].join(', ') + '.');
    if (!Object.keys(changes).length)
      throw new Error(where + ' `changes` is empty; a rule that changes nothing would only hide the ones that do.');
    if (changes.thicknessMm !== undefined && (typeof changes.thicknessMm !== 'number' || !(changes.thicknessMm >= 0)))
      throw new Error(where + ' `changes.thicknessMm` must be a non-negative number.');
    if (changes.material !== undefined && changes.material !== 'steel' && changes.material !== 'armor-steel')
      throw new Error(where + ' `changes.material` is steel or armor-steel.');
    if (entry.faces !== undefined)
      for (const face of strings(entry.faces, where + ' `faces`'))
        if (!(FACES as readonly string[]).includes(face))
          throw new Error(where + ' has unknown face ' + face + '. Accepted: ' + FACES.join(', ') + '.');
    return {
      ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      ...(entry.primitives === undefined ? {} : { primitives: strings(entry.primitives, where + ' `primitives`') }),
      ...(entry.primitivePrefix === undefined ? {} : { primitivePrefix: String(entry.primitivePrefix) }),
      ...(entry.faces === undefined ? {} : { faces: entry.faces as Face[] }),
      ...(entry.panels === undefined ? {} : { panels: strings(entry.panels, where + ' `panels`') }),
      ...(entry.z === undefined ? {} : { z: range(entry.z, where + ' `z`') }),
      ...(entry.y === undefined ? {} : { y: range(entry.y, where + ' `y`') }),
      changes,
      ...(entry.mirror === undefined ? {} : { mirror: entry.mirror === true }),
    } satisfies ArmorRule;
  });
}

/** Every face a rule could name, with the box it occupies in ship metres.
 * Yawed or tilted pieces are reported by their envelope, which is the extent a range filter can honestly use. */
export function primitiveTargets(primitive: ConstructionPrimitive): ArmorTarget[] {
  const [, , length] = primitive.size,
    [, cy, cz] = primitive.position;
  const half = (axis: 0 | 1 | 2) => Math.abs(primitive.size[axis]) / 2;
  const envelope = { z: [cz - half(2), cz + half(2)] as [number, number], y: [cy - half(1), cy + half(1)] as [number, number] };
  const stations = primitive.kind === 'custom-hull' ? primitive.customHull?.stations : undefined;
  if (!stations)
    return FACES.filter((face) => face !== 'slope' || primitive.kind !== 'box').map((face) => ({
      primitiveId: primitive.id,
      face,
      ...envelope,
    }));
  const zAt = (t: number) => cz + (t - 0.5) * length;
  const yAt = (point: { y: number }) => cy + point.y * Math.abs(primitive.size[1]);
  // The same enumeration order and IDs as `customHullPanels`, with the geometry each panel spans.
  // `armor.test.ts` pins the IDs against that function so the two cannot drift apart.
  const strips = stations.slice(0, -1).flatMap((station, index) =>
    station.points.map((_, edge): ArmorTarget => {
      const next = stations[index + 1];
      const start = contourAt(station.points, edge),
        end = edge === station.points.length - 1 ? 9 : contourAt(station.points, edge + 1);
      const corners = [
        station.points[edge],
        station.points[Math.min(edge + 1, station.points.length - 1)],
        next.points[edge],
        next.points[Math.min(edge + 1, next.points.length - 1)],
      ];
      const ys = corners.map(yAt);
      return {
        primitiveId: primitive.id,
        face: hullEdgeFace(start, end) as Face,
        panelId: `${hullEdgeId(start, end)}@${JSON.stringify([station.id, next.id])}`,
        z: [Math.min(zAt(station.t), zAt(next.t)), Math.max(zAt(station.t), zAt(next.t))],
        y: [Math.min(...ys), Math.max(...ys)],
      };
    }),
  );
  return [
    ...strips,
    { primitiveId: primitive.id, face: 'bow' as Face, panelId: 'bow', ...envelope },
    { primitiveId: primitive.id, face: 'stern' as Face, panelId: 'stern', ...envelope },
  ];
}

const within = (extent: [number, number], window?: [number | null, number | null]) =>
  !window || ((window[0] === null || extent[0] >= window[0] - 1e-6) && (window[1] === null || extent[1] <= window[1] + 1e-6));

/** Rules are read in order; a later rule that names the same face wins, exactly as the file reads. */
export function applyArmorRules(
  source: ConstructionSource,
  rules: ArmorRule[],
): { reports: RuleReport[]; commands: ConstructionCommand[] } {
  const all = new Map(source.construction.primitives.map((primitive) => [primitive.id, primitiveTargets(primitive)]));
  const reports = rules.map((rule, index): RuleReport => {
    const unmatched: string[] = [];
    const chosen = rule.primitives
      ? rule.primitives.filter((id) => {
          if (all.has(id)) return true;
          unmatched.push('primitive ' + id);
          return false;
        })
      : [...all.keys()].filter((id) => !rule.primitivePrefix || id.startsWith(rule.primitivePrefix));
    const faces = rule.faces && new Set<string>(rule.faces);
    const panels = rule.panels && new Set(rule.panels);
    const targets = chosen
      .flatMap((id) => all.get(id)!)
      .filter(
        (target) =>
          (!faces || faces.has(target.face)) &&
          (!panels || (target.panelId !== undefined && panels.has(target.panelId))) &&
          within(target.z, rule.z) &&
          within(target.y, rule.y),
      );
    if (panels) for (const panelId of panels) if (!targets.some((target) => target.panelId === panelId)) unmatched.push('panel ' + panelId);
    if (rule.primitivePrefix && !chosen.length) unmatched.push('primitive prefix ' + rule.primitivePrefix);
    return { rule: index, name: rule.name ?? 'rule ' + index, targets, ...(unmatched.length ? { unmatched } : {}) };
  });
  // One command per rule keeps the batch readable and keeps the file's own precedence.
  const commands = reports
    .filter((report) => report.targets.length)
    .map((report) => ({
      op: 'surface-patch' as const,
      targets: report.targets.map((target) => ({
        primitiveId: target.primitiveId,
        face: target.face,
        ...(target.panelId === undefined ? {} : { panelId: target.panelId }),
      })),
      changes: rules[report.rule].changes,
      mirror: rules[report.rule].mirror ?? true,
    }));
  return { reports, commands };
}

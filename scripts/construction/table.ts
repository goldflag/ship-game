import type { ConstructionCatalog, ConstructionEquipment, ConstructionSource } from '../../src/ships/blueprint';
import type { ConstructionCommand } from '../../src/ships/constructionCommands';
import { placementItems, type Placement, type PlacementItem } from '../../src/ships/constructionPlacement';
import { effectiveConstructionCatalog } from '../../src/ships/constructionCustomFittings';
import { equipmentBounds, type Aabb } from '../../src/ships/constructionQuery';

/** One line of a batch placement table. `x`/`z` are the datum in ship metres, `y` a support-level hint. */
export interface PlacementRow {
  id?: string;
  part: string;
  x: number;
  z: number;
  bearing?: number;
  y?: number;
  on?: string;
  mirror?: boolean;
  repeat?: number;
  step?: [number, number];
  /** Merged into every equipment record this row produces: gun battery and arcs, launcher settings, paint. */
  extra?: Record<string, unknown>;
}
/** Fields the seat resolver owns. A table may not overwrite them through `extra`. */
const RESERVED = ['id', 'partId', 'position', 'bearingDeg'] as const;
export const MAX_TABLE_ROWS = 128;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown, where: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(where + ' must be a finite number.');
  return value;
};

/** A bare array of rows, or `{version: 1, rows: [...]}`. Every field is checked before anything is placed. */
export function parsePlacementTable(document: unknown): PlacementRow[] {
  const rows = Array.isArray(document) ? document : isObject(document) && Array.isArray(document.rows) ? document.rows : undefined;
  if (!rows) throw new Error('A placement table is a JSON array of rows, or an object with a `rows` array.');
  if (!rows.length) throw new Error('The placement table is empty.');
  if (rows.length > MAX_TABLE_ROWS) throw new Error('A placement table holds at most ' + MAX_TABLE_ROWS + ' rows; this one has ' + rows.length + '.');
  return rows.map((entry, index) => {
    const where = 'Row ' + index;
    if (!isObject(entry)) throw new Error(where + ' must be an object.');
    const known = new Set(['id', 'part', 'x', 'z', 'bearing', 'y', 'on', 'mirror', 'repeat', 'step', 'extra']);
    const unknown = Object.keys(entry).filter((key) => !known.has(key));
    if (unknown.length) throw new Error(where + ' has unknown field ' + unknown.join(', ') + '. Accepted: ' + [...known].join(', ') + '.');
    if (typeof entry.part !== 'string' || !entry.part) throw new Error(where + ' needs a catalog part ID in `part`.');
    if (entry.id !== undefined && (typeof entry.id !== 'string' || !entry.id)) throw new Error(where + ' has a non-string `id`.');
    if (entry.on !== undefined && typeof entry.on !== 'string') throw new Error(where + ' has a non-string `on`.');
    if (entry.mirror !== undefined && typeof entry.mirror !== 'boolean') throw new Error(where + ' has a non-boolean `mirror`.');
    if (entry.step !== undefined && (!Array.isArray(entry.step) || entry.step.length !== 2)) throw new Error(where + ' `step` is [dx, dz] in metres.');
    const extra = entry.extra;
    if (extra !== undefined) {
      if (!isObject(extra)) throw new Error(where + ' `extra` must be an object merged into the equipment record.');
      const taken = RESERVED.filter((field) => field in extra);
      if (taken.length) throw new Error(where + ' `extra` may not set ' + taken.join(', ') + '; the seat resolver owns those fields.');
    }
    return {
      ...(entry.id === undefined ? {} : { id: entry.id }),
      part: entry.part,
      x: number(entry.x, where + ' `x`'),
      z: number(entry.z, where + ' `z`'),
      ...(entry.bearing === undefined ? {} : { bearing: number(entry.bearing, where + ' `bearing`') }),
      ...(entry.y === undefined ? {} : { y: number(entry.y, where + ' `y`') }),
      ...(entry.on === undefined ? {} : { on: entry.on }),
      ...(entry.mirror === undefined ? {} : { mirror: entry.mirror }),
      ...(entry.repeat === undefined ? {} : { repeat: number(entry.repeat, where + ' `repeat`') }),
      ...(entry.step === undefined ? {} : { step: [number(entry.step[0], where + ' `step[0]`'), number(entry.step[1], where + ' `step[1]`')] as [number, number] }),
      ...(extra === undefined ? {} : { extra: extra as Record<string, unknown> }),
    } satisfies PlacementRow;
  });
}

export interface RowPlan {
  row: number;
  request: PlacementRow;
  /** Records this row asks for, already given unique IDs against the rows before it. */
  items: PlacementItem[];
  /** Why the row produced no records at all: an unknown part, a taken ID, a limit. */
  error?: string;
}
/** Plans every row against one source, so IDs and the equipment limit account for the rows before it.
 * A row that cannot even be expressed is recorded and the rest continue. */
export function planPlacementTable(source: ConstructionSource, catalog: ConstructionCatalog, rows: PlacementRow[]): { plans: RowPlan[]; items: PlacementItem[] } {
  const pending: ConstructionEquipment[] = [];
  const plans = rows.map((request, row): RowPlan => {
    // The shadow source carries the earlier rows' records: unique IDs and the 128-record limit stay honest.
    const shadow = { ...source, construction: { ...source.construction, equipment: [...source.construction.equipment, ...pending] } };
    try {
      const items = placementItems(shadow, catalog, {
        partId: request.part,
        at: [request.x, request.z],
        y: request.y,
        on: request.on,
        bearingDeg: request.bearing,
        id: request.id,
        mirror: request.mirror,
        repeat: request.repeat,
        step: request.step,
      });
      pending.push(...items.map((item) => item.equipment));
      return { row, request, items };
    } catch (error) {
      return { row, request, items: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { plans, items: plans.flatMap((plan) => plan.items) };
}

/** `extra` is merged last, so a row can carry gun batteries, launcher arcs or paint the solver never sets. */
export function tableCommands(plans: RowPlan[], placements: Placement[]): ConstructionCommand[] {
  const commands: ConstructionCommand[] = [];
  for (const plan of plans) {
    if (!seatedRow(plan, placements)) continue;
    for (const item of plan.items) {
      const placement = placements.find((p) => p.id === item.equipment.id)!;
      commands.push({
        op: 'equipment',
        value: { ...structuredClone(item.equipment), position: placement.position, bearingDeg: placement.bearingDeg, ...(plan.request.extra ?? {}) } as ConstructionEquipment,
      });
    }
  }
  return commands;
}

const seatedRow = (plan: RowPlan, placements: Placement[]) =>
  !plan.error &&
  plan.items.length > 0 &&
  plan.items.every((item) => {
    const placement = placements.find((p) => p.id === item.equipment.id);
    return !!placement && placement.status !== 'unsupported';
  });

export interface RowReport {
  row: number;
  part: string;
  ids: string[];
  status: 'placed' | 'unsupported' | 'rejected';
  position?: [number, number, number];
  bearingDeg?: number;
  residualM?: number;
  support?: { id?: string; face?: string; point: [number, number, number] };
  errors: { code: string; message: string; sourceId?: string }[];
}
/** One line per table row: where it landed, on what, and every diagnostic that names it. */
export function tableReport(plans: RowPlan[], placements: Placement[], diagnostics: { severity: string; code: string; message: string; sourceId?: string; relatedSourceIds?: string[] }[]): RowReport[] {
  return plans.map((plan) => {
    const ids = plan.items.map((item) => item.equipment.id);
    const own = new Set(ids);
    const first = placements.find((p) => p.id === ids[0]);
    const errors = diagnostics
      .filter((d) => d.severity === 'error' && ((d.sourceId && own.has(d.sourceId)) || d.relatedSourceIds?.some((id) => own.has(id))))
      .map((d) => ({ code: d.code, message: d.message, ...(d.sourceId ? { sourceId: d.sourceId } : {}) }));
    if (plan.error) return { row: plan.row, part: plan.request.part, ids, status: 'rejected', errors: [{ code: 'placement-request', message: plan.error }] };
    const placed = seatedRow(plan, placements);
    return {
      row: plan.row,
      part: plan.request.part,
      ids,
      status: placed ? 'placed' : 'unsupported',
      ...(first?.position ? { position: first.position, bearingDeg: first.bearingDeg } : {}),
      ...(first?.residualM ? { residualM: first.residualM } : {}),
      ...(first?.support ? { support: { id: first.support.primitiveId ?? first.support.id, face: first.support.face, point: first.support.point } } : {}),
      errors: placed
        ? errors
        : [
            ...errors,
            ...(errors.length ? [] : [{ code: 'placement-support', message: first?.message ?? 'No support was found along the attachment direction.' }]),
          ],
    };
  });
}

export interface RowConflict {
  rows: [number, number];
  ids: [string, string];
  /** Per-axis overlap depth in metres; every component is positive. */
  overlapM: [number, number, number];
  approximate: true;
}
const overlap = (a: Aabb, b: Aabb): [number, number, number] | undefined => {
  const depth = [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
  return depth.every((value) => value > 1e-6) ? (depth.map((value) => Number(value.toFixed(3))) as [number, number, number]) : undefined;
};
/** Rows that are each seated but claim the same space. Source-level boxes including working spaces:
 * conservative and approximate, so this names candidates the compiler may stop before reaching. */
export function tableConflicts(source: ConstructionSource, catalog: ConstructionCatalog, plans: RowPlan[], placements: Placement[]): RowConflict[] {
  const parts = effectiveConstructionCatalog(source.construction, catalog).equipment;
  const boxes: { row: number; id: string; box: Aabb }[] = [];
  for (const plan of plans) {
    if (!seatedRow(plan, placements)) continue;
    for (const item of plan.items) {
      const placement = placements.find((p) => p.id === item.equipment.id)!;
      const record = { ...item.equipment, position: placement.position, bearingDeg: placement.bearingDeg };
      const bounds = equipmentBounds(record, parts.find((p) => p.id === record.partId));
      const box = bounds.occupancy
        ? { min: [0, 1, 2].map((k) => Math.min(bounds.min[k], bounds.occupancy!.min[k])), max: [0, 1, 2].map((k) => Math.max(bounds.max[k], bounds.occupancy!.max[k])) }
        : bounds;
      boxes.push({ row: plan.row, id: record.id, box: box as Aabb });
    }
  }
  const conflicts: RowConflict[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].row === boxes[j].row) continue;
      const depth = overlap(boxes[i].box, boxes[j].box);
      if (depth) conflicts.push({ rows: [boxes[i].row, boxes[j].row], ids: [boxes[i].id, boxes[j].id], overlapM: depth, approximate: true });
    }
  return conflicts;
}

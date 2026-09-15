import type { ConstructionDiagnostic, ConstructionResult, ConstructionSource, ConstructionSurface } from '../../ships/blueprint';
import { CONSTRUCTION_LIMITS, editableConstructionSurfaces } from '../../ships/constructionEditor';
import type { BuilderLayer } from './builderLayers';

/** Ledger and warnings-line content derived from the native compile result. */
export type Tone = 'ok' | 'warn' | 'bad';
export interface LedgerRow { label: string; value: string; tone?: Tone }
export interface MassGroup { name: string; massKg: number; color: string }
export interface WarningEntry { tone: 'block' | 'warn' | 'note'; message: string; sourceId?: string; code: string }

export const format = (value: number | undefined, digits = 1) => value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
export const MPS_TO_KNOTS = 1.943844;

export function hullBounds(source: ConstructionSource): { min: [number, number, number]; max: [number, number, number] } | undefined {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const primitive of source.construction.primitives) {
    const radians = primitive.rotationDeg * Math.PI / 180, cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
    const half = [(primitive.size[0] * cos + primitive.size[2] * sin) / 2, primitive.size[1] / 2, (primitive.size[0] * sin + primitive.size[2] * cos) / 2];
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], primitive.position[axis] - half[axis]); max[axis] = Math.max(max[axis], primitive.position[axis] + half[axis]); }
  }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}

export function warningEntries(diagnostics: readonly ConstructionDiagnostic[] | undefined): WarningEntry[] {
  const order = { block: 0, warn: 1, note: 2 };
  return (diagnostics ?? []).map((diagnostic): WarningEntry => ({
    tone: diagnostic.severity === 'error' ? 'block' : diagnostic.code === 'auxiliary-services' ? 'note' : 'warn',
    message: diagnostic.message, sourceId: diagnostic.sourceId, code: diagnostic.code,
  })).sort((a, b) => order[a.tone] - order[b.tone]);
}

const TONE_BY_CODE: Record<string, { label: string; tone: Tone }[]> = {
  unstable: [{ label: 'GM', tone: 'warn' }], overloaded: [{ label: 'Displacement', tone: 'bad' }, { label: 'Draft', tone: 'bad' }],
  unpowered: [{ label: 'Power', tone: 'warn' }, { label: 'Speed', tone: 'warn' }], 'propulsor-exposure': [{ label: 'Speed', tone: 'warn' }],
};

/** Hull dimensions from the source, the native readings, and a layer-specific last row. */
export function ledgerRows(source: ConstructionSource, result: ConstructionResult | undefined, layer: BuilderLayer): LedgerRow[] {
  const loading = result?.loading, bounds = hullBounds(source), data = source.construction;
  const tones = new Map<string, Tone>();
  for (const diagnostic of result?.diagnostics ?? []) for (const entry of TONE_BY_CODE[diagnostic.code] ?? []) tones.set(entry.label, entry.tone);
  const row = (label: string, value: string, tone?: Tone): LedgerRow => ({ label, value, tone: tone ?? tones.get(label) });
  const extent = (axis: number) => bounds ? `${format(bounds.max[axis] - bounds.min[axis])} m` : '—';
  const rows = [
    row('Length', extent(2)),
    row('Beam', extent(0)),
    row('Height', extent(1)),
    row('Displacement', loading ? `${format(loading.massKg / 1000, loading.massKg < 1e6 ? 1 : 0)} t` : '—'),
    row('Draft', loading && bounds ? `${format(loading.waterlineY - bounds.min[1], 2)} m` : '—'),
    row('GM', loading ? `${format(loading.rollMetacentricHeightM, 2)} m` : '—'),
    row('Power', loading ? `${format(loading.powerKw, 0)} kW` : '—'),
    row('Speed', loading ? `${format(loading.estimatedSpeedMps * MPS_TO_KNOTS)} kn` : '—'),
    row('Usable space', loading ? `${format(loading.usableVolumeM3, 0)} m³` : '—'),
    row('CG x · y · z', loading ? loading.centerOfGravity.map(value => format(value, 1)).join(' · ') : '—'),
  ];
  const surfaces = editableConstructionSurfaces(source, result?.surfaces ?? []);
  switch (layer) {
    case 'hull': rows.push(row('Hull pieces', `${data.primitives.length.toLocaleString()} / ${CONSTRUCTION_LIMITS.primitives.toLocaleString()}`, data.primitives.length > CONSTRUCTION_LIMITS.primitives * .95 ? 'warn' : undefined)); break;
    case 'armor': {
      const total = surfaces.reduce((sum, surface) => sum + surface.areaM2, 0);
      const armored = surfaces.filter(surface => !surface.open && surface.thicknessMm > 0).reduce((sum, surface) => sum + surface.areaM2, 0);
      rows.push(row('Coverage', total ? `${format(armored / total * 100, 0)} % of ${format(total, 0)} m²` : '—'));
      break;
    }
    case 'internals': {
      const rooms = result?.definition?.compartments.length;
      rows.push(row('Rooms', rooms === undefined ? '—' : `${rooms} · ${data.boundaries.length} walls`, data.boundaries.length >= CONSTRUCTION_LIMITS.boundaries ? 'warn' : undefined));
      break;
    }
    case 'fittings': {
      const mounts = result?.definition?.mounts.length ?? 0, tubes = result?.definition?.torpedoTubes?.length ?? 0;
      rows.push(row('Fittings', `${data.equipment.length} / ${CONSTRUCTION_LIMITS.equipment} · ${mounts} guns · ${tubes} tubes`, data.equipment.length > CONSTRUCTION_LIMITS.equipment * .95 ? 'warn' : undefined));
      break;
    }
    case 'paint': {
      const painted = new Set(surfaces.map(surface => surface.paint));
      rows.push(row('Finishes', painted.size ? `${painted.size} paint${painted.size === 1 ? '' : 's'}` : '—'));
    }
  }
  return rows;
}

/** One bar: hull skin, armor plating, walls, machinery and fittings, stores. */
export function massGroups(result: ConstructionResult | undefined): MassGroup[] {
  const groups: MassGroup[] = [
    { name: 'Hull steel', massKg: 0, color: '#9aa8b0' }, { name: 'Armor', massKg: 0, color: '#e8c56c' }, { name: 'Walls', massKg: 0, color: '#c6cfd3' },
    { name: 'Machinery & fittings', massKg: 0, color: '#86e4c5' }, { name: 'Stores & ammunition', massKg: 0, color: '#ffb5a6' },
  ];
  const surfaces = result?.surfaces ?? [];
  for (const item of result?.loading?.contributions ?? []) {
    if (item.kind === 'skin') {
      const index = Number(item.id.slice(item.id.lastIndexOf('-') + 1)), surface: ConstructionSurface | undefined = surfaces[index];
      groups[surface && surface.material === 'armor-steel' ? 1 : 0].massKg += item.massKg;
    } else if (item.kind === 'bulkhead' || item.kind === 'plating') groups[2].massKg += item.massKg;
    else if (item.kind === 'equipment' || item.kind === 'installation' || item.kind === 'support') groups[3].massKg += item.massKg;
    else groups[4].massKg += item.massKg;
  }
  return groups;
}

/** Skin mass attributed to one hull piece, for its object tag. */
export function pieceMassKg(result: ConstructionResult | undefined, primitiveId: string): number | undefined {
  if (!result?.loading) return undefined;
  const surfaces = result.surfaces;
  let mass = 0, found = false;
  for (const item of result.loading.contributions) {
    if (item.kind !== 'skin') continue;
    const surface = surfaces[Number(item.id.slice(item.id.lastIndexOf('-') + 1))];
    if (surface?.primitiveId === primitiveId) { mass += item.massKg; found = true; }
  }
  return found ? mass : undefined;
}
export function equipmentMassKg(result: ConstructionResult | undefined, equipmentId: string): number | undefined {
  const items = result?.loading?.contributions.filter(item => item.id === equipmentId || item.id === `${equipmentId}-service` || item.id === `${equipmentId}-installation`);
  return items?.length ? items.reduce((sum, item) => sum + item.massKg, 0) : undefined;
}

export const surfaceCentroid = (surface: ConstructionSurface): [number, number, number] => {
  const sum = surface.vertices.reduce((total, vertex) => [total[0] + vertex[0], total[1] + vertex[1], total[2] + vertex[2]], [0, 0, 0]);
  return sum.map(value => value / Math.max(1, surface.vertices.length)) as [number, number, number];
};

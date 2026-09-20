import { envelopeVertices } from '../../ships/freeformShape';
import { CUSTOM_FITTING_LIMITS, equipmentCounts } from '../../ships/constructionCustomFittings';
import { worldVertex } from '../../ships/constructionVertex';
import type { ConstructionDiagnostic, ConstructionResult, ConstructionSource, ConstructionSurface } from '../../ships/blueprint';
import { CONSTRUCTION_LIMITS, editableConstructionSurfaces } from '../../ships/constructionEditor';
import type { BuilderLayer } from './builderLayers';

/** Ledger and checks content derived from the native compile result. */
export type Tone = 'ok' | 'warn' | 'bad';
export interface LedgerRow { label: string; value: string; tone?: Tone; help?: string }
export interface MassGroup { name: string; massKg: number; color: string }
export interface WarningEntry { tone: 'block' | 'warn' | 'note'; message: string; sourceId?: string; code: string }

export const format = (value: number | undefined, digits = 1) => value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
export const MPS_TO_KNOTS = 1.943844;

export function hullBounds(source: ConstructionSource): { min: [number, number, number]; max: [number, number, number] } | undefined {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const primitive of source.construction.primitives) {
    for (const v of envelopeVertices(primitive)) worldVertex(primitive,v).forEach((n,k)=>{ min[k]=Math.min(min[k],n);max[k]=Math.max(max[k],n); });
  }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}

export function warningEntries(diagnostics: readonly ConstructionDiagnostic[] | undefined): WarningEntry[] {
  const order = { block: 0, warn: 1, note: 2 };
  return (diagnostics ?? []).filter(diagnostic => diagnostic.code !== 'auxiliary-services').map((diagnostic): WarningEntry => ({
    tone: diagnostic.severity === 'error' ? 'block' : 'warn',
    message: diagnostic.message, sourceId: diagnostic.sourceId, code: diagnostic.code,
  })).sort((a, b) => order[a.tone] - order[b.tone]);
}

/** The checks chip in the top bar: the counts that matter, or the all-clear. */
export function checksSummary(entries: readonly WarningEntry[]): { label: string; tone: 'block' | 'warn' | 'ok' } {
  const blocks = entries.filter(entry => entry.tone === 'block').length, warns = entries.filter(entry => entry.tone === 'warn').length;
  const count = (n: number, noun: string) => n ? [`${n} ${noun}${n === 1 ? '' : 's'}`] : [];
  return { label: [...count(blocks, 'block'), ...count(warns, 'warning')].join(' · ') || 'No warnings', tone: blocks ? 'block' : warns ? 'warn' : 'ok' };
}
/** A diagnostic reads as its finding, then the advice: the first sentence leads and the rest follows in a quieter tone. */
export function splitDiagnostic(message: string): [lead: string, advice: string] {
  const end = message.indexOf('. ');
  return end < 0 ? [message, ''] : [message.slice(0, end + 1), message.slice(end + 2)];
}

const ENGINES = 'Engines', POWER = 'Power at screws', SPEED = 'Calm-water speed';
/** Mirrors the native compiler: 2% of rated power runs auxiliaries before exhaust limits and propeller losses. */
const AUXILIARY_POWER_SHARE = .02;

/** Installed engine rating, then the share that reaches the water and why. */
export function propulsionRows(result: ConstructionResult | undefined): LedgerRow[] {
  const loading = result?.loading, pool = result?.definition?.propulsion?.sharedExhaust;
  const rated = pool?.engines.reduce((sum, engine) => sum + engine.kw, 0) ?? 0, exhaust = pool?.funnels.reduce((sum, funnel) => sum + funnel.kw, 0) ?? 0;
  const supply = rated > 0 ? Math.min(1, exhaust / rated) : 0, net = rated * Math.max(0, supply - AUXILIARY_POWER_SHARE);
  const steps = [`${format(rated, 0)} kW rated`, supply < 1 ? `× ${format(supply * 100, 0)} % funnel capacity (${format(exhaust, 0)} kW)` : undefined, `less ${AUXILIARY_POWER_SHARE * 100} % for auxiliaries`,
    loading && net > 0 ? `× ${format(loading.powerKw / net * 100, 0)} % propeller efficiency` : undefined].filter(Boolean);
  return [
    { label: ENGINES, value: loading ? `${format(rated, 0)} kW` : '—', help: 'Total catalog rating of the fitted engines.' },
    { label: POWER, value: loading ? `${format(loading.powerKw, 0)} kW` : '—',
      help: rated > 0 ? `Power that drives the ship: ${steps.join(', ')}. Engines without a funnel or propeller supply nothing.` : 'No engine supplies power.' },
    { label: SPEED, value: loading ? `${format(loading.estimatedSpeedMps * MPS_TO_KNOTS)} kn` : '—',
      help: 'Top speed in flat water. Waves add drag in battle, most when heading into them: a moderate sea costs roughly 10–15 %. Each doubling of power adds only about a fifth more speed.' },
  ];
}

const TONE_BY_CODE: Record<string, { label: string; tone: Tone }[]> = {
  unstable: [{ label: 'GM', tone: 'warn' }], overloaded: [{ label: 'Displacement', tone: 'bad' }, { label: 'Draft', tone: 'bad' }],
  'exhaust-capacity': [{ label: POWER, tone: 'warn' }, { label: SPEED, tone: 'warn' }],
  unpowered: [{ label: POWER, tone: 'warn' }, { label: SPEED, tone: 'warn' }], 'propulsor-exposure': [{ label: SPEED, tone: 'warn' }],
};

const SEA_DENSITY = 1025, LEVEL_DEG = .05;
/** Static list and trim the loading settles at, from the offset between the centers of gravity and buoyancy.
 *  List uses the native roll GM. Trim estimates the longitudinal GM from the waterplane area and hull length
 *  (second moment ≈ 0.075·A·L², between a ship-shaped and a rectangular waterplane), so its value reads as approximate. */
export function attitudeRows(result: ConstructionResult | undefined, lengthM: number | undefined): LedgerRow[] {
  const loading = result?.loading, area = result?.definition?.hull.waterplaneAreaM2;
  const reading = (label: string, lever: number, gm: number | undefined, positive: string, negative: string, prefix = ''): LedgerRow => {
    if (gm === undefined || !Number.isFinite(gm) || !loading?.buoyancyCenter) return { label, value: '—' };
    if (gm <= 0) return { label, value: lever ? `Goes over ${lever > 0 ? positive : negative}` : 'Unstable', tone: 'bad' };
    const degrees = Math.atan(lever / gm) * 180 / Math.PI, size = Math.abs(degrees);
    if (size < LEVEL_DEG) return { label, value: 'Level' };
    return { label, value: `${prefix}${format(size, size < 1 ? 2 : 1)}° ${degrees > 0 ? positive : negative}`, tone: size >= 10 ? 'bad' : size >= 2 ? 'warn' : undefined };
  };
  const g = loading?.centerOfGravity ?? [0, 0, 0], b = loading?.buoyancyCenter ?? [0, 0, 0];
  const volume = loading ? loading.massKg / SEA_DENSITY : 0;
  const pitchGm = loading && area && lengthM && volume > 0 ? .075 * area * lengthM * lengthM / volume + b[1] - g[1] : undefined;
  return [
    reading('List', g[0] - b[0], loading?.rollMetacentricHeightM, 'to starboard', 'to port'),
    reading('Trim', b[2] - g[2], pitchGm, 'by the bow', 'by the stern', '≈ '),
  ];
}

/** Hull dimensions from the source, the native readings, and a layer-specific last row. */
export function ledgerRows(source: ConstructionSource, result: ConstructionResult | undefined, layer: BuilderLayer): LedgerRow[] {
  const loading = result?.loading, bounds = hullBounds(source), data = source.construction;
  const tones = new Map<string, Tone>();
  for (const diagnostic of result?.diagnostics ?? []) for (const entry of TONE_BY_CODE[diagnostic.code] ?? []) tones.set(entry.label, entry.tone);
  const row = (label: string, value: string, tone?: Tone, help?: string): LedgerRow => ({ label, value, tone: tone ?? tones.get(label), ...help ? { help } : {} });
  const extent = (axis: number) => bounds ? `${format(bounds.max[axis] - bounds.min[axis])} m` : '—';
  const rows = [
    row('Length', extent(2)),
    row('Beam', extent(0)),
    row('Height', extent(1)),
    row('Displacement', loading ? `${format(loading.massKg / 1000, loading.massKg < 1e6 ? 1 : 0)} t` : '—'),
    row('Draft', loading && bounds ? `${format(loading.waterlineY - bounds.min[1], 2)} m` : '—'),
    row('GM', loading ? `${format(loading.rollMetacentricHeightM, 2)} m` : '—'),
    ...attitudeRows(result, bounds ? bounds.max[2] - bounds.min[2] : undefined).map(entry => row(entry.label, entry.value, entry.tone)),
    ...propulsionRows(result).map(entry => row(entry.label, entry.value, entry.tone, entry.help)),
    row('Usable space', loading ? `${format(loading.usableVolumeM3, 0)} m³` : '—'),
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
      const counts = equipmentCounts(data);
      rows.push(row('Fittings', `${counts.catalog.toLocaleString()} / ${CONSTRUCTION_LIMITS.equipment.toLocaleString()} · ${mounts} guns · ${tubes} tubes`, counts.catalog > CONSTRUCTION_LIMITS.equipment * .95 ? 'warn' : undefined));
      if (counts.custom || data.fittings?.length) rows.push(row('Custom fittings', `${counts.custom.toLocaleString()} / ${CUSTOM_FITTING_LIMITS.instances.toLocaleString()} · ${data.fittings?.length ?? 0} shapes`, counts.custom > CUSTOM_FITTING_LIMITS.instances * .95 ? 'warn' : undefined));
      break;
    }
    case 'paint': {
      const painted = new Set(surfaces.map(surface => surface.paint));
      rows.push(row('Finishes', painted.size ? `${painted.size} paint${painted.size === 1 ? '' : 's'}` : '—'));
    }
  }
  return rows;
}

/** Authored mass groups plus the compiler's approximate internal loading. */
export function massGroups(result: ConstructionResult | undefined): MassGroup[] {
  const groups: MassGroup[] = [
    { name: 'Hull steel', massKg: 0, color: '#9aa8b0' }, { name: 'Armor', massKg: 0, color: '#e8c56c' }, { name: 'Walls', massKg: 0, color: '#c6cfd3' },
    { name: 'Machinery & fittings', massKg: 0, color: '#86e4c5' }, { name: 'Stores & ammunition', massKg: 0, color: '#ffb5a6' },
    { name: 'Internal allowance', massKg: 0, color: '#a8b8cf' },
  ];
  const surfaces = result?.surfaces ?? [];
  for (const item of result?.loading?.contributions ?? []) {
    if (item.kind === 'skin') {
      const index = Number(item.id.slice(item.id.lastIndexOf('-') + 1)), surface: ConstructionSurface | undefined = surfaces[index];
      groups[surface && surface.material === 'armor-steel' ? 1 : 0].massKg += item.massKg;
    } else if (item.kind === 'internal-allowance') groups[5].massKg += item.massKg;
    else if (item.kind === 'bulkhead' || item.kind === 'plating') groups[2].massKg += item.massKg;
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
    if (item.id === `skin-${primitiveId}-platform`) { mass += item.massKg; found = true; continue; }
    const surface = surfaces[Number(item.id.slice(item.id.lastIndexOf('-') + 1))];
    if (surface?.primitiveId === primitiveId) { mass += item.massKg; found = true; }
  }
  return found ? mass : undefined;
}
export function equipmentMassKg(result: ConstructionResult | undefined, equipmentId: string): number | undefined {
  const items = result?.loading?.contributions.filter(item => item.id === equipmentId || item.id === `${equipmentId}-service` || item.id === `${equipmentId}-installation` || (result?.definition?.construction?.version === 2 && item.id === `${equipmentId}-ammunition`));
  return items?.length ? items.reduce((sum, item) => sum + item.massKg, 0) : undefined;
}

export const surfaceCentroid = (surface: ConstructionSurface): [number, number, number] => {
  const sum = surface.vertices.reduce((total, vertex) => [total[0] + vertex[0], total[1] + vertex[1], total[2] + vertex[2]], [0, 0, 0]);
  return sum.map(value => value / Math.max(1, surface.vertices.length)) as [number, number, number];
};

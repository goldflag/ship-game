import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { ReconCoverage } from '../multiplayer/generated/ReconCoverage';
import type { Vec3 } from '../ships/blueprint';
import { shipPreset } from '../ships/presets';

/** What the chart and the overhead label call a contact: the identified class, else the observed classification. */
export const reportName = (track: ContactTrack): string => track.identifiedPresetId ? shipPreset(track.identifiedPresetId).name : track.classification ?? (track.kind === 'aircraft' ? 'Aircraft contact' : 'Surface contact');

export type ReportState = 'current' | 'last-known' | 'estimated' | 'confirmed-sinking';
export function reportState(report: ContactTrack, tick: number): ReportState {
  if (report.visibleCondition?.sinking) return 'confirmed-sinking';
  if (tick - report.lastObservedTick <= 60 && report.status !== 'lost' && report.status !== 'stale') return 'current';
  if (report.status !== 'stale' && report.velocity.some(v => Math.abs(v) > .1)) return 'estimated';
  return 'last-known';
}
export function reportPosition(report: ContactTrack, tick: number): Vec3 {
  return ['last-known', 'confirmed-sinking'].includes(reportState(report, tick)) ? report.measuredPosition : report.estimatedPosition;
}
export function observationAge(observedTick: number, tick: number): string {
  const seconds = Math.max(0, Math.floor((tick - observedTick) / 60));
  return seconds < 2 ? 'now' : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}
export function conditionReport(report: ContactTrack, tick: number): string {
  const condition = report.visibleCondition;
  if (!condition) return 'Condition unconfirmed';
  const visible = condition.sinking ? 'Sinking confirmed' : [condition.fire && 'Fire visible', condition.heavySmoke && 'Heavy smoke', condition.listing && 'Heavy list'].filter(Boolean).join(' · ') || 'No visible distress';
  return `${visible} · ${observationAge(condition.observedTick, tick)}`;
}

export interface CoveragePatch { key: string; age: 'current' | 'recent' | 'older'; points: Vec3[] }
/** Merge neighboring samples into row strips; the projection cost stays small
 * for broad sweeps instead of allocating one projected path per grid cell. */
export function coveragePatches(coverage: ReconCoverage, tick: number): CoveragePatch[] {
  const rows = new Map<string, { z: number; age: CoveragePatch['age']; xs: number[] }>();
  for (const cell of coverage.cells) {
    const elapsed = Math.max(0, tick - cell.lastObservedTick);
    const age = elapsed <= coverage.sampleIntervalTicks + 60 ? 'current' : elapsed <= 60 * 60 ? 'recent' : 'older';
    const key = `${cell.z}/${age}`;
    if (!rows.has(key)) rows.set(key, { z: cell.z, age, xs: [] });
    rows.get(key)!.xs.push(cell.x);
  }
  const patches: CoveragePatch[] = [], half = coverage.cellSizeM / 2;
  for (const [key, row] of rows) {
    row.xs.sort((a, b) => a - b);
    let start = row.xs[0], end = start;
    const add = () => patches.push({ key: `${key}/${start}`, age: row.age,
      points: [[start - half, 0, row.z - half], [end + half, 0, row.z - half], [end + half, 0, row.z + half], [start - half, 0, row.z + half]] });
    for (const x of row.xs.slice(1)) {
      if (Math.abs(x - end - coverage.cellSizeM) > .01) { add(); start = x; }
      end = x;
    }
    add();
  }
  return patches;
}

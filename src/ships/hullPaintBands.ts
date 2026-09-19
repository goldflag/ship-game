import type { ConstructionCustomHull, ConstructionHullPaintBand, ConstructionHullPaintBands } from './blueprint';

type Coating = Pick<ConstructionCustomHull, 'paintBands' | 'redPaintY'>;
export const MAX_HULL_PAINT_BANDS = 8;
export const HULL_PAINT_GAP = .01;

/** Read old designs without rewriting their source or changing their appearance. */
export function hullPaintBands(hull?: Coating): readonly ConstructionHullPaintBand[] {
  return hull?.paintBands?.bands ?? (hull?.redPaintY === undefined ? [] : [{ id: 'lower-hull', upperY: hull.redPaintY, paint: 'red-oxide' }]);
}

/** Upgrade only when the user edits paint; an explicit empty list stays disabled. */
export function editHullPaintBands(hull: Coating): ConstructionHullPaintBand[] {
  hull.paintBands = { version: 1, bands: structuredClone([...hullPaintBands(hull)]) };
  delete hull.redPaintY;
  return hull.paintBands.bands;
}

export function hullPaintBandsError(value: unknown): string | undefined {
  const settings = value as ConstructionHullPaintBands | null;
  if (!settings || settings.version !== 1) return 'Unsupported hull paint bands version.';
  if (!Array.isArray(settings.bands) || settings.bands.length > MAX_HULL_PAINT_BANDS) return 'Use at most 8 hull paint bands.';
  const ids = new Set<string>();
  let previous = -Infinity;
  for (const band of settings.bands) {
    if (!band || typeof band.id !== 'string' || !band.id.length || band.id.length > 64 || ids.has(band.id)) return 'Each hull paint band needs a unique ID.';
    if (!Number.isFinite(band.upperY) || Math.abs(band.upperY) > 500 || band.upperY <= previous) return 'Keep paint heights in ascending order, between −500 and 500 m.';
    if (typeof band.paint !== 'string' || !band.paint.trim() || band.paint.length > 64) return 'Choose a paint for each hull band.';
    ids.add(band.id); previous = band.upperY;
  }
}

/** Neighbours bound a drag/field edit so bands never swap identities or overlap. */
export function hullPaintHeightRange(bands: readonly ConstructionHullPaintBand[], index: number, base: number, deck: number): [number, number] {
  return [Math.max(-500, base, index ? bands[index - 1].upperY + HULL_PAINT_GAP : base),
    Math.min(500, deck, index + 1 < bands.length ? bands[index + 1].upperY - HULL_PAINT_GAP : deck)];
}

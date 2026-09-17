export function finiteFieldValue(text: string, min: number, max: number): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

export function snapCoordinate(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) throw new Error('Snapping requires finite coordinates and a positive grid size.');
  return Number((Math.round(value / step) * step).toFixed(6));
}

export function normalizedBearing(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new Error('Rotation must be finite.');
  return ((degrees % 360) + 360) % 360;
}

/** Null explicitly disables grid rounding while retaining finite-value validation. */
export function gridCoordinate(value: number, step: number | null): number {
  if (!Number.isFinite(value)) throw new Error("Coordinates must be finite.");
  return step === null ? value : snapCoordinate(value, step);
}

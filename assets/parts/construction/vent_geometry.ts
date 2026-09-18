/** Original wall vent dimensions in metres. Height adds/removes fins rather
 * than scaling their section; unused space is shared by the two end margins. */
export function ventFinCenters(height: number, round: boolean): number[] {
  const pitch = round ? .0605 : .085, margin = round ? .06 : .045;
  const count = Math.max(1, 1 + Math.floor((height - margin * 2) / pitch + 1e-8));
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * pitch);
}

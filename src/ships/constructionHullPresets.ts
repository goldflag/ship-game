/** Generic hull starting shapes shared by the builder and its interaction study. */
export const HULL_PRESETS = [
  { id: 'patrol-hull', name: 'Patrol boat', length: 36, beam: 6.5, depth: 4, widths: [.015, .26, .66, .94, 1, .96, .83, .7], round: .45, note: 'Fine bow · flat stern' },
  { id: 'destroyer-hull', name: 'Destroyer', length: 120, beam: 12, depth: 9, widths: [0, .24, .62, .92, 1, .9, .55, .08], round: .78, note: 'Slender · tapered stern' },
  { id: 'battleship-hull', name: 'Battleship', length: 220, beam: 32, depth: 18, widths: [.01, .3, .73, .97, 1, .96, .66, .12], round: .88, note: 'Broad beam · full bilges' },
  { id: 'barge-hull', name: 'Barge', length: 65, beam: 15, depth: 6, widths: [.74, .87, 1, 1, 1, 1, .9, .78], round: 0, note: 'Flat bottom · hard chines' },
] as const;
export type HullPresetChoice = typeof HULL_PRESETS[number]['id'] | 'blank';

import type { ShipClass } from '../game/shipModel';

/** Starboard-profile silhouettes on a 40×20 canvas, bow to the right, waterline at y=14. */
export const SHIP_CLASS_PATHS: Record<ShipClass, string> = {
  Carrier: 'M2 9h36v3H2zM4 12h32l-3 6H7zM26 5h5v4h-5zM28 2h1v3h-1z',
  Battleship: 'M1 14h38l-4 5H4zM16 6h7v8h-7zM18 3h3v3h-3zM12 9h3v5h-3zM27 11h5v3h-5zM32 12h5v1h-5zM7 11h5v3H7zM3 12h4v1H3z',
  Cruiser: 'M2 14h36l-4 5H5zM17 8h5v6h-5zM19 5h1v3h-1zM12 9h2v5h-2zM23 9h2v5h-2zM28 12h3v2h-3zM31 12.5h4v1h-4zM8 12h3v2H8zM5 12.5h3v1H5z',
  Destroyer: 'M3 15h34l-4 4H6zM22 10h5v5h-5zM24 7h1v3h-1zM17 11h2v4h-2zM13 11h2v4h-2zM30 13h3v2h-3zM33 13.5h3v1h-3z',
  Submarine: 'M2 13c1-2 4-3 8-3h22c4 0 6 1 7 3-1 2-3 3-7 3H10c-4 0-7-1-8-3zM17 7h6v3h-6zM19 4h1v3h-1z',
  Other: 'M2 14h36l-3 5H5zM16 9h8v5h-8zM19 6h2v3h-2zM8 8h1v6H8zM6 9h5v1H6zM30 8h1v6h-1zM28 9h5v1h-5z',
};

export function ShipClassIcon({ shipClass, width = 24, className }: { shipClass: ShipClass; width?: number; className?: string }) {
  return <svg className={className} width={width} height={width / 2} viewBox="0 0 40 20" fill="currentColor" aria-hidden="true"><path d={SHIP_CLASS_PATHS[shipClass]}/></svg>;
}

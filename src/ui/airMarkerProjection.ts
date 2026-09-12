import type { Game } from '../game/Game';
import type { Vec3 } from '../ships/blueprint';

export function projectAirMarker(game: Game, marker: DOMStringMap, [x, y, z]: Vec3): [number, number] | null {
  if (marker.plane) return game.projectAircraft(marker.plane);
  if (marker.track) return game.projectContact(marker.track);
  if (marker.contactGroup) return game.projectContactGroup(JSON.parse(marker.contactGroup) as string[]);
  if (marker.contactMarker) return game.projectContact(marker.contactMarker);
  // Own hulls anchor above their rendered top: with the camera level with the water the
  // sea-level point sits on the hull, and the label would cover the ship it names.
  return (marker.shipMarker && game.projectFleetShip(marker.shipMarker)) || game.projectAirMap(x, z, y);
}

/** Project both ends of the direction from one pose, independently of label interpolation. */
export function projectMapHeading(game: Game, position: Vec3, heading: number): number | undefined {
  const [x, y, z] = position;
  const origin = game.projectAirMap(x, z, y);
  const forward = game.projectAirMap(x + Math.sin(heading) * 10, z - Math.cos(heading) * 10, y);
  return origin && forward ? Math.atan2(forward[0] - origin[0], origin[1] - forward[1]) * 180 / Math.PI : undefined;
}

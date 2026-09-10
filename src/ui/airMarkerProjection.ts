import type { Game } from '../game/Game';
import type { Vec3 } from '../ships/blueprint';

export function projectAirMarker(game: Game, marker: DOMStringMap, [x, y, z]: Vec3): [number, number] | null {
  if (marker.plane) return game.projectAircraft(marker.plane);
  if (marker.track) return game.projectContact(marker.track);
  if (marker.contactGroup) return game.projectContactGroup(JSON.parse(marker.contactGroup) as string[]);
  return marker.contactMarker ? game.projectContact(marker.contactMarker) : game.projectAirMap(x, z, y);
}

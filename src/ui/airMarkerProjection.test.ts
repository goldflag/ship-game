import { expect, test } from 'bun:test';
import type { Game } from '../game/Game';
import { projectAirMarker } from './airMarkerProjection';

test('plane markers and group labels follow frame poses instead of cached telemetry coordinates', () => {
  let x = 100;
  const game = { projectAirMap: () => [10, 20], projectAircraft: () => [x, 30], projectContact: () => [x, 40], projectContactGroup: () => [x, 50] } as unknown as Game;
  for (const [marker, y] of [[{ plane: 'own-plane' }, 30], [{ track: 'enemy-plane' }, 40], [{ contactGroup: '["enemy-plane"]' }, 50]] as const) {
    expect(projectAirMarker(game, marker, [10, 0, 20])).toEqual([100, y]);
    x = 150;
    expect(projectAirMarker(game, marker, [10, 0, 20])).toEqual([150, y]);
    x = 100;
  }
});

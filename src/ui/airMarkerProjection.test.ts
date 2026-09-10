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

test('heading stays north as an interpolated contact passes its telemetry position', async () => {
  const { projectMapHeading } = await import('./airMarkerProjection');
  let liveZ = 0;
  const game = {
    projectAirMap: (x: number, z: number) => [x, z],
    projectContact: () => [0, liveZ],
  } as unknown as Game;
  for (liveZ of [0, -5, -10, -15, -30]) {
    const marker = projectAirMarker(game, { track: 'enemy' }, [0, 0, 0])!;
    // The old subtraction flips south once interpolation moves beyond the 10 m heading probe.
    const oldAngle = Math.atan2(-marker[0], marker[1] + 10) * 180 / Math.PI;
    if (liveZ < -10) expect(Math.abs(oldAngle)).toBe(180);
    expect(projectMapHeading(game, [0, 0, 0], 0)).toBe(0);
  }
});

test('own hull markers ride above the rendered hull and fall back to the sea-level point without a model', () => {
  let anchored: [number, number] | null = [7, 8];
  const game = { projectAirMap: () => [10, 20], projectFleetShip: (id: string) => id === 'own' ? anchored : null } as unknown as Game;
  expect(projectAirMarker(game, { shipMarker: 'own' }, [1, 0, 2])).toEqual([7, 8]);
  anchored = null;
  expect(projectAirMarker(game, { shipMarker: 'own' }, [1, 0, 2])).toEqual([10, 20]);
  expect(projectAirMarker(game, { shipMarker: 'enemy' }, [1, 0, 2])).toEqual([10, 20]);
});

import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { Game } from './Game';

function fixture(scale: number) {
  const camera = new PerspectiveCamera(52, 1600 / 900, 1, 60000);
  camera.position.set(0, 8000, 3000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const plane = { flightId: 'flight', phase: 'outbound', previousPosition: [100, 420, 0], position: [200, 420, 0] };
  const game = Object.assign(Object.create(Game.prototype), {
    camera, host: { clientWidth: 1600, clientHeight: 900 }, hudScale: scale,
    simulation: { interpolationAlpha: .5, actors: [{ motion: { id: 'carrier' }, airWing: { planes: [plane] } }] },
  }) as Game;
  return { game, camera, plane };
}

for (const scale of [.75, 1, 1.5, 2]) test(`map marker matches scene and water picking at HUD scale ${scale}`, () => {
  const { game, camera } = fixture(scale);
  const expected = new Vector3(700, 0, -1000).project(camera);
  const point = game.projectAirMap(700, -1000);
  expect(point[0] * scale).toBeCloseTo((expected.x + 1) * 800);
  expect(point[1] * scale).toBeCloseTo((1 - expected.y) * 450);
  const water = game.airMapWater(point[0] * scale, point[1] * scale)!;
  expect(water[0]).toBeCloseTo(700);
  expect(water[1]).toBeCloseTo(-1000);
});

test('squadron projection follows interpolated aircraft and camera between telemetry updates', () => {
  const { game, camera, plane } = fixture(1.5);
  const first = game.projectSquadron('carrier', 'flight')!;
  const expected = new Vector3(150, 444, 0).project(camera);
  expect(first.x * 1.5).toBeCloseTo((expected.x + 1) * 800);
  plane.previousPosition[0] += 100;
  plane.position[0] += 100;
  expect(game.projectSquadron('carrier', 'flight')!.x).toBeGreaterThan(first.x);
  camera.position.x += 1000;
  camera.updateMatrixWorld();
  expect(game.projectSquadron('carrier', 'flight')!.x).toBeLessThan(first.x);
  plane.phase = 'lost';
  expect(game.projectSquadron('carrier', 'flight')).toBeNull();
});

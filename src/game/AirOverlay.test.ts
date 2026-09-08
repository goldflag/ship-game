import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { Game } from './Game';

test('map ship markers reject ships behind the camera at oblique angles', () => {
  const { game, camera } = fixture(1);
  camera.position.set(0, 100, 0);
  camera.lookAt(0, 0, -1000);
  camera.updateMatrixWorld();
  expect(game.projectAirMap(0, 1000)).toBeNull();
  expect(game.projectAirMap(0, -1000)).not.toBeNull();
});

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
  const point = game.projectAirMap(700, -1000)!;
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

test('map paths clip near, far and viewport crossings without joining invisible segments', () => {
  const { game, camera } = fixture(1.5);
  camera.position.set(0, 0, 0); camera.lookAt(0, 0, -1); camera.updateMatrixWorld();
  const numbers = (path: string) => path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
  expect(game.projectAirMapPath([[10, 0, 100], [20, 0, 200]])).toBe('');
  expect(game.projectAirMapPath([[0, 0, -70000], [10, 0, -80000]])).toBe('');
  expect(game.projectAirMapPath([[0, 0, 0], [0, 0, 100]])).toBe('');
  for (const end of [[1000, 0, 100], [10000, 0, -100], [0, 10000, -100], [100, 0, -80000]] as [number, number, number][]) {
    const path = game.projectAirMapPath([[0, 0, -100], end]);
    const coords = numbers(path);
    expect(coords).toHaveLength(4);
    for (let i = 0; i < coords.length; i++) {
      expect(Number.isFinite(coords[i])).toBe(true);
      expect(coords[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(coords[i]).toBeLessThanOrEqual((i % 2 ? 900 : 1600) / 1.5 + 1e-6);
    }
  }
  const separated = game.projectAirMapPath([[0, 0, -100], [100, 0, 100], [-100, 0, 100], [0, 0, -100]]);
  expect(separated.match(/M/g)).toHaveLength(2);
});

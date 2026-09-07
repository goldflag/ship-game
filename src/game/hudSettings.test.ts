import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { DEFAULT_HUD, HUD_STORAGE_KEY, hudScaleFor, loadHudSettings, sanitizeHudSettings } from './hudSettings';
import { projectShipLabel } from './ShipLabels';
import { projectGunAim } from './GunAimIndicators';
import { Game } from './Game';

test('automatic HUD scale grows on ultrawides and contracts in laptop CSS viewports', () => {
  expect(hudScaleFor(DEFAULT_HUD, 1920, 1080)).toBe(1);
  expect(hudScaleFor(DEFAULT_HUD, 3800, 1600)).toBeCloseTo(1.48148);
  expect(hudScaleFor(DEFAULT_HUD, 1512, 900)).toBeCloseTo(.7875);
  // Extra width alone must not make a short, ultrawide window overcrowded.
  expect(hudScaleFor(DEFAULT_HUD, 3800, 900)).toBeCloseTo(900 / 1080);
  expect(hudScaleFor(DEFAULT_HUD, 900, 1600)).toBe(.75);
});

test('adjustment follows automatic sizing while manual sizing stays fixed across monitors', () => {
  expect(hudScaleFor({ mode: 'auto', scale: 1.2 }, 3800, 1600)).toBeCloseTo(1.77778);
  for (const [width, height] of [[1512, 900], [1920, 1080], [3800, 1600]]) {
    expect(hudScaleFor({ mode: 'manual', scale: 1.2 }, width, height)).toBe(1.2);
  }
});

test('extreme and unavailable viewports produce a finite, bounded HUD scale', () => {
  expect(hudScaleFor(DEFAULT_HUD, 7680, 4320)).toBe(2);
  expect(hudScaleFor({ mode: 'auto', scale: 2 }, 7680, 4320)).toBe(3);
  expect(hudScaleFor({ mode: 'auto', scale: .5 }, 320, 480)).toBe(.5);
  for (const width of [0, -1, NaN, Infinity]) expect(hudScaleFor(DEFAULT_HUD, width, 900)).toBe(1);
});

test('invalid stored preferences recover to automatic and clamp only finite numbers', () => {
  for (const value of [null, [], 'bad', { mode: 'other', scale: '2' }, { scale: NaN }, { scale: Infinity }]) {
    expect(sanitizeHudSettings(value)).toEqual(DEFAULT_HUD);
  }
  expect(sanitizeHudSettings({ mode: 'manual', scale: -50 })).toEqual({ mode: 'manual', scale: .5 });
  expect(sanitizeHudSettings({ scale: 500 })).toEqual({ mode: 'auto', scale: 2 });
});

test('HUD settings restore independently and tolerate unavailable browser storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let saved: string | null = JSON.stringify({ mode: 'manual', scale: 1.25 });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { expect(key).toBe(HUD_STORAGE_KEY); return saved; },
  } });
  try {
    expect(loadHudSettings()).toEqual({ mode: 'manual', scale: 1.25 });
    saved = '{broken'; expect(loadHudSettings()).toEqual(DEFAULT_HUD);
    saved = null; expect(loadHudSettings()).toEqual(DEFAULT_HUD);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
    expect(loadHudSettings()).toEqual(DEFAULT_HUD);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('scaled overlay projections keep ship labels and gun circles on the same screen points', () => {
  const width = 3800, height = 1600;
  const camera = new PerspectiveCamera(52, width / height, .5, 60000);
  camera.updateMatrixWorld();
  for (const anchor of [new Vector3(0, 0, -5000), new Vector3(700, 100, -5000)]) {
    const ship = projectShipLabel(anchor, camera, width, height)!;
    const gun = projectGunAim(anchor, camera, width, height);
    for (const scale of [.5, .75, 1.48, 2, 3]) {
      const scaledShip = projectShipLabel(anchor, camera, width / scale, height / scale)!;
      const scaledGun = projectGunAim(anchor, camera, width / scale, height / scale);
      expect(scaledShip.x * scale).toBeCloseTo(ship.x);
      expect(scaledShip.y * scale).toBeCloseTo(ship.y);
      expect(scaledGun.x * scale).toBeCloseTo(gun.x);
      expect(scaledGun.y * scale).toBeCloseTo(gun.y);
    }
  }
});

test('live scale changes resize every projected overlay without recreating the renderer', () => {
  const game = Object.create(Game.prototype) as Game;
  const dimensions = new Map<string, number[]>();
  Object.assign(game, {
    host: { clientWidth: 3800, clientHeight: 1600 },
    ...Object.fromEntries(['shipLabels', 'hitLabels', 'gunAim'].map(name => [name, {
      resize: (width: number, height: number) => dimensions.set(name, [width, height]),
    }])),
  });
  for (const scale of [1.5, .75]) {
    game.setHudScale(scale);
    expect(dimensions.size).toBe(3);
    for (const size of dimensions.values()) expect(size).toEqual([3800 / scale, 1600 / scale]);
  }
});

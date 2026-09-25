import { expect, test } from 'bun:test';
import { alignmentHint, parseOverlayArgs, resolveShots } from './overlay';
import type { ShipDefinition } from '../../src/ships/blueprint';

const definition = {
  hull: { length: 200 },
  viewpoints: { bridge: [0, 25, -40] },
  structures: [
    { footprint: [[-3, 30], [3, 30], [3, 40], [-3, 40]], baseY: 9, height: 8 },
    { footprint: [[-3, 60], [3, 60], [3, 64], [-3, 64]], baseY: 9, height: 3 },
  ],
} as unknown as ShipDefinition;

test('defaults to the five review shots with silhouette alignment', () => {
  const options = parseOverlayArgs(['hood']);
  expect(options).toMatchObject({ id: 'hood', shots: ['side', 'top', 'front', 'bridge', 'aft'], align: 'silhouette', px: 2400, fetch: true });
  expect(options.offset).toBeUndefined();
});

test('a single offset shifts the reference fore and aft only', () => {
  expect(parseOverlayArgs(['hood', '--offset', '1.5']).offset).toEqual([0, 0, 1.5]);
  expect(parseOverlayArgs(['hood', '--offset', '0,.2,1']).offset).toEqual([0, .2, 1]);
});

test('rejects unknown shots, flags and half-specified cameras', () => {
  expect(() => parseOverlayArgs(['hood', '--shots', 'side,keel'])).toThrow('Unknown shot');
  expect(() => parseOverlayArgs(['hood', '--angle', '3'])).toThrow('Unknown flag');
  expect(() => parseOverlayArgs(['hood', '--fov', '30'])).toThrow('--camera or --eye');
  expect(() => parseOverlayArgs(['hood', '--box', '1,2,3'])).toThrow('--box takes 6');
});

test('zooms centre on the bridge viewpoint and the tallest structure abaft midships', () => {
  const shots = resolveShots(parseOverlayArgs(['hood', '--shots', 'side,bridge,aft']), definition);
  expect(shots.map(s => s.name)).toEqual(['side', 'bridge', 'aft']);
  const [, bridge, aft] = shots as { box: (number | null)[] }[];
  expect([bridge.box[2], bridge.box[5]]).toEqual([-68, -12]);
  expect([aft.box[2], aft.box[5]]).toEqual([7, 63]);
});

test('a box adds three clipped views and a camera adds one pinned shot', () => {
  const shots = resolveShots(parseOverlayArgs(['hood', '--shots', 'side', '--box', '-5,8,-50,5,30,-20', '--camera', 'broadside', '--ortho', '80']), definition);
  expect(shots.map(s => s.name)).toEqual(['side', 'box-side', 'box-top', 'box-front', 'camera']);
  const camera = shots.at(-1) as { pin: { ortho?: number; eye: number[] } };
  expect(camera.pin.ortho).toBe(80);
  expect(camera.pin.eye[0]).toBeGreaterThan(200);
});

test('textured pairs, section cuts and the fore-aft-only alignment', () => {
  const options = parseOverlayArgs(['hood', '--textured', '--sections', 'z=-40,y=6.5', '--align', 'fore-aft', '--paint', 'default']);
  expect(options).toMatchObject({ id: 'hood', textured: true, align: 'fore-aft', paint: 'default', sections: [{ axis: 'z', value: -40 }, { axis: 'y', value: 6.5 }] });
  expect(parseOverlayArgs(['--textured', 'hood']).id).toBe('hood');
  expect(() => parseOverlayArgs(['hood', '--sections', 'keel'])).toThrow('axis=value');
});

test('the hint names a fitted vertical datum, or suggests fitting one when the side view disagrees', () => {
  const shot = (iou: number) => ({ name: 'side', iou });
  expect(alignmentHint({ offset: [0, 0.868, 1.97], fitted: true, shots: [shot(0.97)] }, { align: 'silhouette' })).toContain('0.87 m lower than ours');
  expect(alignmentHint({ offset: [0, 0.01, 1.97], fitted: true, shots: [shot(0.97)] }, { align: 'silhouette' })).toBeUndefined();
  expect(alignmentHint({ offset: [0, 0, 1.97], fitted: true, shots: [shot(0.89)] }, { align: 'fore-aft' })).toContain('vertical datum');
  expect(alignmentHint({ offset: [0, 0, 1.97], fitted: false, shots: [shot(0.95)] }, { align: 'silhouette' })).toBeUndefined();
});

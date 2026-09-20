import { expect, test } from 'bun:test';
import { idColors, viewDirection, viewRequests, VIEW_PRESETS } from './viewOptions';

test('presets reproduce the fixed render directions', () => {
  const near = (a: number[], b: number[]) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], 9));
  const unit = (v: number[]) => { const length = Math.hypot(...v); return v.map(value => value / length); };
  for (const [name, direction] of Object.entries({ profile: [1, 0, 0], plan: [0, 1, 0], bow: [0, 0, -1], stern: [0, 0, 1], quarter: [1, .6, -1] }))
    near(viewDirection(VIEW_PRESETS[name as keyof typeof VIEW_PRESETS].azimuthDeg, VIEW_PRESETS[name as keyof typeof VIEW_PRESETS].elevationDeg).direction, unit(direction));
  near(viewDirection(VIEW_PRESETS.plan.azimuthDeg, 90).up, [1, 0, 0]);
  near(viewDirection(30, 20).up, [0, 1, 0]);
});

test('requests: defaults, several views, overrides and rejected input', () => {
  expect(viewRequests({})).toMatchObject([{ name: 'quarter', mode: 'exterior', width: 1600, height: 1000, trim: true, zoom: 1, perspective: false, focus: [], isolate: false }]);
  expect(viewRequests({ view: 'profile, plan', mode: 'ids' }).map(r => [r.name, r.mode])).toEqual([['profile', 'ids'], ['plan', 'ids']]);
  expect(viewRequests({ azimuth: '200', elevation: '-10' })[0]).toMatchObject({ name: 'custom', azimuthDeg: 200, elevationDeg: -10 });
  expect(viewRequests({ view: 'bow', elevation: '30' })[0]).toMatchObject({ name: 'bow', azimuthDeg: 0, elevationDeg: 30 });
  expect(viewRequests({ region: '5,9,1,-5,0,-1', size: '800x600' })[0]).toMatchObject({ region: [[-5, 0, -1], [5, 9, 1]], width: 800, height: 600, trim: false });
  expect(viewRequests({ section: 'x=0' })[0].section).toEqual({ axis: 'x', value: 0, keep: 'auto' });
  expect(viewRequests({ section: 'z>-12.5' })[0].section).toEqual({ axis: 'z', value: -12.5, keep: 'above' });
  for (const flags of [{ mode: 'xray' }, { view: 'side' }, { size: '99999x10' }, { size: 'big' }, { zoom: '0' }, { isolate: true }, { region: '1,2,3' }, { section: 'w=1' }, { elevation: '120' }, { view: 'bow,stern', azimuth: '5' }, { view: 'bow,bow' }, { azimuth: 'north' }])
    expect(() => viewRequests(flags)).toThrow();
});

test('id colours are distinct and avoid near-greys', () => {
  const colors = idColors(2000);
  expect(new Set(colors).size).toBe(2000);
  for (const color of colors.slice(0, 200)) { const v = parseInt(color.slice(1), 16), c = [v >> 16, v >> 8 & 255, v & 255]; expect(Math.max(...c) - Math.min(...c)).toBeGreaterThan(40); }
});

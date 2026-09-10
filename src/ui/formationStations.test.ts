import { describe, expect, test } from 'bun:test';
import { formationStations, roleInterval, roleOrder, stationPosition, SCREEN_INNER_RADIUS_M, SCREEN_OUTER_RADIUS_M } from './formationStations';

const bb = { id: 'bb', shipClass: 'battleship' as const };
const ca = { id: 'ca', shipClass: 'cruiser' as const };
const dd1 = { id: 'dd1', shipClass: 'destroyer' as const }, dd2 = { id: 'dd2', shipClass: 'destroyer' as const }, dd3 = { id: 'dd3', shipClass: 'destroyer' as const };
const cv = { id: 'cv', shipClass: 'carrier' as const };

describe('formationStations', () => {
  test('column spacing scales with the guide hull and heavies sail nearest the guide', () => {
    expect(roleInterval('battleship')).toBe(900);
    expect(roleInterval('destroyer')).toBe(500);
    const stations = formationStations('column', bb, [dd1, ca, dd2]);
    expect(stations.map(s => s.id)).toEqual(['ca', 'dd1', 'dd2']);
    expect(stations.map(s => s.offset)).toEqual([[0, 900], [0, 1800], [0, 2700]]);
    expect(stations.map(s => s.slot)).toEqual([0, 1, 2]);
  });
  test('line abreast alternates starboard and port at the interval', () => {
    expect(formationStations('line-abreast', ca, [dd1, dd2, dd3]).map(s => s.offset)).toEqual([[500, 0], [-500, 0], [1000, 0]]);
  });
  test('screen rings cruisers inside and destroyers outside, first station dead ahead', () => {
    const stations = formationStations('screen', cv, [dd1, ca, dd2, dd3]);
    const byId = Object.fromEntries(stations.map(s => [s.id, s.offset]));
    expect(byId.ca).toEqual([0, -SCREEN_INNER_RADIUS_M]);
    expect(byId.dd1).toEqual([0, -SCREEN_OUTER_RADIUS_M]);
    for (const dd of [byId.dd2, byId.dd3]) expect(Math.round(Math.hypot(dd[0], dd[1]))).toBe(SCREEN_OUTER_RADIUS_M);
    expect(byId.dd2[0]).toBeGreaterThan(0); // starboard first
    expect(byId.dd3[0]).toBeLessThan(0);
    expect(stations.find(s => s.id === 'ca')?.slot).toBe(0);
  });
  test('the guide never receives a station and role order is stable', () => {
    expect(formationStations('column', bb, [bb, dd1]).map(s => s.id)).toEqual(['dd1']);
    expect(roleOrder([dd2, dd1, ca]).map(s => s.id)).toEqual(['ca', 'dd2', 'dd1']);
  });
  test('stationPosition rotates [starboard, aft] with the axis', () => {
    const east = stationPosition({ x: 0, z: 0, heading: Math.PI / 2 }, [0, 100]);
    expect(Math.round(east.x)).toBe(-100); expect(Math.round(east.z)).toBe(0);
    const north = stationPosition({ x: 10, z: 10, heading: 0 }, [50, 100]);
    expect(north).toEqual({ x: 60, z: 110 });
  });
});

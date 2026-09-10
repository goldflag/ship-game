import { describe, expect, test } from 'bun:test';
import { FORMATIONS, formationLabel, formationStations, roleInterval, roleOrder, stationPosition, MIN_STATION_OFFSET_M, SCREEN_INNER_RADIUS_M, SCREEN_OUTER_RADIUS_M } from './formationStations';
import type { ShipClass } from './shipGlyphs';

const bb = { id: 'bb', shipClass: 'battleship' as const };
const ca = { id: 'ca', shipClass: 'cruiser' as const };
const dd1 = { id: 'dd1', shipClass: 'destroyer' as const }, dd2 = { id: 'dd2', shipClass: 'destroyer' as const }, dd3 = { id: 'dd3', shipClass: 'destroyer' as const };
const cv = { id: 'cv', shipClass: 'carrier' as const };
const dd = { id: 'guide-dd', shipClass: 'destroyer' as const };

describe('formationStations', () => {
  test('column spacing scales with the guide hull and heavies sail nearest the guide', () => {
    expect(roleInterval('battleship')).toBe(450);
    expect(roleInterval('carrier')).toBe(450);
    expect(roleInterval('auxiliary')).toBe(400);
    expect(roleInterval('destroyer')).toBe(360);
    const stations = formationStations('column', bb, [dd1, ca, dd2]);
    expect(stations.map(s => s.id)).toEqual(['ca', 'dd1', 'dd2']);
    expect(stations.map(s => s.offset)).toEqual([[0, 450], [0, 900], [0, 1350]]);
    expect(stations.map(s => s.slot)).toEqual([0, 1, 2]);
  });
  test('double column puts the guide at the head of the port column and fills rank by rank', () => {
    expect(formationStations('double-column', dd, [dd1, dd2, dd3]).map(s => s.offset)).toEqual([[360, 0], [0, 360], [360, 360]]);
    expect(formationStations('double-column', dd, [dd1, dd2, dd3, ca, cv]).map(s => s.offset)).toEqual([[360, 0], [0, 360], [360, 360], [0, 720], [360, 720]]);
  });
  test('triple column puts the guide at the head of the centre column with the wings abeam', () => {
    expect(formationStations('triple-column', dd, [dd1, dd2, dd3]).map(s => s.offset)).toEqual([[-360, 0], [360, 0], [0, 360]]);
    expect(formationStations('triple-column', dd, [dd1, dd2, dd3, ca, cv, bb]).map(s => s.offset)).toEqual([[-360, 0], [360, 0], [0, 360], [-360, 360], [360, 360], [0, 720]]);
  });
  test('line abreast alternates starboard and port at the interval', () => {
    expect(formationStations('line-abreast', ca, [dd1, dd2, dd3]).map(s => s.offset)).toEqual([[360, 0], [-360, 0], [720, 0]]);
  });
  test('screen rings cruisers inside and destroyers outside, first station dead ahead', () => {
    const stations = formationStations('screen', cv, [dd1, ca, dd2, dd3]);
    const byId = Object.fromEntries(stations.map(s => [s.id, s.offset]));
    expect(byId.ca).toEqual([0, -SCREEN_INNER_RADIUS_M]);
    expect(byId.ca).toEqual([0, -700]);
    expect(byId.dd1).toEqual([0, -SCREEN_OUTER_RADIUS_M]);
    expect(byId.dd1).toEqual([0, -1300]);
    for (const dd of [byId.dd2, byId.dd3]) expect(Math.round(Math.hypot(dd[0], dd[1]))).toBe(SCREEN_OUTER_RADIUS_M);
    expect(byId.dd2[0]).toBeGreaterThan(0); // starboard first
    expect(byId.dd3[0]).toBeLessThan(0);
    // Three destroyers share the outer ring, so the pair astern sits on the ±120° bearings.
    expect(byId.dd2).toEqual([1126, 650]);
    expect(byId.dd3).toEqual([-1126, 650]);
    expect(stations.find(s => s.id === 'ca')?.slot).toBe(0);
  });
  test('no station is closer to the guide than the protocol allows', () => {
    const classes: ShipClass[] = ['battleship', 'carrier', 'cruiser', 'auxiliary', 'destroyer', 'submarine'];
    const followers = [ca, dd1, dd2, dd3, { id: 'ss', shipClass: 'submarine' as const }, { id: 'ao', shipClass: 'auxiliary' as const }];
    for (const entry of FORMATIONS) for (const shipClass of classes) {
      const stations = formationStations(entry.id, { id: 'guide', shipClass }, followers);
      expect(stations).toHaveLength(followers.length);
      for (const station of stations) expect(Math.hypot(...station.offset)).toBeGreaterThanOrEqual(MIN_STATION_OFFSET_M);
    }
  });
  test('every formation the picker offers has a label', () => {
    expect(FORMATIONS.map(f => f.id)).toEqual(['column', 'double-column', 'triple-column', 'screen', 'line-abreast']);
    expect(FORMATIONS.map(f => formationLabel(f.id))).toEqual(['Column', 'Double column', 'Triple column', 'Screen', 'Line abreast']);
    expect(formationLabel(undefined)).toBe('Column');
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

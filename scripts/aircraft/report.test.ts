import { expect, test } from 'bun:test';
import { aircraftReportMatches } from './report';

const report = () => ({ modelHash: 'exact-model-hash', triangles: 30999, bounds: [[-7.619999885559082, 0, 0]],
  joints: [{ nodeId: 'wing.fold.port', maximumVertexTravel: 4.1837006135474475 }],
  lods: [{ modelHash: 'exact-lod-hash', joints: [{ nodeId: 'wing.fold.port', maximumVertexTravel: 4.183987367450703 }] }] });

test('identical model reports tolerate only the platform roundoff in measured joint travel', () => {
  const retained = report(), actual = report();
  actual.joints[0].maximumVertexTravel = 4.183700613547448;
  actual.lods[0].joints[0].maximumVertexTravel = 4.183987367450704;
  expect(aircraftReportMatches(actual, retained)).toBe(true);
  expect(aircraftReportMatches(retained, actual)).toBe(true);
  expect(retained).toEqual(report());
});

test('changed hashes, geometry, joint ownership and meaningful travel remain stale', () => {
  const retained = report();
  for (const edit of [
    (r: ReturnType<typeof report>) => { r.modelHash += '-changed'; },
    (r: ReturnType<typeof report>) => { r.lods[0].modelHash += '-changed'; },
    (r: ReturnType<typeof report>) => { r.triangles++; },
    (r: ReturnType<typeof report>) => { r.bounds[0][0] += 1e-14; },
    (r: ReturnType<typeof report>) => { r.joints[0].nodeId = 'wing.fold.starboard'; },
    (r: ReturnType<typeof report>) => { r.joints[0].maximumVertexTravel += 1e-12; },
    (r: ReturnType<typeof report>) => { r.joints[0].maximumVertexTravel = NaN; },
    (r: ReturnType<typeof report>) => { r.lods.pop(); },
  ]) {
    const actual = report(); edit(actual); expect(aircraftReportMatches(actual, retained)).toBe(false);
  }
  expect(aircraftReportMatches({ maximumVertexTravel: 4.183700613547448 }, { maximumVertexTravel: 4.1837006135474475 })).toBe(false);
});

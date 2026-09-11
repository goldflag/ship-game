import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from '../ships/presets';
import { flotation, hydrostatics, hullVolume, meshFlotation, meshHydrostatics } from './hydrostatics';
import { rotate } from './geometry';
import type { Hull } from '../ships/blueprint';

// Independent reference: retain the original full moment integration at every
// bisection trial, including its iteration count and bounds.
function reference(hull: Hull, volume: number, roll: number, pitch: number) {
  const bound = hull.length + hull.beam + hull.draft + hull.depth;
  const full = meshHydrostatics(hull, -bound, roll, pitch);
  if (volume >= full.volume) return { ...full, y: -bound, afloat: false };
  let low = -bound, high = bound;
  for (let i = 0; i < 27; i++) {
    const y = (low + high) / 2;
    if (meshHydrostatics(hull, y, roll, pitch).volume > volume) low = y; else high = y;
  }
  const y = (low + high) / 2;
  return { ...meshHydrostatics(hull, y, roll, pitch), y, afloat: true };
}

test('the mesh solver matches full clipped moments across fleet hulls, heel, trim and immersion', () => {
  for (const id of Object.keys(shipPresets)) {
    const { hull } = shipPreset(id);
    for (const [roll, pitch] of [[0, 0], [.17, -.06], [-.6, .3], [2.1, -.8], [0, Math.PI / 2]]) {
      const full = meshHydrostatics(hull, -(hull.length + hull.beam + hull.draft + hull.depth), roll, pitch).volume;
      for (const fraction of [.001, .2, .5, .95, 1, 1.1]) {
        const actual = meshFlotation(hull, full * fraction, roll, pitch);
        const expected = reference(hull, full * fraction, roll, pitch);
        expect(actual).toEqual(expected);
      }
    }
  }
});

// The Rust twin measures the same table against its own copy of the mesh solver
// in crates/naval-sim/tests/hydrostatic_table.rs. This is the near side of that
// contract: the published table is what a port free sail and every captured
// fixture float on, so it has to agree with the solver it was solved from.
test('the published table floats every fleet hull where the mesh solver does', () => {
  const worst = { draft: 0, roll: 0, pitch: 0 };
  for (const id of Object.keys(shipPresets)) {
    const { hull } = shipPreset(id);
    const full = meshHydrostatics(hull, -(hull.length + hull.beam + hull.draft + hull.depth)).volume;
    expect(hullVolume(hull)).toBeCloseTo(full, 3);
    for (const heel of [0, .02, .09, .22, .45, .8]) for (const trim of [-.15, -.03, 0, .025, .12]) {
      for (const fraction of [.3, .5, .7, .88]) for (const roll of [heel, -heel]) {
        const volume = full * fraction;
        const table = flotation(hull, volume, roll, trim), mesh = meshFlotation(hull, volume, roll, trim);
        const arms = rotate(table.center.map((n, i) => n - mesh.center[i]) as [number, number, number], { heading: 0, roll, pitch: trim });
        worst.draft = Math.max(worst.draft, Math.abs(table.y - mesh.y));
        worst.roll = Math.max(worst.roll, Math.abs(arms[0]));
        worst.pitch = Math.max(worst.pitch, Math.abs(arms[2]));
        // Reading the solved immersion back must return the displacement that produced it.
        expect(Math.abs(hydrostatics(hull, mesh.y, roll, trim).volume - volume)).toBeLessThan(volume * .03);
      }
    }
  }
  // Draft to a few centimetres, inside the wave heave the hull rides anyway;
  // the arms translate to under a fifth of a degree of settled list and under a
  // twentieth of a degree of settled trim.
  expect(worst.draft).toBeLessThan(.08);
  expect(worst.roll).toBeLessThan(.12);
  expect(worst.pitch).toBeLessThan(.7);
});

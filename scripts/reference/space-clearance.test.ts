import { expect, test } from 'bun:test';
import { hullSectionHalfWidth } from './space-clearance';
import blueprint from '../../assets/ships/baltimore/blueprint.json';
import type { ShipBlueprint } from '../../src/ships/blueprint';

test('rounded Baltimore residual cells retain clearance at the terminal hull station', () => {
  const b=blueprint as ShipBlueprint;
  for(const room of b.compartments.filter(c=>c.id==='reserve-cell-3-0-1'||c.id==='reserve-cell-3-1-1')) {
    expect(room.cells!.length).toBeGreaterThan(0);
    for(const cell of room.cells!)for(let i=0;i<8;i++) {
      const p=cell.center.map((v,j)=>v+cell.size[j]/2*(i&(1<<j)?1:-1));
      const width=hullSectionHalfWidth(b.hull.sections!,b.hull.length/2-p[2],p[1]);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(Math.abs(p[0])-width).toBeLessThanOrEqual(.25);
    }
  }
});

test('clearance rejects genuine longitudinal overhang rather than extrapolating the end section',()=>{
  const sections=(blueprint as ShipBlueprint).hull.sections!;
  expect(hullSectionHalfWidth(sections,-.00001,0)).toBe(-1);
  expect(hullSectionHalfWidth(sections,sections.at(-1)!.station+.00001,0)).toBe(-1);
});

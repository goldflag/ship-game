/** Original revision-1 load and residual-space calibration; no historical loading claim. */
import { readFile, writeFile } from 'node:fs/promises';
import { compileShip, type ShipBlueprint, type Vec3, type Compartment } from '../../src/ships/blueprint';
import { hullContains } from '../../src/simulation/hull';
import { hydrostatics, initialMetacenter } from '../../src/simulation/hydrostatics';
const catalog = JSON.parse(await readFile(new URL('../parts/guns.json', import.meta.url), 'utf8'));
type Cell = { center: Vec3; size: Vec3 };
function mergeCells(input: Cell[]): Cell[] {
  let cells=input;
  for (const axis of [0,2,1,0,2]) {
    const others=[0,1,2].filter(i=>i!==axis), groups=new Map<string,Cell[]>();
    for(const c of cells) {const key=others.flatMap(i=>[c.center[i].toFixed(7),c.size[i].toFixed(7)]).join(':');const group=groups.get(key)??[];group.push(c);groups.set(key,group);}
    cells=[];
    for(const group of groups.values()) {
      group.sort((a,b)=>a.center[axis]-b.center[axis]); let previous:Cell|undefined;
      for(const cell of group) {
        const high=previous ? previous.center[axis]+previous.size[axis]/2 : -Infinity, low=cell.center[axis]-cell.size[axis]/2;
        if(previous && Math.abs(high-low)<1e-7) {const bottom=previous.center[axis]-previous.size[axis]/2, top=cell.center[axis]+cell.size[axis]/2;previous.center[axis]=(top+bottom)/2;previous.size[axis]=top-bottom;}
        else {previous={center:[...cell.center],size:[...cell.size]};cells.push(previous);}
      }
    }
  }
  return cells.map(c=>({center:c.center.map(n=>Number(n.toFixed(8))) as Vec3,size:c.size.map(n=>Number(n.toFixed(8))) as Vec3}));
}
function subtract(cell: Cell, room: Cell): Cell[] {
  if (!cell.center.every((n,i)=>Math.abs(n-room.center[i]) < (cell.size[i]+room.size[i])/2-1e-7)) return [cell];
  const lo=cell.center.map((n,i)=>n-cell.size[i]/2), hi=cell.center.map((n,i)=>n+cell.size[i]/2), out: Cell[]=[];
  const push=(a:number[],b:number[])=>{if(b.every((n,i)=>n-a[i]>=.001))out.push({center:a.map((n,i)=>(n+b[i])/2) as Vec3,size:a.map((n,i)=>b[i]-n) as Vec3});};
  for(let axis=0;axis<3;axis++) {
    const low=Math.max(lo[axis],room.center[axis]-room.size[axis]/2), high=Math.min(hi[axis],room.center[axis]+room.size[axis]/2);
    if(low>lo[axis]){const edge=[...hi];edge[axis]=low;push(lo,edge);lo[axis]=low;}
    if(high<hi[axis]){const edge=[...lo];edge[axis]=high;push(edge,hi);hi[axis]=high;}
  }
  return out;
}
for (const id of ['bismarck', 'yamato', 'baltimore', 'enterprise-cv6']) {
  const path = new URL(`./${id}/blueprint.json`, import.meta.url), b = JSON.parse(await readFile(path, 'utf8')) as ShipBlueprint;
  b.compartments = b.compartments.filter(c => !c.id.startsWith('reserve-cell-'));
  b.connections = b.connections.filter(c => !c.id?.startsWith('reserve-link-'));
  b.floodRegions = b.floodRegions?.filter(c => !c.id.startsWith('reserve-region-'));
  const old = [...b.compartments], h = b.hull, base = hydrostatics(h), full = hydrostatics(h, -h.length);
  const gm = h.beam * .07;
  b.stability = { version: 1, dryCenterOfGravity: [0, initialMetacenter(h) - gm, base.center[2]], buoyancyScale: h.massKg / (1025 * base.volume), shellThicknessMm: 12,
    basis: 'Estimated loading: dry CG calibrated to an initial GM of 7% beam; longitudinal CG matches modeled buoyancy at reference waterline. Uniform buoyancy scale reconciles stated mass with the authored hull volume. Unmapped outer shell uses 12 mm steel. Residual flood cells conservatively exclude retained room boxes; partitions, permeability and access are game estimates.' };
  for (let zi = 0; zi < 4; zi++) for (let side = 0; side < 2; side++) for (let yi = 0; yi < 3; yi++) {
    const z0 = -h.length / 2 + h.length * zi / 4, z1 = z0 + h.length / 4;
    const bottom = -h.draft, top = Math.max(...h.deckHeights.map(p => p[1])), y0 = bottom + (top - bottom) * yi / 3, y1 = bottom + (top - bottom) * (yi + 1) / 3;
    const x0 = side ? 0 : -h.beam / 2, x1 = x0 + h.beam / 2;
    let cells: NonNullable<Compartment['cells']> = [];
    for (let z = 0; z < 12; z++) for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) {
      const size: Vec3 = [(x1 - x0) / 6, (y1 - y0) / 3, (z1 - z0) / 12];
      const center: Vec3 = [x0 + (x + .5) * size[0], y0 + (y + .5) * size[1], z0 + (z + .5) * size[2]];
      const fill = (cell: { center: Vec3; size: Vec3 }, depth: number) => {
        const inside = [-1,1].flatMap(sx => [-1,1].flatMap(sy => [-1,1].map(sz => hullContains(h, [cell.center[0]+sx*cell.size[0]/2, cell.center[1]+sy*cell.size[1]/2, cell.center[2]+sz*cell.size[2]/2]))));
        if (!inside.every(Boolean)) {
          if (depth === 0 || (!inside.some(Boolean) && !hullContains(h, cell.center))) return;
          for (const sx of [-1,1]) for (const sy of [-1,1]) for (const sz of [-1,1]) fill({ center: cell.center.map((n,i) => n+[sx,sy,sz][i]*cell.size[i]/4) as Vec3, size: cell.size.map(n=>n/2) as Vec3 }, depth-1);
          return;
        }
        let pieces = [cell];
        for (const room of old) pieces = pieces.flatMap(piece => subtract(piece, room));
        cells.push(...pieces);
      };
      fill({center,size}, 2);
    }
    if (!cells.length) continue;
    const before=cells.reduce((n,c)=>n+c.size[0]*c.size[1]*c.size[2],0);
    cells=mergeCells(cells);
    const after=cells.reduce((n,c)=>n+c.size[0]*c.size[1]*c.size[2],0);
    if(Math.abs(before-after)>Math.max(.01,before*1e-6)) throw new Error('Cell merge changed volume');
    const roomId = `reserve-cell-${zi}-${side}-${yi}`, center: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: Vec3 = [x1 - x0, y1 - y0, z1 - z0];
    const c: Compartment = { id: roomId, name: `${side ? 'Starboard' : 'Port'} ${['deep', 'middle', 'upper'][yi]} reserve space ${zi + 1} · estimated`, center, size, cells, capacityM3: cells.reduce((n, c) => n + c.size[0] * c.size[1] * c.size[2] * .85, 0), pumpM3PerSecond: .001 };
    b.compartments.push(c);
    b.floodRegions ??= []; b.floodRegions.push({ id: `reserve-region-${zi}-${side}-${yi}`, compartmentId: c.id, center, size });
    // Retain sealed estimated access to the closest existing space. A hit must
    // breach the actual portal; exterior assignment never opens it automatically.
    const neighbor = old.map(r => ({ r, distance: Math.hypot(...r.center.map((n, axis) => Math.max(0, Math.abs(n - center[axis]) - size[axis] / 2))) })).sort((a, b) => a.distance - b.distance)[0]?.r;
    if (neighbor) { const position = neighbor.center.map((n, axis) => Math.max(center[axis] - size[axis] / 2, Math.min(center[axis] + size[axis] / 2, n))) as Vec3;
      b.connections.push({ id: `reserve-link-${zi}-${side}-${yi}`, fromId: c.id, toId: neighbor.id, areaM2: .5, state: 'closed', position, bounds: { center: position, size: [.05, .8, .8] }, thicknessMm: 5 }); }
  }
  compileShip(b, catalog); await writeFile(path, JSON.stringify(b, null, 2) + '\n');
  const report = { version: 1, shipId: id, method: 'Station polygon clipping and midpoint integration; conservative residual cells, 85% permeability', baselineVolumeM3: base.volume, fullHullVolumeM3: full.volume, statedMassKg: h.massKg, geometricDisplacementKg: base.volume * 1025, buoyancyScale: b.stability.buoyancyScale, dryCenterOfGravity: b.stability.dryCenterOfGravity, initialGM: gm, floodCapacityM3: b.compartments.reduce((n, c) => n + c.capacityM3, 0), reserveSpaces: b.compartments.length - old.length, limitations: b.stability.basis };
  await writeFile(new URL(`./${id}/reports/stability.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n'); console.log(report);
}

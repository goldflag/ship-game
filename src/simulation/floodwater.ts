import type { Compartment, Vec3 } from '../ships/blueprint';
import { clamp } from './geometry';

export interface WaterBody {
  volume: number; level: number; area: number; center: Vec3;
  /** Orientation at the simulation's last hydrostatic update. */
  roll: number; pitch: number;
}
interface Column { center: Vec3; low: number; high: number; volume: number; extent: number; }
interface SurfacePoint { level: number; volume: number; area: number; }
interface WaterGeometry { axis: number; sign: number; columns: Column[]; surface: SurfacePoint[]; }

// Derived geometry only: warming this cache cannot change a query's result or
// simulation state. A cloned/restored WaterBody rebuilds the same geometry.
const geometries = new WeakMap<WaterBody, { surface: SurfacePoint[] }>();
const columnLayouts = new WeakMap<Compartment, { key: number; columns: Column[]; events: { level: number; area: number }[] }>();
const uprightLayouts = new WeakMap<Compartment, ReturnType<typeof buildLayout>>();
interface DryCell { center: Vec3; size: Vec3; fractions: number[]; }
interface DryNode { center: Vec3; size: Vec3; cells?: DryCell[]; children?: DryNode[]; }
const dryCells = new WeakMap<Compartment, { cells: DryCell[]; tree?: DryNode; seeds: DryCell[] }>();
function dryTree(cells: DryCell[]): DryNode {
  const low: Vec3 = [Infinity, Infinity, Infinity], high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const cell of cells) for (let i = 0; i < 3; i++) {
    low[i] = Math.min(low[i], cell.center[i] - cell.size[i] / 2);
    high[i] = Math.max(high[i], cell.center[i] + cell.size[i] / 2);
  }
  const center = low.map((v, i) => (v + high[i]) / 2) as Vec3, size = low.map((v, i) => high[i] - v) as Vec3;
  if (cells.length <= 8) return { center, size, cells };
  const axis = size.indexOf(Math.max(...size));
  cells.sort((a, b) => a.center[axis] - b.center[axis]);
  const middle = cells.length >> 1;
  return { center, size, children: [dryTree(cells.slice(0, middle)), dryTree(cells.slice(middle))] };
}
function dryLayout(room: Compartment) {
  let result = dryCells.get(room);
  if (!result) {
    const cells = (room.cells ?? [room]).map(cell => ({ center: cell.center, size: cell.size,
      fractions: cell.size.map(size => 1 - 1 / (room.cells ? Math.min(4, Math.max(1, Math.ceil(size / 2.5))) : 4)) }));
    const tree = cells.length > 32 ? dryTree([...cells]) : undefined;
    const seeds: DryCell[] = [];
    if (tree) for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const projection = (cell: DryCell) => x * cell.center[0] + y * cell.center[1] + z * cell.center[2];
      seeds.push(cells.reduce((a, b) => projection(a) > projection(b) ? a : b));
    }
    result = { cells, tree, seeds };
    dryCells.set(room, result);
  }
  return result;
}
let lastOrientation: { roll: number; pitch: number; normal: Vec3; axis: number; others: number[] } | undefined;
function orientation(roll: number, pitch: number) {
  if (lastOrientation && Object.is(lastOrientation.roll, roll) && Object.is(lastOrientation.pitch, pitch)) return lastOrientation;
  const normal: Vec3 = [Math.sin(roll) * Math.cos(pitch), Math.cos(roll) * Math.cos(pitch), -Math.sin(pitch)];
  const axis = normal.reduce((best, v, i) => Math.abs(v) > Math.abs(normal[best]) ? i : best, 0);
  return lastOrientation = { roll, pitch, normal, axis, others: [0, 1, 2].filter(i => i !== axis) };
}

function layout(room: Compartment, roll: number, pitch: number): ReturnType<typeof buildLayout> {
  if (roll !== 0 || pitch !== 0) return buildLayout(room, roll, pitch);
  let grid = uprightLayouts.get(room);
  if (!grid) {
    grid = buildLayout(room, roll, pitch);
    uprightLayouts.set(room, grid);
  }
  return grid;
}

function buildLayout(room: Compartment, roll: number, pitch: number) {
  const { normal, axis, others } = orientation(roll, pitch);
  const cells = (room.cells ?? [room]).map(cell => {
    // Upright transverse samples have identical heads; one column is exact.
    const divisions = others.map(i => Math.abs(normal[i]) < 1e-12 ? 1 : room.cells ? Math.min(4, Math.max(1, Math.ceil(cell.size[i] / 2.5))) : 4);
    const height = cell.center.reduce((n, v, i) => n + v * normal[i], 0);
    const half = Math.abs(normal[axis]) * cell.size[axis] / 2 + others.reduce((n, i, j) => n + Math.abs(normal[i]) * cell.size[i] * (1 - 1 / divisions[j]) / 2, 0);
    return { cell, divisions, low: height - half, high: height + half };
  });
  return { normal, axis, others, cells, bottom: Math.min(...cells.map(c => c.low)), top: Math.max(...cells.map(c => c.high)) };
}

function geometry(room: Compartment, pose: ReturnType<typeof orientation>): WaterGeometry {
  const { normal, axis, others } = pose;
  // Column centers and volumes depend on the dominant axis and which transverse
  // components need sampling. Reuse that topology as the ship's attitude moves.
  const key = axis * 8 + normal.reduce((mask, n, i) => mask | (Math.abs(n) < 1e-12 ? 1 << i : 0), 0);
  let compiled = columnLayouts.get(room);
  if (!compiled || compiled.key !== key) {
    const cells = (room.cells ?? [room]).map(cell => ({ cell,
      divisions: others.map(i => Math.abs(normal[i]) < 1e-12 ? 1 : room.cells ? Math.min(4, Math.max(1, Math.ceil(cell.size[i] / 2.5))) : 4) }));
    const gross = cells.reduce((sum, { cell: c }) => sum + c.size[0] * c.size[1] * c.size[2], 0);
    const porosity = room.capacityM3 / gross, columns: Column[] = [];
    const events: { level: number; area: number }[] = [];
    for (const { cell, divisions: [a, b] } of cells) {
      for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) {
        const center = [...cell.center] as Vec3;
        center[others[0]] += ((i + .5) / a - .5) * cell.size[others[0]];
        center[others[1]] += ((j + .5) / b - .5) * cell.size[others[1]];
        const volume = cell.size[0] * cell.size[1] * cell.size[2] * porosity / (a * b);
        columns.push({ center, low: 0, high: 0, extent: cell.size[axis], volume });
        events.push({ level: 0, area: 0 }, { level: 0, area: 0 });
      }
    }
    compiled = { key, columns, events };
    columnLayouts.set(room, compiled);
  }
  const columns = compiled.columns;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i], y = c.center.reduce((n, v, k) => n + v * normal[k], 0);
    const half = Math.abs(normal[axis]) * c.extent / 2;
    c.low = y - half; c.high = y + half;
    const area = c.volume / (c.high - c.low);
    compiled.events[i * 2].level = c.low; compiled.events[i * 2].area = area;
    compiled.events[i * 2 + 1].level = c.high; compiled.events[i * 2 + 1].area = -area;
  }
  // Start each stable sort in original column order, including equal levels.
  const events = compiled.events.slice();
  events.sort((a, b) => a.level - b.level);
  const surface: SurfacePoint[] = [];
  let volume = 0, area = 0, previous = events[0].level;
  for (let i = 0; i < events.length;) {
    const level = events[i].level;
    volume += area * (level - previous);
    do { area += events[i++].area; } while (i < events.length && events[i].level === level);
    area = Math.max(0, area);
    surface.push({ level, volume, area });
    previous = level;
  }
  surface.at(-1)!.volume = room.capacityM3;
  return { axis, sign: Math.sign(normal[axis]), columns, surface };
}

/** Exact inverse of the column approximation's piecewise-linear volume curve.
 * Unlike a single area derivative, this crosses narrow sumps and broad decks
 * without extrapolating a waterline outside the room. */
function surfaceAt(surface: SurfacePoint[], volume: number): { level: number; area: number } {
  if (volume <= 0) return surface[0];
  if (volume >= surface.at(-1)!.volume) return { level: surface.at(-1)!.level, area: 0 };
  let low = 1, high = surface.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (surface[mid].volume < volume) low = mid + 1; else high = mid;
  }
  const start = surface[low - 1];
  return { level: start.level + (volume - start.volume) / start.area, area: start.area };
}

export function levelAtVolume(room: Compartment, body: WaterBody, volume: number): number {
  if (volume === body.volume) return body.level;
  let shape = geometries.get(body);
  if (!shape) {
    shape = { surface: geometry(room, orientation(body.roll, body.pitch)).surface };
    geometries.set(body, shape);
  }
  return surfaceAt(shape.surface, volume).level;
}

/** Horizontal free surface over disjoint cells, sampled with up to sixteen
 * columns per cell. Movement of the centroid supplies the free-surface moment;
 * no separate penalty is added. The pose refreshes at the hydrostatic cadence. */
export function waterBody(room: Compartment, volume: number, roll: number, pitch: number): WaterBody {
  volume = clamp(volume, 0, room.capacityM3);
  if (volume === 0 && (roll !== 0 || pitch !== 0)) {
    // Dry rooms need only the sampled bounds, not a materialized column layout.
    // Preserve buildLayout's sample spacing and arithmetic order exactly.
    const { normal, axis } = orientation(roll, pitch);
    let bottom = Infinity, top = -Infinity;
    const measure = (cell: DryCell) => {
      const height = 0 + cell.center[0] * normal[0] + cell.center[1] * normal[1] + cell.center[2] * normal[2];
      let transverse = 0;
      for (let i = 0; i < 3; i++) if (i !== axis) {
        const fraction = Math.abs(normal[i]) < 1e-12 ? 0 : cell.fractions[i];
        transverse += Math.abs(normal[i]) * cell.size[i] * fraction / 2;
      }
      const half = Math.abs(normal[axis]) * cell.size[axis] / 2 + transverse;
      bottom = Math.min(bottom, height - half); top = Math.max(top, height + half);
    };
    const grid = dryLayout(room);
    if (!grid.tree) grid.cells.forEach(measure);
    else {
      grid.seeds.forEach(measure);
      const visit = (node: DryNode) => {
        const height = 0 + node.center[0] * normal[0] + node.center[1] * normal[1] + node.center[2] * normal[2];
        const half = Math.abs(normal[0]) * node.size[0] / 2 + Math.abs(normal[1]) * node.size[1] / 2 + Math.abs(normal[2]) * node.size[2] / 2;
        // Full cell bounds enclose every sampled column. Expand for floating
        // point rounding; leaves retain the original sampled arithmetic.
        if (height - half - 1e-8 > bottom && height + half + 1e-8 < top) return;
        if (node.children) node.children.forEach(visit); else node.cells!.forEach(measure);
      };
      visit(grid.tree);
    }
    return { volume, roll, pitch, center: [...room.center], level: bottom, area: room.capacityM3 / (top - bottom) };
  }
  if (volume === 0) {
    const grid = layout(room, roll, pitch);
    return { volume, roll, pitch, center: [...room.center], level: grid.bottom, area: room.capacityM3 / (grid.top - grid.bottom) };
  }
  const shape = geometry(room, orientation(roll, pitch)), { level, area } = surfaceAt(shape.surface, volume);
  const center: Vec3 = [0, 0, 0];
  let measured = 0;
  for (const c of shape.columns) {
    const fraction = clamp((level - c.low) / (c.high - c.low), 0, 1), water = fraction * c.volume;
    for (let i = 0; i < 3; i++) {
      const coordinate = c.center[i] - (i === shape.axis ? shape.sign * c.extent * (1 - fraction) / 2 : 0);
      center[i] += coordinate * water;
    }
    measured += water;
  }
  const body = { volume, roll, pitch, level, area, center: measured > 0 ? center.map(n => n / measured) as Vec3 : [...room.center] as Vec3 };
  // Only the immutable curve survives this query; columns are reusable scratch.
  geometries.set(body, { surface: shape.surface });
  return body;
}

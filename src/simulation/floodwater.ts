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
const geometries = new WeakMap<WaterBody, WaterGeometry>();
const uprightLayouts = new WeakMap<Compartment, ReturnType<typeof buildLayout>>();

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
  const normal: Vec3 = [Math.sin(roll) * Math.cos(pitch), Math.cos(roll) * Math.cos(pitch), -Math.sin(pitch)];
  const axis = normal.reduce((best, v, i) => Math.abs(v) > Math.abs(normal[best]) ? i : best, 0);
  const others = [0, 1, 2].filter(i => i !== axis);
  const cells = (room.cells ?? [room]).map(cell => {
    // Upright transverse samples have identical heads; one column is exact.
    const divisions = others.map(i => Math.abs(normal[i]) < 1e-12 ? 1 : room.cells ? Math.min(4, Math.max(1, Math.ceil(cell.size[i] / 2.5))) : 4);
    const height = cell.center.reduce((n, v, i) => n + v * normal[i], 0);
    const half = Math.abs(normal[axis]) * cell.size[axis] / 2 + others.reduce((n, i, j) => n + Math.abs(normal[i]) * cell.size[i] * (1 - 1 / divisions[j]) / 2, 0);
    return { cell, divisions, low: height - half, high: height + half };
  });
  return { normal, axis, others, cells, bottom: Math.min(...cells.map(c => c.low)), top: Math.max(...cells.map(c => c.high)) };
}

function geometry(room: Compartment, grid: ReturnType<typeof layout>): WaterGeometry {
  const { normal, axis, others, cells } = grid;
  const gross = cells.reduce((sum, { cell: c }) => sum + c.size[0] * c.size[1] * c.size[2], 0);
  const porosity = room.capacityM3 / gross, columns: Column[] = [];
  const events: { level: number; area: number }[] = [];
  for (const { cell, divisions: [a, b] } of cells) {
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) {
      const center = [...cell.center] as Vec3;
      center[others[0]] += ((i + .5) / a - .5) * cell.size[others[0]];
      center[others[1]] += ((j + .5) / b - .5) * cell.size[others[1]];
      const y = center.reduce((n, v, k) => n + v * normal[k], 0), extent = cell.size[axis];
      const half = Math.abs(normal[axis]) * extent / 2, low = y - half, high = y + half;
      const volume = cell.size[0] * cell.size[1] * cell.size[2] * porosity / (a * b), area = volume / (high - low);
      columns.push({ center, low, high, extent, volume });
      events.push({ level: low, area }, { level: high, area: -area });
    }
  }
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
    shape = geometry(room, layout(room, body.roll, body.pitch));
    geometries.set(body, shape);
  }
  return surfaceAt(shape.surface, volume).level;
}

/** Horizontal free surface over disjoint cells, sampled with up to sixteen
 * columns per cell. Movement of the centroid supplies the free-surface moment;
 * no separate penalty is added. The pose refreshes at the hydrostatic cadence. */
export function waterBody(room: Compartment, volume: number, roll: number, pitch: number): WaterBody {
  const grid = layout(room, roll, pitch);
  volume = clamp(volume, 0, room.capacityM3);
  if (volume === 0) return { volume, roll, pitch, center: [...room.center], level: grid.bottom, area: room.capacityM3 / (grid.top - grid.bottom) };
  const shape = geometry(room, grid), { level, area } = surfaceAt(shape.surface, volume);
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
  geometries.set(body, shape);
  return body;
}

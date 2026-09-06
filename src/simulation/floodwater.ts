import type { Compartment, Vec3 } from '../ships/blueprint';
import { clamp, rotate } from './geometry';
export interface WaterBody { volume: number; level: number; area: number; center: Vec3; }
/** Horizontal free surface over disjoint cells. Sixteen columns for a box;
 * compound cells use up to sixteen columns depending on size. No separate free-surface
 * penalty is added: movement of this water's centroid supplies that moment. */
export function waterBody(room: Compartment, volume: number, roll: number, pitch: number): WaterBody {
  const pose = { roll, pitch, heading: 0 }, n: Vec3 = [Math.sin(roll) * Math.cos(pitch), Math.cos(roll) * Math.cos(pitch), -Math.sin(pitch)];
  if (volume <= 0) {
    const height = room.size.reduce((sum, v, i) => sum + v * Math.abs(n[i]), 0);
    return { volume: 0, center: [...room.center], level: rotate(room.center, pose)[1] - height / 2, area: room.capacityM3 / height };
  }
  const axis = n.reduce((best, v, i) => Math.abs(v) > Math.abs(n[best]) ? i : best, 0), others = [0, 1, 2].filter(i => i !== axis);
  const cells = room.cells ?? [room];
  const gross = cells.reduce((sum, c) => sum + c.size[0] * c.size[1] * c.size[2], 0), porosity = room.capacityM3 / gross;
  const columns: { center: Vec3; low: number; high: number; volume: number; extent: number }[] = [];
  let bottom = Infinity, top = -Infinity;
  for (const cell of cells) {
    const a = room.cells ? Math.min(4, Math.max(1, Math.ceil(cell.size[others[0]] / 2.5))) : 4;
    const b = room.cells ? Math.min(4, Math.max(1, Math.ceil(cell.size[others[1]] / 2.5))) : 4;
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) {
    const center = [...cell.center] as Vec3;
    center[others[0]] += ((i + .5) / a - .5) * cell.size[others[0]];
    center[others[1]] += ((j + .5) / b - .5) * cell.size[others[1]];
    const y = rotate(center, pose)[1], extent = cell.size[axis], half = Math.abs(n[axis]) * extent / 2;
    const low = y - half, high = y + half;
    columns.push({ center, low, high, extent, volume: cell.size[0] * cell.size[1] * cell.size[2] * porosity / (a * b) });
    bottom = Math.min(bottom, low); top = Math.max(top, high);
  }
  }
  let low = bottom, high = top;
  for (let i = 0; i < 22 && volume > 0 && volume < room.capacityM3; i++) {
    const y = (low + high) / 2, v = columns.reduce((sum, c) => sum + c.volume * clamp((y - c.low) / (c.high - c.low), 0, 1), 0);
    if (v < volume) low = y; else high = y;
  }
  const level = volume <= 0 ? bottom : volume >= room.capacityM3 ? top : (low + high) / 2;
  const center: Vec3 = [0, 0, 0]; let measured = 0, area = 0;
  for (const c of columns) {
    const f = clamp((level - c.low) / (c.high - c.low), 0, 1), v = f * c.volume, point = [...c.center];
    point[axis] -= Math.sign(n[axis]) * c.extent * (1 - f) / 2;
    for (let i = 0; i < 3; i++) center[i] += point[i] * v;
    measured += v;
    if (f > 0 && f < 1) area += c.volume / (c.high - c.low);
  }
  return { volume, level, center: measured > 0 ? center.map(n => n / measured) as Vec3 : [...room.center], area: Math.max(area, room.capacityM3 / (top - bottom) * .1) };
}

import { Vector3, type Object3D } from 'three/webgpu';
import type { WakeGeneratorOptions } from '../contracts';

/** Generators the step shader loops over. */
export const MAX_GENERATORS = 16;
/** Swept speed (m/s) at which a generator reaches full amplitude; slower motion fades it to nothing. */
const FULL_SPEED = 1;
/** Time constant (s) of the emitted depth: a hull that appears, jumps or starts at speed presses the
 * sea in over about a second instead of in one step, which would ring out as a steep, foaming circle. */
const RESPONSE = .8;

/** What one generator puts into one simulation step: the path swept since its previous step. */
export interface WakeEmission {
  x0: number; z0: number; x1: number; z1: number;
  radius: number;
  /** Hull depth after the speed gate (m). */
  depth: number;
  /** Speed gate 0–1 for foam along the hull path. */
  gate: number;
}

interface Generator {
  readonly object: Object3D;
  active: boolean; depth: number; radius: number; teleportThreshold: number;
  readonly offset: Vector3;
  /** Emission point at the previous and the current frame; null before the first frame. */
  previous: { x: number; z: number } | null;
  current: { x: number; z: number } | null;
  /** Emission point at the last simulation step; null restarts the history. */
  last: { x: number; z: number } | null;
  /** Emitted depth, easing toward depth × speed gate. */
  level: number;
}

/** Tracks the objects that disturb the wake and turns their motion into per-step swept segments.
 * A frame's steps interpolate each object between its previous and current frame positions, so a
 * slow frame that runs several steps still lays a continuous path. */
export class WakeGenerators {
  private readonly generators = new Map<number, Generator>();
  private nextId = 1;

  add(object: Object3D, options: WakeGeneratorOptions = {}): number {
    if (this.generators.size >= MAX_GENERATORS) throw new Error(`The wake field holds at most ${MAX_GENERATORS} generators`);
    const id = this.nextId++;
    this.generators.set(id, {
      object, active: true, depth: .3, radius: 5, teleportThreshold: 50, offset: new Vector3(),
      previous: null, current: null, last: null, level: 0,
    });
    this.update(id, options);
    return id;
  }

  update(id: number, options: WakeGeneratorOptions): boolean {
    const generator = this.generators.get(id);
    if (!generator) return false;
    if (options.active !== undefined) generator.active = options.active;
    if (options.depth !== undefined) generator.depth = options.depth;
    if (options.radius !== undefined) generator.radius = options.radius;
    if (options.teleportThreshold !== undefined) generator.teleportThreshold = options.teleportThreshold;
    if (options.offset) generator.offset.copy(options.offset);
    return true;
  }

  remove(id: number): boolean { return this.generators.delete(id); }

  get size(): number { return this.generators.size; }

  /** Forget every position: the next step of each generator only records where it is. */
  restart(): void {
    for (const generator of this.generators.values()) { generator.previous = generator.current = generator.last = null; generator.level = 0; }
  }

  /** Sample every object once per advancing frame. A frame move longer than the teleport threshold
   * restarts that generator's history and freezes it at its new position for the frame's steps. */
  beginFrame(): void {
    for (const generator of this.generators.values()) {
      const point = emissionPoint(generator);
      const from = generator.current;
      generator.previous = from; generator.current = point;
      if (from && Math.hypot(point.x - from.x, point.z - from.z) > generator.teleportThreshold) {
        generator.previous = point; generator.last = null; generator.level = 0;
      }
    }
  }

  /** Emissions for a step that ends at `fraction` (0, 1] of the current frame and lasts `seconds`. */
  step(fraction: number, seconds: number, out: WakeEmission[]): void {
    out.length = 0;
    for (const generator of this.generators.values()) {
      const current = generator.current;
      if (!current) continue;
      const previous = generator.previous ?? current;
      const x = previous.x + (current.x - previous.x) * fraction, z = previous.z + (current.z - previous.z) * fraction;
      const last = generator.last;
      generator.last = { x, z };
      if (!last) continue;
      const distance = Math.hypot(x - last.x, z - last.z);
      if (distance > generator.teleportThreshold) { generator.level = 0; continue; }
      const s = Math.min(distance / seconds / FULL_SPEED, 1), gate = generator.active ? s * s * (3 - 2 * s) : 0;
      generator.level += (generator.depth * gate - generator.level) * (1 - Math.exp(-seconds / RESPONSE));
      if (gate <= 0) continue;
      out.push({ x0: last.x, z0: last.z, x1: x, z1: z, radius: generator.radius, depth: generator.level, gate });
    }
  }
}

/** World XZ of the object's origin plus its offset turned by the object's yaw only. */
function emissionPoint({ object, offset }: Generator): { x: number; z: number } {
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.elements, yaw = Math.atan2(e[8], e[10]), cos = Math.cos(yaw), sin = Math.sin(yaw);
  return { x: e[12] + offset.x * cos + offset.z * sin, z: e[14] - offset.x * sin + offset.z * cos };
}

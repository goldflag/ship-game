import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3, Vector4, type Camera, type Node } from 'three/webgpu';
import { abs, attribute, cameraPosition, float, int, max, mod, positionGeometry, select, smoothstep, uniformArray, vec2 } from 'three/tsl';

/** Edge of the finest level in metres; each further level doubles it. */
export const CLIPMAP_BASE = 256;
export const CLIPMAP_LEVELS = 6;
/** Share of `camera.far` the flat horizon ring reaches. */
const HORIZON_REACH = .95;

/** Camera-centred geometry clipmap plus a flat horizon ring, in one draw.
 *
 * Level 0 is a square of `segments` cells, 256 m across; each further level is a square ring
 * with twice the extent and cell size around the one inside it. Every level snaps its centre
 * to twice its own cell, so vertices sit on fixed world lattice points and never swim. A ring's
 * inner edge follows the finer level's snapped centre (a shift of at most one cell), and each
 * level geomorphs its odd vertices onto the coarser lattice toward its outer edge, which it
 * reaches fully morphed: neighbouring levels share exact edge vertices, so there are no cracks.
 * World positions are sums of exact powers of two, so both sides of a seam evaluate the waves
 * at bit-identical points. The horizon ring continues from the outer lattice to 95% of the far
 * plane with vertex spacing that grows with distance; the wave field fades out every wave its
 * spacing cannot carry, which leaves it flat. */
export class OceanGeometry {
  readonly mesh: Mesh;
  /** Undisplaced world xz of the vertex (vertex stage). */
  readonly grid: Node<'vec2'>;
  /** Local vertex spacing in metres (vertex stage), continuous across level seams. */
  readonly spacing: Node<'float'>;
  private readonly frames = uniformArray<'vec4'>(Array.from({ length: CLIPMAP_LEVELS }, () => new Vector4()), 'vec4');
  private readonly eye = new Vector3();
  private radius = 0;

  /** The mesh's material is the caller's: it reads `grid` and `spacing` in its vertex stage. */
  constructor(readonly segments: number, far: number) {
    if (segments < 8 || segments % 8) throw new Error(`Clipmap segments must be a multiple of 8, not ${segments}`);
    this.mesh = new Mesh(this.build(far));
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'Ocean surface';
    const data = attribute<'vec2'>('oceanLevel', 'vec2');
    const level = int(data.x.min(CLIPMAP_LEVELS - 1));
    const horizon = data.x.greaterThan(CLIPMAP_LEVELS - .5);
    const frame = this.frames.element(level), finer = this.frames.element(select(level.greaterThan(int(0)), level.sub(int(1)), int(0)));
    // Multiplying by the exact reciprocal (w) keeps the lattice arithmetic exact on every GPU.
    const cell = frame.z;
    const lattice = positionGeometry.xz.mul(frame.w);
    // A ring's inner edge sits on the finer level's outer edge, wherever that level snapped.
    const hole = this.segments / 4;
    const inner = max(abs(lattice.x), abs(lattice.y)).lessThanEqual(hole).and(level.greaterThan(int(0))).and(horizon.not());
    const index = lattice.add(select(inner, finer.xy.sub(frame.xy).mul(frame.w), vec2(0)));
    const snapped = frame.xy.add(index.mul(cell));
    // Geomorph by true distance from the eye, so the band slides smoothly; the outer row is
    // always at least 1 - 2/segments of the level's reach away, where the morph is complete.
    const reach = max(abs(snapped.x.sub(cameraPosition.x)), abs(snapped.y.sub(cameraPosition.z))).div(cell.mul(this.segments / 2));
    const morph = select(horizon, float(0), smoothstep(.6, .85, reach));
    this.grid = snapped.sub(mod(index, 2).mul(morph).mul(cell));
    this.spacing = select(horizon, data.y, cell.mul(morph.add(1)));
  }

  /** Cell size of `level` in metres: an exact power of two for every tier. */
  cell(level: number): number { return CLIPMAP_BASE / this.segments * 2 ** level; }

  /** Snap every level to the eye. Call before rendering from `camera`. */
  update(camera: Camera): void {
    camera.getWorldPosition(this.eye);
    for (let level = 0; level < CLIPMAP_LEVELS; level++) {
      const cell = this.cell(level), step = cell * 2;
      (this.frames.array[level] as Vector4).set(Math.round(this.eye.x / step) * step, Math.round(this.eye.z / step) * step, cell, 1 / cell);
    }
  }

  /** Whether the surface covers world point (x, z) around the last snapped eye. */
  covers(x: number, z: number): boolean {
    const outer = this.frames.array[CLIPMAP_LEVELS - 1] as Vector4;
    return Math.hypot(x - outer.x, z - outer.y) < this.radius * Math.cos(Math.PI / this.horizonVertices());
  }

  /** Grow the horizon ring to cover a far plane of `far` metres; it never shrinks. */
  ensureHorizon(far: number): void {
    if (far * HORIZON_REACH <= this.radius) return;
    const previous = this.mesh.geometry;
    this.mesh.geometry = this.build(far);
    previous.dispose();
  }

  dispose(): void { this.mesh.geometry.dispose(); }

  /** Vertices around each horizon row: every other vertex of the outermost level's edge. */
  private horizonVertices(): number { return this.segments; }

  private build(far: number): BufferGeometry {
    const positions: number[] = [], levels: number[] = [], index: number[] = [];
    const segments = this.segments, half = segments / 2, hole = segments / 4;
    const vertex = (x: number, z: number, level: number, spacing = 0) => {
      positions.push(x, 0, z); levels.push(level, spacing);
      return levels.length / 2 - 1;
    };
    // Counter-clockwise seen from above, so the front face looks up.
    const triangle = (a: number, b: number, c: number) => {
      const ax = positions[a * 3], az = positions[a * 3 + 2];
      const cross = (positions[b * 3] - ax) * (positions[c * 3 + 2] - az) - (positions[b * 3 + 2] - az) * (positions[c * 3] - ax);
      if (cross > 0) index.push(a, c, b); else index.push(a, b, c);
    };
    for (let level = 0; level < CLIPMAP_LEVELS; level++) {
      const cell = this.cell(level), first = levels.length / 2;
      for (let j = -half; j <= half; j++) for (let i = -half; i <= half; i++) vertex(i * cell, j * cell, level);
      const at = (i: number, j: number) => first + (j + half) * (segments + 1) + i + half;
      for (let j = -half; j < half; j++) for (let i = -half; i < half; i++) {
        if (level > 0 && i >= -hole && i < hole && j >= -hole && j < hole) continue;
        // One diagonal direction everywhere: fully morphed cells collapse exactly onto the coarser triangles.
        triangle(at(i, j), at(i, j + 1), at(i + 1, j + 1));
        triangle(at(i, j), at(i + 1, j + 1), at(i + 1, j));
      }
    }
    // Horizon rows: the outer lattice (every other outermost vertex), squares doubling outward, then a circle.
    const edge = half * this.cell(CLIPMAP_LEVELS - 1), step = 2 * this.cell(CLIPMAP_LEVELS - 1);
    const perSide = half / 2, count = this.horizonVertices();
    const square: [number, number][] = [];
    for (let k = 0; k < count; k++) {
      const side = Math.floor(k / perSide), t = (k % perSide) * step - edge;
      square.push(side === 0 ? [t, -edge] : side === 1 ? [edge, t] : side === 2 ? [-t, edge] : [-edge, -t]);
    }
    // The circle stays outside the last square's corners however small the far plane.
    this.radius = Math.max(far * HORIZON_REACH, edge * 3);
    const rows = [1];
    while (edge * rows.at(-1)! * 2 <= this.radius / 2) rows.push(rows.at(-1)! * 2);
    let previous = square.map(([x, z]) => vertex(x, z, CLIPMAP_LEVELS, step));
    for (let row = 1; row <= rows.length; row++) {
      const last = row === rows.length;
      const current = square.map(([x, z]) => {
        const scale = last ? this.radius / Math.hypot(x, z) : rows[row];
        return vertex(x * scale, z * scale, CLIPMAP_LEVELS, step * (last ? this.radius / edge : rows[row]));
      });
      for (let k = 0; k < count; k++) {
        const n = (k + 1) % count;
        triangle(previous[k], current[k], current[n]);
        triangle(previous[k], current[n], previous[n]);
      }
      previous = current;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('oceanLevel', new Float32BufferAttribute(levels, 2));
    geometry.setIndex(index);
    return geometry;
  }
}

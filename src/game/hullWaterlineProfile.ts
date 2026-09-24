import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three/webgpu';

/** Stations along the hull, including one empty station beyond each end. */
export const PROFILE_STATIONS = 32;
/** Horizontal slices through the hull, `PROFILE_LEVEL_STEP` metres apart, centred on the design waterline. */
export const PROFILE_LEVELS = 7;
export const PROFILE_LEVEL_STEP = 2;
export const PROFILE_LOWEST = -PROFILE_LEVEL_STEP * (PROFILE_LEVELS - 1) / 2;
/** Bins along the hull and across each side in which the height of the side is gathered before the stations are known. */
const SIDE_BINS = 128, SIDE_BANDS = 16;
/** Anything standing within this share of a station's half-breadth of the side counts as the side: the sheer strake,
 * a bulwark, the deck edge's fittings. Superstructure and turrets stand farther inboard. */
const SIDE_SHARE = .8;

/** Where the hull meets horizontal planes around its waterline, in the hull's own frame
 * (x to starboard, z aft). `starboard` and `port` hold the outboard half-breadths per
 * level and station, level-major; NaN where no part of the hull crosses that plane. */
export interface WaterlineProfile {
  /** Model z of the first station's centre and the spacing between stations. */
  start: number; spacing: number;
  /** Model z of the stem and the sternmost crossing at the design waterline, or of any level without one. */
  bow: number; stern: number;
  /** Widest half-breadth at any level. */
  halfBeam: number;
  starboard: Float32Array; port: Float32Array;
  /** Height above the design waterline of the top of each side (its deck edge, bulwark or what stands at it) per
   * station, 0 where the hull has no side: the wall the water beside it sees. */
  starboardSide: Float32Array; portSide: Float32Array;
}

const corner = [new Vector3(), new Vector3(), new Vector3()];
const bounds = new Box3();

/** Slice every opaque surface of a drawn hull at the profile levels. Visual only: the foam
 * line and the sea's shelter follow the hull the player sees, premade model and construction hull alike. */
export function hullWaterlineProfile(root: Object3D): WaterlineProfile | undefined {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert(), local = new Matrix4();
  const meshes: Mesh[] = [];
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!(mesh instanceof Mesh) || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh ||
      (mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh || !mesh.geometry?.getAttribute('position')) return;
    meshes.push(mesh);
  });
  // The model's extent in its own frame, from each geometry's bounds, lays out the bins the sides' heights gather in.
  const extent = new Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    extent.union(bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(local.multiplyMatrices(toRoot, mesh.matrixWorld)));
  }
  const binLow = extent.min.z, binSize = Math.max(extent.max.z - extent.min.z, 1e-3) / SIDE_BINS;
  const bandSize = Math.max(extent.max.x, -extent.min.x, 1e-3) / SIDE_BANDS;
  // Highest point above the waterline per side, bin along the hull and band out from the centreline.
  const tops = [new Float32Array(SIDE_BINS * SIDE_BANDS).fill(-Infinity), new Float32Array(SIDE_BINS * SIDE_BANDS).fill(-Infinity)];
  const binOf = (z: number) => Math.max(0, Math.min(SIDE_BINS - 1, Math.floor((z - binLow) / binSize)));
  const raise = (x: number, y: number, bin: number) => {
    const top = tops[x >= 0 ? 0 : 1], cell = bin * SIDE_BANDS + Math.min(SIDE_BANDS - 1, Math.floor(Math.abs(x) / bandSize));
    if (y > top[cell]) top[cell] = y;
  };
  // Crossing segments per level: x0, z0, x1, z1.
  const segments: number[][] = Array.from({ length: PROFILE_LEVELS }, () => []);
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    local.multiplyMatrices(toRoot, mesh.matrixWorld);
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k++) corner[k].fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(local);
      const low = Math.min(corner[0].y, corner[1].y, corner[2].y), high = Math.max(corner[0].y, corner[1].y, corner[2].y);
      // A triangle's highest point within a bin lies on its corners or where its edges cross the bin's ends: a long
      // strake of two triangles has no corner in the bins between its ends.
      if (high > 0) for (let k = 0; k < 3; k++) {
        const a = corner[k], b = corner[(k + 1) % 3];
        if (a.y > 0) raise(a.x, a.y, binOf(a.z));
        const first = binOf(Math.min(a.z, b.z)), last = binOf(Math.max(a.z, b.z));
        for (let bin = first + 1; bin <= last; bin++) {
          const t = (binLow + bin * binSize - a.z) / (b.z - a.z), y = a.y + (b.y - a.y) * t;
          if (y > 0) { const x = a.x + (b.x - a.x) * t; raise(x, y, bin - 1); raise(x, y, bin); }
        }
      }
      if (high < PROFILE_LOWEST || low > -PROFILE_LOWEST) continue;
      for (let level = 0; level < PROFILE_LEVELS; level++) {
        const y = PROFILE_LOWEST + level * PROFILE_LEVEL_STEP;
        if (!(low < y && high > y)) continue;
        const points: number[] = [];
        for (let k = 0; k < 3; k++) {
          const a = corner[k], b = corner[(k + 1) % 3];
          if ((a.y < y) === (b.y < y)) continue;
          const t = (y - a.y) / (b.y - a.y);
          points.push(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        }
        if (points.length === 4) segments[level].push(points[0], points[1], points[2], points[3]);
      }
    }
  }
  const middle = (PROFILE_LEVELS - 1) / 2;
  let zMin = Infinity, zMax = -Infinity;
  for (const list of segments) for (let i = 0; i < list.length; i += 2) { zMin = Math.min(zMin, list[i + 1]); zMax = Math.max(zMax, list[i + 1]); }
  if (!(zMax > zMin)) return undefined;
  // One empty station beyond each end keeps the clamped texture free of foam past the hull.
  const spacing = (zMax - zMin) / (PROFILE_STATIONS - 3), start = zMin - spacing;
  const size = PROFILE_LEVELS * PROFILE_STATIONS;
  const starboard = new Float32Array(size).fill(NaN), port = new Float32Array(size).fill(NaN);
  const record = (level: number, station: number, x: number) => {
    if (station < 0 || station >= PROFILE_STATIONS) return;
    const i = level * PROFILE_STATIONS + station;
    if (!(starboard[i] >= x)) starboard[i] = x;
    if (!(port[i] >= -x)) port[i] = -x;
  };
  segments.forEach((list, level) => {
    for (let i = 0; i < list.length; i += 4) {
      const [x0, z0, x1, z1] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
      record(level, Math.round((z0 - start) / spacing), x0);
      record(level, Math.round((z1 - start) / spacing), x1);
      const first = Math.ceil((Math.min(z0, z1) - start) / spacing), last = Math.floor((Math.max(z0, z1) - start) / spacing);
      for (let station = first; station <= last; station++) {
        const z = start + station * spacing;
        record(level, station, x0 + (x1 - x0) * (z - z0) / (z1 - z0 || 1));
      }
    }
  });
  let halfBeam = 0;
  for (let i = 0; i < size; i++) halfBeam = Math.max(halfBeam, starboard[i] || 0, port[i] || 0);
  const ends = (level: number) => {
    let bow = Infinity, stern = -Infinity;
    for (let station = 0; station < PROFILE_STATIONS; station++) if (!Number.isNaN(starboard[level * PROFILE_STATIONS + station])) {
      bow = Math.min(bow, start + station * spacing); stern = Math.max(stern, start + station * spacing);
    }
    return { bow, stern };
  };
  const design = ends(middle);
  return { start, spacing, halfBeam, starboard, port, starboardSide: sideHeights(tops[0], starboard), portSide: sideHeights(tops[1], port),
    bow: Number.isFinite(design.bow) ? design.bow : zMin, stern: Number.isFinite(design.stern) ? design.stern : zMax };

  /** Per station, the highest point standing at one side: within SIDE_SHARE of the station's widest half-breadth, over
   * the bins the station spans. Never below the highest level the side itself crosses; a median of three stations drops
   * a lone bridge wing or boom, which would otherwise stand in for a whole stretch of side. */
  function sideHeights(top: Float32Array, breadths: Float32Array): Float32Array {
    const heights = new Float32Array(PROFILE_STATIONS);
    for (let station = 0; station < PROFILE_STATIONS; station++) {
      let breadth = -Infinity, crossed = 0;
      for (let level = 0; level < PROFILE_LEVELS; level++) breadth = Math.max(breadth, breadths[level * PROFILE_STATIONS + station] || -Infinity);
      if (!(breadth > 0)) continue;
      for (let level = 0; level < PROFILE_LEVELS; level++) {
        if (breadths[level * PROFILE_STATIONS + station] >= breadth * SIDE_SHARE) crossed = Math.max(crossed, PROFILE_LOWEST + level * PROFILE_LEVEL_STEP);
      }
      const z = start + station * spacing, first = Math.max(0, Math.floor((z - spacing / 2 - binLow) / binSize)), last = Math.min(SIDE_BINS - 1, Math.floor((z + spacing / 2 - binLow) / binSize));
      const band = Math.min(SIDE_BANDS - 1, Math.floor(breadth * SIDE_SHARE / bandSize));
      let height = crossed;
      for (let bin = first; bin <= last; bin++) for (let b = band; b < SIDE_BANDS; b++) height = Math.max(height, top[bin * SIDE_BANDS + b]);
      heights[station] = height;
    }
    const median = heights.slice();
    for (let station = 1; station < PROFILE_STATIONS - 1; station++) {
      const [a, b, c] = [heights[station - 1], heights[station], heights[station + 1]];
      median[station] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    }
    return median;
  }
}

import * as THREE from 'three/webgpu';

type Pose = { object: THREE.Object3D; parent: THREE.Object3D; offset: THREE.Matrix4; moving: boolean };
/** Where a posed sphere can be for any joint angles, in the root's space before the root's own scale: every point of it lies
 * within `reach` of `pivot`, and three's world radius of it (radius times the pose's largest axis scale) is at most `radius`. */
export type PoseReach = { anchor: number; pivot: THREE.Vector3; reach: number; radius: number };

/** Relative and absolute allowances that keep every bound above its value through rounding. */
const MARGIN = 1 + 1e-6, SLACK = 1e-6;

/** Compile fixed assembly paths once. Rendering needs surface and moving-joint
 * world matrices; the retained hierarchy still supports ordinary full updates
 * for inspection, socket queries and decal projection.
 *
 * The fleet's batches defer the surfaces only they read (`defer`): `update` leaves those, and whoever needs one composes it,
 * with its moving ancestors, first (`ensure`). A deferred pose is composed from the same inputs in the same operations, so it
 * is the matrix `update` would have made; until then it keeps an older one. `complete` composes every pose.
 * `reach` bounds a subtree for any joint angles: joints may turn freely, one that also slides declares its `travel`
 * (clearing `bounded` if it ever goes further), and joint scales stay as loaded. */
export class ShipPoseMatrices {
  /** Off: three's multiply through each pose's objects, for comparison. */
  static flat = true;
  /** Off: `update` composes deferred poses as well, for comparison. */
  static deferring = true;
  /** False once a joint slid beyond its declared travel, which voids `reach`. */
  bounded = true;
  readonly poses: Pose[] = [];
  /** The poses again as the element arrays each multiply reads and writes, in pose order. */
  private readonly worlds: number[][] = [];
  private readonly parents: number[][] = [];
  private readonly offsets: number[][] = [];
  private readonly objects: THREE.Object3D[] = [];
  private readonly moving: boolean[] = [];
  /** Per pose: its moving parent's pose, or -1 below the root; the frame it was last composed in; whether it is deferred. */
  private readonly parentPose: Int32Array;
  private readonly stamps: Uint32Array;
  private readonly deferred: Uint8Array;
  private frame = 1;
  /** Poses `update` composes, in order: all of them, or those neither deferred nor only above deferred ones. */
  private readonly all: Int32Array;
  private eager: Int32Array;
  private readonly index = new Map<THREE.Object3D, number>();
  /** Per pose: its top-level joint (a moving pose right below the root), or -1 on the root's own chain. */
  private readonly anchors: Int32Array;
  /** Per moving pose, in its anchor's frame: how far its own frame's origin can be, and how much its frame can stretch. */
  private readonly distance: Float64Array;
  private readonly gain: Float64Array;
  /** Per anchor: its pivot at rest in the root's space, its frame's stretch there, and how far it can slide from that pivot. */
  private readonly pivots = new Map<number, THREE.Vector3>();
  private readonly anchorGain: Float64Array;
  private readonly anchorSlide: Float64Array;

  constructor(private readonly root: THREE.Group, model: THREE.Group, moving: Set<THREE.Object3D>, travel: ReadonlyMap<THREE.Object3D, number> = new Map()) {
    const parentPose: number[] = [];
    const visit = (object: THREE.Object3D, parent: THREE.Object3D, parentIndex: number, prefix: THREE.Matrix4) => {
      object.updateMatrix();
      const dynamic = moving.has(object);
      const offset = prefix.clone();
      if (!dynamic) offset.multiply(object.matrix);
      let index = parentIndex;
      if (dynamic || object instanceof THREE.Mesh) { index = this.poses.push({ object, parent, offset, moving: dynamic }) - 1; parentPose.push(parentIndex); }
      const next = dynamic ? new THREE.Matrix4() : offset;
      for (const child of object.children) visit(child, dynamic ? object : parent, dynamic ? index : parentIndex, next);
    };
    visit(model, root, -1, new THREE.Matrix4());
    for (const [i, { object, parent, offset, moving }] of this.poses.entries()) {
      this.worlds.push(object.matrixWorld.elements); this.parents.push(parent.matrixWorld.elements);
      this.offsets.push(offset.elements); this.objects.push(object); this.moving.push(moving); this.index.set(object, i);
    }
    const n = this.poses.length;
    this.parentPose = Int32Array.from(parentPose); this.stamps = new Uint32Array(n); this.deferred = new Uint8Array(n);
    this.all = Int32Array.from({ length: n }, (_, i) => i); this.eager = this.all;
    this.anchors = new Int32Array(n).fill(-1); this.distance = new Float64Array(n); this.gain = new Float64Array(n);
    this.anchorGain = new Float64Array(n); this.anchorSlide = new Float64Array(n);
    const point = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const { object, offset, moving } = this.poses[i], p = this.parentPose[i];
      if (!moving) { this.anchors[i] = p < 0 ? -1 : this.anchors[p]; continue; }
      // A joint turning about a pivot also moves its origin, which these bounds leave out.
      if ((object as { pivot?: THREE.Vector3 | null }).pivot) this.bounded = false;
      // The joint's own matrix turns (and may slide) about its position: bound it by its scale and its quaternion's length.
      const q = object.quaternion, stretch = Math.max(Math.abs(object.scale.x), Math.abs(object.scale.y), Math.abs(object.scale.z)) *
        (1 + 2 * Math.abs(1 - (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w))) * MARGIN;
      const slide = (travel.get(object) ?? 0) * MARGIN, span = operatorNorm(offset.elements) * MARGIN;
      point.copy(object.position).applyMatrix4(offset);
      if (p < 0) {
        this.anchors[i] = i; this.pivots.set(i, point.clone());
        this.anchorGain[i] = span * stretch; this.anchorSlide[i] = span * slide + SLACK; this.gain[i] = 1;
      } else {
        this.anchors[i] = this.anchors[p];
        this.distance[i] = (this.distance[p] + this.gain[p] * (point.length() + span * slide)) * MARGIN + SLACK;
        this.gain[i] = this.gain[p] * span * stretch;
      }
    }
  }

  update(): void {
    this.root.updateWorldMatrix(true, false);
    this.frame = this.frame + 1 >>> 0 || 1;
    const poses = ShipPoseMatrices.deferring ? this.eager : this.all;
    for (let k = 0; k < poses.length; k++) this.compose(poses[k]);
  }

  /** Compose pose `i`, and any moving ancestor, unless this frame's `update` or an earlier `ensure` already did. -1 is no pose. */
  ensure(i: number): void {
    const stamps = this.stamps, frame = this.frame;
    if (i < 0 || stamps[i] === frame) return;
    const p = this.parentPose[i];
    if (p >= 0 && stamps[p] !== frame) this.ensure(p);
    this.compose(i);
  }
  /** One pose from its parent's matrix, which is this frame's. */
  private compose(i: number): void {
    const object = this.objects[i];
    if (ShipPoseMatrices.flat) {
      const world = this.worlds[i];
      multiply(this.parents[i], this.offsets[i], world);
      if (this.moving[i]) { object.updateMatrix(); multiply(world, object.matrix.elements, world); }
    } else {
      const { parent, offset } = this.poses[i];
      object.matrixWorld.multiplyMatrices(parent.matrixWorld, offset);
      if (this.moving[i]) { object.updateMatrix(); object.matrixWorld.multiply(object.matrix); }
    }
    object.matrixWorldNeedsUpdate = false; this.stamps[i] = this.frame;
  }
  /** `ensure` for an object's pose; an object without one (a static node) is left alone. */
  ensureObject(object: THREE.Object3D): void {
    const i = this.index.get(object);
    if (i !== undefined) this.ensure(i);
  }
  /** Every pose as `update` composes it with nothing deferred. */
  complete(): void { for (let i = 0; i < this.all.length; i++) this.ensure(i); }
  /** Whether pose `i` holds this frame's matrix. */
  current(i: number): boolean { return this.stamps[i] === this.frame; }
  indexOf(object: THREE.Object3D): number { return this.index.get(object) ?? -1; }

  /** Leave these surfaces' poses to `ensure` (replacing any earlier set), with every joint above nothing but them. */
  defer(objects: Iterable<THREE.Object3D>): void {
    this.deferred.fill(0);
    // As `update` leaves every pose it composes: a deferred one is only ever composed again by `ensure`.
    for (const object of objects) { const i = this.index.get(object); if (i !== undefined && !this.moving[i]) { this.deferred[i] = 1; object.matrixWorldNeedsUpdate = false; } }
    // Poses list children after parents: a joint stays in `update` for any child that does, or when it has none at all.
    const eager = new Uint8Array(this.poses.length), children = new Uint8Array(this.poses.length);
    for (let i = this.poses.length - 1; i >= 0; i--) {
      if (!this.moving[i] ? !this.deferred[i] : eager[i] || !children[i]) eager[i] = 1;
      const p = this.parentPose[i];
      if (p >= 0) { children[p] = 1; if (eager[i]) eager[p] = 1; }
    }
    this.eager = this.all.filter(i => eager[i] === 1);
  }

  /** Bound a sphere of surface pose `i`'s local space for any joint angles (see `PoseReach`); `anchor` -1 is the root's own chain. */
  reach(i: number, center: THREE.Vector3, radius: number): PoseReach {
    const offset = this.offsets[i], p = this.parentPose[i], local = new THREE.Vector3().copy(center).applyMatrix4(this.poses[i].offset);
    const scale = Math.sqrt(Math.max(offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2],
      offset[4] * offset[4] + offset[5] * offset[5] + offset[6] * offset[6], offset[8] * offset[8] + offset[9] * offset[9] + offset[10] * offset[10]));
    if (p < 0) {
      const bound = radius * scale * MARGIN;
      return { anchor: -1, pivot: local, reach: bound * MARGIN + SLACK, radius: bound };
    }
    const anchor = this.anchors[p], gain = this.anchorGain[anchor];
    const bound = gain * this.gain[p] * scale * radius * MARGIN;
    const reach = (this.anchorSlide[anchor] + gain * (this.distance[p] + this.gain[p] * local.length()) + bound) * MARGIN + SLACK;
    return { anchor, pivot: this.pivots.get(anchor)!, reach, radius: bound };
  }
}

/** An upper bound on the largest stretch of the matrix's linear part: the square root of Gershgorin's bound on
 * the largest eigenvalue of Aᵀ A, which is exact for a rotation with any axis scales. */
export function operatorNorm(e: ArrayLike<number>): number {
  let largest = 0;
  for (let i = 0; i < 3; i++) {
    let row = 0;
    for (let j = 0; j < 3; j++) row += Math.abs(e[i * 4] * e[j * 4] + e[i * 4 + 1] * e[j * 4 + 1] + e[i * 4 + 2] * e[j * 4 + 2]);
    largest = Math.max(largest, row);
  }
  return Math.sqrt(largest);
}

/** `Matrix4.multiplyMatrices` on element arrays, term for term, so every product is the same double. `te` may be `ae`. */
function multiply(ae: number[], be: number[], te: number[]): void {
  const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
  const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
  const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
  const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
  const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
  const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
  const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
  const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
  te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41; te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43; te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41; te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43; te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41; te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43; te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41; te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43; te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
}

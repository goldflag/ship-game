import * as THREE from 'three/webgpu';

type Pose = { object: THREE.Object3D; parent: THREE.Object3D; offset: THREE.Matrix4; moving: boolean };

/** Compile fixed assembly paths once. Rendering needs surface and moving-joint
 * world matrices; the retained hierarchy still supports ordinary full updates
 * for inspection, socket queries and decal projection. */
export class ShipPoseMatrices {
  /** Off: three's multiply through each pose's objects, for comparison. */
  static flat = true;
  private readonly poses: Pose[] = [];
  /** The poses again as the element arrays each multiply reads and writes, in pose order. */
  private readonly worlds: number[][] = [];
  private readonly parents: number[][] = [];
  private readonly offsets: number[][] = [];
  private readonly objects: THREE.Object3D[] = [];
  private readonly moving: boolean[] = [];

  constructor(private readonly root: THREE.Group, model: THREE.Group, moving: Set<THREE.Object3D>) {
    const visit = (object: THREE.Object3D, parent: THREE.Object3D, prefix: THREE.Matrix4) => {
      object.updateMatrix();
      const dynamic = moving.has(object);
      const offset = prefix.clone();
      if (!dynamic) offset.multiply(object.matrix);
      if (dynamic || object instanceof THREE.Mesh) this.poses.push({ object, parent, offset, moving: dynamic });
      const next = dynamic ? new THREE.Matrix4() : offset;
      for (const child of object.children) visit(child, dynamic ? object : parent, next);
    };
    visit(model, root, new THREE.Matrix4());
    for (const { object, parent, offset, moving } of this.poses) {
      this.worlds.push(object.matrixWorld.elements); this.parents.push(parent.matrixWorld.elements);
      this.offsets.push(offset.elements); this.objects.push(object); this.moving.push(moving);
    }
  }

  update(): void {
    this.root.updateWorldMatrix(true, false);
    if (!ShipPoseMatrices.flat) {
      for (const { object, parent, offset, moving } of this.poses) {
        object.matrixWorld.multiplyMatrices(parent.matrixWorld, offset);
        if (moving) { object.updateMatrix(); object.matrixWorld.multiply(object.matrix); }
        object.matrixWorldNeedsUpdate = false;
      }
      return;
    }
    const { worlds, parents, offsets, objects, moving } = this;
    for (let i = 0; i < objects.length; i++) {
      multiply(parents[i], offsets[i], worlds[i]);
      const object = objects[i];
      if (moving[i]) { object.updateMatrix(); object.matrixWorld.multiply(object.matrix); }
      object.matrixWorldNeedsUpdate = false;
    }
  }
}

/** `Matrix4.multiplyMatrices` on element arrays, term for term, so every product is the same double. */
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

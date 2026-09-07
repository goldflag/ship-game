import * as THREE from 'three/webgpu';

type Pose = { object: THREE.Object3D; parent: THREE.Object3D; offset: THREE.Matrix4; moving: boolean };

/** Compile fixed assembly paths once. Rendering needs surface and moving-joint
 * world matrices; the retained hierarchy still supports ordinary full updates
 * for inspection, socket queries and decal projection. */
export class ShipPoseMatrices {
  private readonly poses: Pose[] = [];

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
  }

  update(): void {
    this.root.updateWorldMatrix(true, false);
    for (const { object, parent, offset, moving } of this.poses) {
      object.matrixWorld.multiplyMatrices(parent.matrixWorld, offset);
      if (moving) { object.updateMatrix(); object.matrixWorld.multiply(object.matrix); }
      object.matrixWorldNeedsUpdate = false;
    }
  }
}

import * as THREE from 'three/webgpu';
import type { ShipView } from './ShipView';

/** Flat render objects share geometry/materials with the retained authoring
 * hierarchy. CPU joints and decal receivers stay in that original hierarchy. */
export class ShipRenderProxy {
  readonly root = new THREE.Group();
  private readonly surfaces = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly marks = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly modelVisible: boolean;

  constructor(private readonly view: ShipView) {
    this.modelVisible = view.model.visible;
    this.root.name = `${view.root.name} render surfaces`;
    view.model.traverse(object => {
      if (object instanceof THREE.Mesh) this.surfaces.set(object, this.create(object));
    });
    view.model.visible = false;
  }

  static supports(view: ShipView): boolean {
    let supported = true;
    view.model.traverse(object => {
      if ((object instanceof THREE.Mesh && ((object as THREE.SkinnedMesh).isSkinnedMesh ||
        (object as THREE.InstancedMesh).isInstancedMesh || object.morphTargetInfluences?.length)) ||
        (object as THREE.Line).isLine || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite) supported = false;
    });
    return supported;
  }

  sourceVisible(source: THREE.Object3D): boolean {
    for (let object: THREE.Object3D | null = source; object; object = object.parent) {
      if (!(object === this.view.model ? this.modelVisible : object.visible)) return false;
    }
    return true;
  }

  private create(source: THREE.Mesh): THREE.Mesh {
    const proxy = new THREE.Mesh(source.geometry, source.material);
    proxy.name = source.name; proxy.matrixAutoUpdate = false;
    proxy.castShadow = source.castShadow; proxy.receiveShadow = source.receiveShadow;
    proxy.renderOrder = source.renderOrder;
    proxy.onBeforeRender = source.onBeforeRender; proxy.onAfterRender = source.onAfterRender;
    return proxy;
  }

  update(): void {
    for (const [source, proxy] of this.marks) if (!source.parent) {
      proxy.removeFromParent(); this.marks.delete(source);
    }
    for (const source of this.view.impactMarks.renderMeshes) if (!this.marks.has(source)) this.marks.set(source, this.create(source));
    for (const objects of [this.surfaces, this.marks]) for (const [source, proxy] of objects) {
      proxy.layers.mask = source.layers.mask;
      proxy.visible = source.layers.mask !== 0 && this.sourceVisible(source);
      if (proxy.visible) {
        if (proxy.parent !== this.root) this.root.add(proxy);
        proxy.matrix.copy(source.matrixWorld); proxy.matrixWorldNeedsUpdate = true;
      } else proxy.removeFromParent();
    }
  }

  dispose(): void {
    this.view.model.visible = this.modelVisible;
    this.root.clear(); this.root.removeFromParent();
    this.surfaces.clear(); this.marks.clear(); // Sources own all shared resources.
  }
}

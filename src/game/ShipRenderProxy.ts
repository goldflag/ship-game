import * as THREE from 'three/webgpu';
import type { ShipView } from './ShipView';

/** One flat copy of a source surface, with the world matrix and parenting last applied to it.
 * A surface that has not moved since the previous frame writes nothing at all. */
type Copy = { source: THREE.Mesh; proxy: THREE.Mesh; matrix: Float64Array; drawn: boolean };

/** Flat render objects share geometry/materials with the retained authoring
 * hierarchy. CPU joints and decal receivers stay in that original hierarchy. */
export class ShipRenderProxy {
  readonly root = new THREE.Group();
  /** Surfaces first, in traversal order, then live impact marks. */
  private readonly copies: Copy[] = [];
  private surfaceCount = 0;
  private readonly marks = new Map<THREE.Mesh, Copy>();
  private readonly modelVisible: boolean;
  private readonly markBounds = new THREE.Sphere();
  private readonly markCenter = new THREE.Vector3();

  constructor(private readonly view: ShipView) {
    this.modelVisible = view.model.visible;
    this.root.name = `${view.root.name} render surfaces`;
    view.model.traverse(object => {
      if (object instanceof THREE.Mesh) this.copies.push(this.create(object));
    });
    this.surfaceCount = this.copies.length;
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

  /** Ships share the cache within a frame: one walk per node, not one per surface. */
  sourceVisible(source: THREE.Object3D, cache?: Map<THREE.Object3D, boolean>): boolean {
    if (cache) {
      const known = cache.get(source);
      if (known !== undefined) return known;
      const visible = (source === this.view.model ? this.modelVisible : source.visible) &&
        (!source.parent || this.sourceVisible(source.parent, cache));
      cache.set(source, visible);
      return visible;
    }
    for (let object: THREE.Object3D | null = source; object; object = object.parent) {
      if (!(object === this.view.model ? this.modelVisible : object.visible)) return false;
    }
    return true;
  }

  private create(source: THREE.Mesh): Copy {
    const proxy = new THREE.Mesh(source.geometry, source.material);
    proxy.name = source.name; proxy.matrixAutoUpdate = false;
    proxy.castShadow = source.castShadow; proxy.receiveShadow = source.receiveShadow;
    proxy.renderOrder = source.renderOrder;
    proxy.onBeforeRender = source.onBeforeRender; proxy.onAfterRender = source.onAfterRender;
    // NaN never matches a real matrix, so the first frame always writes.
    return { source, proxy, matrix: new Float64Array(16).fill(NaN), drawn: false };
  }

  update(camera?: THREE.Camera, framebufferHeight = 1080, cache?: Map<THREE.Object3D, boolean>): void {
    for (let i = this.copies.length - 1; i >= this.surfaceCount; i--) {
      const retired = this.copies[i];
      if (retired.source.parent) continue;
      retired.proxy.removeFromParent(); this.marks.delete(retired.source); this.copies.splice(i, 1);
    }
    for (const source of this.view.impactMarks.renderMeshes) if (!this.marks.has(source)) {
      const copy = this.create(source); this.marks.set(source, copy); this.copies.push(copy);
    }
    for (const copy of this.copies) {
      const { source, proxy } = copy, mask = source.layers.mask;
      if (proxy.layers.mask !== mask) proxy.layers.mask = mask;
      // Only the shared ancestors are worth caching: a surface itself is asked about once.
      let visible = mask !== 0 && ((source as THREE.Object3D) === this.view.model ? this.modelVisible : source.visible) &&
        (!source.parent || this.sourceVisible(source.parent, cache));
      const diameter = source.userData.maximumMarkDiameter as number | undefined;
      if (visible && diameter !== undefined && camera && source.geometry.boundingSphere) {
        this.markBounds.copy(source.geometry.boundingSphere).applyMatrix4(source.matrixWorld);
        const depth = -this.markCenter.copy(this.markBounds.center).applyMatrix4(camera.matrixWorldInverse).z;
        const nearest = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? Math.max(.001, depth - this.markBounds.radius) : 1;
        const pixels = diameter * source.matrixWorld.getMaxScaleOnAxis() * Math.abs(camera.projectionMatrix.elements[5]) * framebufferHeight * .5 / nearest;
        // Retain every scar; binoculars restore it as soon as it resolves.
        if (pixels < .5) visible = false;
      }
      proxy.visible = visible;
      if (!visible) {
        if (copy.drawn) { proxy.removeFromParent(); copy.drawn = false; }
        continue;
      }
      const elements = source.matrixWorld.elements, applied = copy.matrix;
      if (copy.drawn) {
        // Translation moves first for anything under way; a static turret exits after three reads.
        if (applied[12] === elements[12] && applied[13] === elements[13] && applied[14] === elements[14] && same(applied, elements)) continue;
      } else { this.root.add(proxy); copy.drawn = true; }
      proxy.matrix.copy(source.matrixWorld); proxy.matrixWorldNeedsUpdate = true;
      applied.set(elements);
    }
  }

  dispose(): void {
    this.view.model.visible = this.modelVisible;
    this.root.clear(); this.root.removeFromParent();
    this.copies.length = 0; this.surfaceCount = 0; this.marks.clear(); // Sources own all shared resources.
  }
}

/** Rotation, scale and the homogeneous row; the translation is compared before this. */
function same(applied: Float64Array, elements: number[]): boolean {
  for (let i = 0; i < 12; i++) if (applied[i] !== elements[i]) return false;
  return applied[15] === elements[15];
}

import { REVISION, type Object3D } from 'three/webgpu';

type Projected = Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean; isLight?: boolean; isLOD?: boolean; isBundleGroup?: boolean };

/** Layers on which three's projection acts on the object itself: drawables, lights and LOD switches on
 * their own layers, and a bundle group on every layer, since three enters one whatever its layers.
 * Groups and plain nodes act only through their children. */
export function projectedLayers(object: Object3D): number {
  const o = object as Projected;
  if (o.isBundleGroup === true) return -1;
  return o.isMesh || o.isLine || o.isPoints || o.isSprite || o.isLight || o.isLOD ? object.layers.mask : 0;
}

/** One registered root's objects in pre-order, with each one's parent slot and the end of its subtree. */
export class Subtree {
  objects: Object3D[] = [];
  parent = new Int32Array(0);
  end = new Int32Array(0);
  /** Per slot: `projectedLayers` of the object as last read, and its union over the subtree, whatever the visibility. */
  own = new Int32Array(0);
  union = new Int32Array(0);
  /** Per slot: whether it and every ancestor are visible, as of the last `updateVisibility`. */
  visible = new Uint8Array(0);
  /** Bumped whenever `visible` changes: a new array, or any slot turning on or off. */
  visibleVersion = 0;
  /** Bumped by every rebuild; slots from an older version are void. */
  version = 0;
  /** Structure changed since the last rebuild: nothing below the root is published. */
  stale = true;
  layersStale = false;
  private slots?: Map<Object3D, number>;
  readonly listener = () => this.onChange?.(this);
  onChange?: (subtree: Subtree) => void;

  constructor(readonly root: Object3D) {}

  /** The object's slot, or -1 when it is not below the root. */
  slotOf(object: Object3D): number {
    this.slots ??= new Map(this.objects.map((o, i) => [o, i]));
    return this.slots.get(object) ?? -1;
  }

  rebuild(): void {
    const objects: Object3D[] = [], parents: number[] = [], ends: number[] = [];
    const visit = (object: Object3D, parent: number) => {
      const slot = objects.push(object) - 1; parents.push(parent); ends.push(0);
      for (const child of object.children) visit(child, slot);
      ends[slot] = objects.length;
    };
    visit(this.root, -1);
    this.objects = objects; this.parent = Int32Array.from(parents); this.end = Int32Array.from(ends);
    this.own = new Int32Array(objects.length); this.union = new Int32Array(objects.length); this.visible = new Uint8Array(objects.length);
    this.slots = undefined; this.version++; this.visibleVersion++; this.stale = false;
    this.computeLayers();
  }

  computeLayers(): void {
    const { objects, parent, own, union } = this;
    union.fill(0);
    for (let i = objects.length - 1; i >= 0; i--) {
      union[i] |= own[i] = projectedLayers(objects[i]);
      if (parent[i] >= 0) union[parent[i]] |= union[i];
    }
    this.layersStale = false;
  }

  /** Chain visibility of every slot, as three's traversal and the fleet's surface checks see it:
   * the object and all its ancestors, including those above the root. `substitute` reads as `substituteVisible`. */
  updateVisibility(substitute?: Object3D, substituteVisible = true): void {
    let above = true;
    for (let o = this.root.parent; o && above; o = o.parent) above = o === substitute ? substituteVisible : o.visible;
    const { objects, end, visible } = this, count = objects.length;
    let changed = false;
    for (let i = 0; i < count;) {
      const object = objects[i];
      // A visited slot's parent is visible: a hidden one's whole subtree is skipped.
      if ((object === substitute ? substituteVisible : object.visible) && (i > 0 || above)) { if (visible[i] !== 1) { visible[i] = 1; changed = true; } i++; }
      else for (const next = end[i]; i < next; i++) if (visible[i] !== 0) { visible[i] = 0; changed = true; }
    }
    if (changed) this.visibleVersion++;
  }
}

/** For every object below the registered roots, the union of the layers on which anything in its subtree
 * could act in three's projection, whatever the visibility. A subtree whose union misses a camera's layers
 * adds nothing to that camera's render list, so the projection and the shadow caster collection skip it.
 * Structure is watched through three's child events, which withdraw a root's entries until it is rebuilt.
 * Layers are read again only after `layersChanged`: the one owner that changes layers at run time (the
 * fleet's batched surfaces) compares each surface it sets with `Subtree.own` and reports a difference. */
export class SubtreeLayers {
  readonly subtrees: Subtree[] = [];
  private readonly published = new Map<Object3D, number>();
  private readonly withdraw = (subtree: Subtree) => {
    if (subtree.stale) return;
    subtree.stale = true;
    for (const object of subtree.objects) this.published.delete(object);
  };

  add(root: Object3D): Subtree {
    const subtree = new Subtree(root);
    subtree.onChange = this.withdraw;
    this.subtrees.push(subtree);
    return subtree;
  }

  /** Whether nothing at or below `object` can act in a projection for `layers`. */
  skips(object: Object3D, layers: number): boolean {
    const union = this.published.get(object);
    return union !== undefined && (union & layers) === 0;
  }

  layersChanged(subtree: Subtree): void { subtree.layersStale = true; }

  /** Rebuild the roots whose structure changed, read the layers of those that reported a change, and publish both. */
  refresh(): void {
    for (const subtree of this.subtrees) {
      if (subtree.stale) {
        for (const object of subtree.objects) { object.removeEventListener('childadded', subtree.listener); object.removeEventListener('childremoved', subtree.listener); }
        subtree.rebuild();
        for (const object of subtree.objects) { object.addEventListener('childadded', subtree.listener); object.addEventListener('childremoved', subtree.listener); }
      } else if (subtree.layersStale) subtree.computeLayers();
      else continue;
      const { objects, union } = subtree;
      for (let i = 0; i < objects.length; i++) this.published.set(objects[i], union[i]);
    }
  }

  /** Published entries that disagree with a fresh walk of their root; empty when every skip is exact. */
  verify(): string[] {
    const errors: string[] = [];
    const visit = (object: Object3D): number => {
      let union = projectedLayers(object);
      for (const child of object.children) union |= visit(child);
      const published = this.published.get(object);
      if (published !== undefined && published !== union) errors.push(`${object.name || object.type} published ${published}, holds ${union}`);
      return union;
    };
    for (const subtree of this.subtrees) visit(subtree.root);
    return errors;
  }

  dispose(): void {
    for (const subtree of this.subtrees) for (const object of subtree.objects) {
      object.removeEventListener('childadded', subtree.listener); object.removeEventListener('childremoved', subtree.listener);
    }
    this.subtrees.length = 0; this.published.clear();
  }
}

/** A renderer's subtree skipping: the layers index it consults, and a switch for comparisons. */
export class SubtreePruning {
  enabled = true;
  subtrees?: SubtreeLayers;
  skips(object: Object3D, layers: number): boolean { return this.enabled && !!this.subtrees?.skips(object, layers); }
}

type Projector = (object: Object3D, camera: { layers: { mask: number } }, groupOrder: number, renderList: unknown, clippingContext: unknown) => void;
const prunings = new WeakMap<object, SubtreePruning>();

/** The renderer's pruning, installed on first use. Pinned three r185 walks every object below the scene
 * in each scene render (`Renderer._projectObject`), entering subtrees that hold nothing on the camera's
 * layers; a skipped subtree is one in which no object passes three's layer test, so the render list, its
 * lights and every LOD switch are exactly what the full walk produces. Another revision is left alone. */
export function subtreePruning(renderer: object): SubtreePruning {
  let pruning = prunings.get(renderer);
  if (pruning) return pruning;
  prunings.set(renderer, pruning = new SubtreePruning());
  const target = renderer as { _projectObject?: Projector }, original = target._projectObject;
  if (REVISION === '185' && typeof original === 'function') {
    const active = pruning;
    target._projectObject = function (this: unknown, object, camera, groupOrder, renderList, clippingContext) {
      if (active.enabled && active.subtrees?.skips(object, camera.layers.mask)) return;
      return original.call(this, object, camera, groupOrder, renderList, clippingContext);
    };
  }
  return pruning;
}

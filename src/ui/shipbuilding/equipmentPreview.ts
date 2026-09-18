import { createConstructionWallModel } from '../../game/constructionWallModel';
import { wallScale } from '../../ships/constructionWallFittings';
import { paintConstructionFitting } from '../../game/constructionFittingPaint';
import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionEquipment, ConstructionSource, ConstructionPropellerSupport, ConstructionSurface } from '../../ships/blueprint';
import { constructionEquipmentModelUrl } from '../../ships/constructionEquipment';
import { createConstructionPathModel } from '../../game/constructionPathModel';
import { loadShipModel } from '../../game/loadShipModel';
import { disposeConstructionModel } from '../../game/constructionModel';
import { createConstructionPropellerSupports } from '../../game/constructionPropellerModel';

type Template = { model: THREE.Group; ghost: THREE.Group; ghostMaterials: THREE.Material[]; invalid: THREE.Group; invalidMaterials: THREE.Material[] };

/** Assets belong to this viewport, not to a compiled hull revision. Instances and
 * drag previews borrow their buffers; only disposing the cache releases them. */
export class EquipmentPreview {
  readonly group = new THREE.Group();
  private painted = new Map<string, { model: THREE.Group; materials: THREE.Material[] }>();
  private templates = new Map<string, Template>();
  private requests = new Map<string, AbortController>();
  private instances = new Map<string, THREE.Group>();
  private catalog?: ConstructionCatalog;
  private dead = false;
  private supports = new THREE.Group();
  private supportKey = '';
  private faded = new Map<THREE.Material, THREE.Material>();
  private originals = new WeakMap<THREE.Material, THREE.Material>();

  setDisplay(display: 'paint' | 'armor' | 'internals', source: ConstructionSource, catalog: ConstructionCatalog) {
    const internal = new Set(source.construction.equipment.filter(item => catalog.equipment.find(part => part.id === item.partId)?.placement === 'internal').map(item => item.id));
    this.group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const fade = display === 'armor' || display === 'internals' && !internal.has(node.userData.sourceId);
      const material = (current: THREE.Material) => {
        const original = this.originals.get(current) ?? current;
        if (!fade) return original;
        let faded = this.faded.get(original);
        if (!faded) {
          faded = original.clone(); faded.transparent = true; faded.opacity = original.opacity * .12; faded.depthWrite = false;
          this.faded.set(original, faded); this.originals.set(faded, original);
          original.addEventListener('dispose', () => { this.faded.get(original)?.dispose(); this.faded.delete(original); });
        }
        return faded;
      };
      node.material = Array.isArray(node.material) ? node.material.map(material) : material(node.material);
    });
  }

  constructor(private changed: () => void, private failed: (message: string) => void) {}

  private wallSurfaces?: readonly ConstructionSurface[];
  private surfaceRevision = 0;

  private key(partId: string) {
    const part = this.catalog?.equipment.find(part => part.id === partId);
    return part && `${this.catalog!.revision}:${part.id}:${part.contentHash}`;
  }

  ensure(partId: string) {
    const part = this.catalog?.equipment.find(part => part.id === partId), key = this.key(partId);
    if (!part || part.path || !key || this.templates.has(key) || this.requests.has(key)) return;
    const abort = new AbortController(); this.requests.set(key, abort);
    void loadShipModel(constructionEquipmentModelUrl(part), undefined, part.contentHash, abort.signal).then(asset => {
      if (this.dead || abort.signal.aborted) { disposeConstructionModel(asset.scene); return; }
      if (asset.scene.userData.definitionHash !== part.contentHash) {
        disposeConstructionModel(asset.scene); throw new Error(`Equipment identity mismatch: ${part.name}.`);
      }
      const ghost = asset.scene.clone(true), materials = new Map<THREE.Material, THREE.Material>();
      ghost.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const tint = (original: THREE.Material) => {
          let material = materials.get(original);
          if (!material) {
            material = original.clone(); material.transparent = true; material.opacity = .42; material.depthWrite = false;
            if ('color' in material) (material.color as THREE.Color).lerp(new THREE.Color('#e0c58d'), .5);
            materials.set(original, material);
          }
          return material;
        };
        node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
      });
      const invalid = asset.scene.clone(true), invalidMaterials = new Map<THREE.Material, THREE.Material>();
      invalid.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const tint = (original: THREE.Material) => {
          let material = invalidMaterials.get(original);
          if (!material) {
            material = original.clone();
            if ('color' in material) (material.color as THREE.Color).set('#ffb5a6');
            if ('emissive' in material) (material.emissive as THREE.Color).set('#8a2018');
            invalidMaterials.set(original, material);
          }
          return material;
        };
        node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
      });
      this.templates.set(key, { model: asset.scene, ghost, ghostMaterials: [...materials.values()], invalid, invalidMaterials: [...invalidMaterials.values()] });
      this.failed(''); this.changed();
    }).catch(error => {
      if (!this.dead && !abort.signal.aborted) this.failed(`Equipment preview: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  clone(partId: string, ghost = false, path?: ConstructionEquipment['path'], invalid = false, paint?: string, mount?: {item: ConstructionEquipment; surfaces: readonly ConstructionSurface[]}): THREE.Group | undefined {
    const part = this.catalog?.equipment.find(part => part.id === partId);
    if (part?.path) {
      const model = createConstructionPathModel(part, path, ghost, mount);
      if (!ghost && !invalid) paintConstructionFitting(model, paint, false);
      if (invalid) model.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if ('color' in material) (material.color as THREE.Color).set('#ffb5a6');
        }
      });
      return model;
    }
    this.ensure(partId);
    const key = this.key(partId), template = key && this.templates.get(key);
    if (!template) return undefined;
    let base = ghost ? template.ghost : invalid ? template.invalid : template.model;
    if (paint && !ghost && !invalid) {
      const paintKey = `${key}:${paint}`;
      let painted = this.painted.get(paintKey);
      if (!painted) {
        const model = template.model.clone(true);
        painted = { model, materials: paintConstructionFitting(model, paint) };
        this.painted.set(paintKey, painted);
      }
      base = painted.model;
    }
    const clone = base.clone(true);
    clone.traverse(node => { node.userData.sharedPreviewResources = true; });
    return clone;
  }

  private restoreMaterials() {
    this.group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const restore = (material: THREE.Material) => this.originals.get(material) ?? material;
      node.material = Array.isArray(node.material) ? node.material.map(restore) : restore(node.material);
    });
  }

  update(source: ConstructionSource, catalog: ConstructionCatalog, supports?: ConstructionPropellerSupport[], invalid: ReadonlySet<string> = new Set(), surfaces: readonly ConstructionSurface[] = []) {
    this.restoreMaterials();
    if (this.catalog && this.catalog.revision !== catalog.revision) this.clear();
    this.catalog = catalog;
    const supportKey = JSON.stringify(supports ?? []);
    if (supportKey !== this.supportKey) {
      disposeConstructionModel(this.supports);
      this.supports = createConstructionPropellerSupports(supports);
      if (this.supports.children.length) this.group.add(this.supports);
      this.supportKey = supportKey;
    }
    if (this.wallSurfaces !== surfaces) { this.wallSurfaces=surfaces; this.surfaceRevision++; }
    const ids = new Set(source.construction.equipment.map(item => item.id));
    for (const [id, instance] of this.instances) if (!ids.has(id)) { instance.removeFromParent(); if (instance.userData.path) disposeConstructionModel(instance); this.instances.delete(id); }
    for (const item of source.construction.equipment) {
      let instance = this.instances.get(item.id);
      const path = this.catalog.equipment.find(part => part.id === item.partId)?.path;
      const key = `${item.wall || path?.kind === 'ladder' ? JSON.stringify([item, this.surfaceRevision]) : ''}:${this.key(item.partId)}${path ? ':' + JSON.stringify(item.path) : ''}:${invalid.has(item.id)}:${item.paint ?? ''}`;
      if (instance && instance.userData.assetKey !== key) { instance.removeFromParent(); if (instance.userData.path) disposeConstructionModel(instance); this.instances.delete(item.id); instance = undefined; }
      if (!instance) {
        let model = this.clone(item.partId, false, item.path, invalid.has(item.id), item.paint, {item,surfaces});
        const part = catalog.equipment.find(p => p.id === item.partId);
        if (model && item.wall && part) model = createConstructionWallModel(model, part, item, surfaces, source.construction.primitives);
        if (!model) continue;
        instance = new THREE.Group(); instance.name = item.id;
        instance.userData = { sourceId: item.id, assetKey: key, path: !!path || !!item.wall };
        model.traverse(node => { node.userData.sourceId = item.id; });
        instance.add(model); this.instances.set(item.id, instance); this.group.add(instance);
      }
      const part = catalog.equipment.find(p => p.id === item.partId);
      if (part && !item.wall) instance.scale.fromArray(wallScale(part, item));
      instance.position.set(...item.position); instance.rotation.y = -item.bearingDeg * Math.PI / 180;
    }
    this.group.updateMatrixWorld(true);
  }

  has(id: string) { return this.instances.has(id); }

  private clear() {
    this.restoreMaterials();
    this.faded.forEach(material => material.dispose()); this.faded.clear();
    disposeConstructionModel(this.supports); this.supportKey = '';
    this.requests.forEach(abort => abort.abort()); this.requests.clear();
    for (const instance of this.instances.values()) if (instance.userData.path) disposeConstructionModel(instance);
    this.group.clear(); this.instances.clear();
    for (const template of this.templates.values()) {
      disposeConstructionModel(template.model);
      template.ghostMaterials.forEach(material => material.dispose());
      template.invalidMaterials.forEach(material => material.dispose());
    }
    this.templates.clear();
    for (const painted of this.painted.values()) painted.materials.forEach(material => material.dispose());
    this.painted.clear();
  }

  dispose() { this.dead = true; this.clear(); }
}

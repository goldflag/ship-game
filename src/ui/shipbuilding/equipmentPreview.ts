import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionEquipment, ConstructionSource, ConstructionPropellerSupport } from '../../ships/blueprint';
import { constructionEquipmentModelUrl } from '../../ships/constructionEquipment';
import { createConstructionPathModel } from '../../game/constructionPathModel';
import { loadShipModel } from '../../game/loadShipModel';
import { disposeConstructionModel } from '../../game/constructionModel';
import { createConstructionPropellerSupports } from '../../game/constructionPropellerModel';

type Template = { model: THREE.Group; ghost: THREE.Group; ghostMaterials: THREE.Material[] };

/** Assets belong to this viewport, not to a compiled hull revision. Instances and
 * drag previews borrow their buffers; only disposing the cache releases them. */
export class EquipmentPreview {
  readonly group = new THREE.Group();
  private templates = new Map<string, Template>();
  private requests = new Map<string, AbortController>();
  private instances = new Map<string, THREE.Group>();
  private catalog?: ConstructionCatalog;
  private dead = false;
  private supports = new THREE.Group();
  private supportKey = '';

  constructor(private changed: () => void, private failed: (message: string) => void) {}

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
      this.templates.set(key, { model: asset.scene, ghost, ghostMaterials: [...materials.values()] });
      this.failed(''); this.changed();
    }).catch(error => {
      if (!this.dead && !abort.signal.aborted) this.failed(`Equipment preview: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  clone(partId: string, ghost = false, path?: ConstructionEquipment['path']): THREE.Group | undefined {
    const part = this.catalog?.equipment.find(part => part.id === partId);
    if (part?.path) return createConstructionPathModel(part, path, ghost);
    this.ensure(partId);
    const key = this.key(partId), template = key && this.templates.get(key);
    if (!template) return undefined;
    const clone = (ghost ? template.ghost : template.model).clone(true);
    clone.traverse(node => { node.userData.sharedPreviewResources = true; });
    return clone;
  }

  update(source: ConstructionSource, catalog: ConstructionCatalog, supports?: ConstructionPropellerSupport[]) {
    if (this.catalog && this.catalog.revision !== catalog.revision) this.clear();
    this.catalog = catalog;
    const supportKey = JSON.stringify(supports ?? []);
    if (supportKey !== this.supportKey) {
      disposeConstructionModel(this.supports);
      this.supports = createConstructionPropellerSupports(supports);
      if (this.supports.children.length) this.group.add(this.supports);
      this.supportKey = supportKey;
    }
    const ids = new Set(source.construction.equipment.map(item => item.id));
    for (const [id, instance] of this.instances) if (!ids.has(id)) { instance.removeFromParent(); if (instance.userData.path) disposeConstructionModel(instance); this.instances.delete(id); }
    for (const item of source.construction.equipment) {
      let instance = this.instances.get(item.id);
      const path = this.catalog.equipment.find(part => part.id === item.partId)?.path;
      const key = `${this.key(item.partId)}${path ? ':' + JSON.stringify(item.path) : ''}`;
      if (instance && instance.userData.assetKey !== key) { instance.removeFromParent(); if (instance.userData.path) disposeConstructionModel(instance); this.instances.delete(item.id); instance = undefined; }
      if (!instance) {
        const model = this.clone(item.partId, false, item.path);
        if (!model) continue;
        instance = new THREE.Group(); instance.name = item.id;
        instance.userData = { sourceId: item.id, assetKey: key, path: !!path };
        model.traverse(node => { node.userData.sourceId = item.id; });
        instance.add(model); this.instances.set(item.id, instance); this.group.add(instance);
      }
      instance.position.set(...item.position); instance.rotation.y = -item.bearingDeg * Math.PI / 180;
    }
    this.group.updateMatrixWorld(true);
  }

  has(id: string) { return this.instances.has(id); }

  private clear() {
    disposeConstructionModel(this.supports); this.supportKey = '';
    this.requests.forEach(abort => abort.abort()); this.requests.clear();
    for (const instance of this.instances.values()) if (instance.userData.path) disposeConstructionModel(instance);
    this.group.clear(); this.instances.clear();
    for (const template of this.templates.values()) {
      disposeConstructionModel(template.model);
      template.ghostMaterials.forEach(material => material.dispose());
    }
    this.templates.clear();
  }

  dispose() { this.dead = true; this.clear(); }
}

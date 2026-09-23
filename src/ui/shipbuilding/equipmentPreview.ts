import { createConstructionWallModel } from '../../game/constructionWallModel';
import { wallScale } from '../../ships/constructionWallFittings';
import { paintConstructionFitting } from '../../game/constructionFittingPaint';
import { constructionFittingPaint } from '../../ships/constructionPaints';
import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionEquipment, ConstructionSource, ConstructionPropellerSupport, ConstructionSurface, ConstructionSurfaceFinish } from '../../ships/blueprint';
import { constructionEquipmentModelUrl } from '../../ships/constructionEquipment';
import { createConstructionPathModel } from '../../game/constructionPathModel';
import { createConstructionFittingModel } from '../../game/constructionFittingModel';
import { customFittingDefinitionOfPart } from '../../ships/constructionCustomFittings';
import { loadShipModel } from '../../game/loadShipModel';
import { disposeConstructionModel } from '../../game/constructionModel';
import { createConstructionPropellerSupports } from '../../game/constructionPropellerModel';
import { armorThicknessColor, FIXED_ARMOR_SCALE, type ArmorScale } from '../../ships/inspection';
import { gunPartOf, turretArmor, type TurretArmor } from './turretArmor';

const TURRET_ARMOR = 'turret-armor';
/** One triangle per catalog plate, in order, so a ray's face index names the plate it struck. */
function turretArmorMesh(armor: TurretArmor, scale: ArmorScale) {
  const positions: number[] = [], colors: number[] = [], color = new THREE.Color();
  for (const plate of armor.plates) {
    color.set(armorThicknessColor(plate.thicknessMm, scale));
    for (const vertex of plate.vertices) { positions.push(...vertex); colors.push(color.r, color.g, color.b); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.name = TURRET_ARMOR;
  // Plate edges where the enclosure folds, drawn like the hull's creases.
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: '#142a31', transparent: true, opacity: .9, depthWrite: false })));
  return mesh;
}
function disposeOverlay(mesh: THREE.Mesh) {
  mesh.traverse(node => { if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); } });
}

type Template = { model: THREE.Group; ghost: THREE.Group; ghostMaterials: THREE.Material[]; invalid: THREE.Group; invalidMaterials: THREE.Material[] };

/** Assets belong to this viewport, not to a compiled hull revision. Instances and
 * drag previews borrow their buffers; only disposing the cache releases them. */
export class EquipmentPreview {
  readonly group = new THREE.Group();
  private painted = new Map<string, { model: THREE.Group; materials: THREE.Material[] }>();
  private templates = new Map<string, Template>();
  /** Design-local fittings drawn from their definitions; instances and ghosts borrow these buffers. */
  private custom = new Map<string, THREE.Group>();
  private requests = new Map<string, AbortController>();
  private instances = new Map<string, THREE.Group>();
  private catalog?: ConstructionCatalog;
  private dead = false;
  private supports = new THREE.Group();
  private supportKey = '';
  private faded = new Map<THREE.Material, THREE.Material>();
  private originals = new WeakMap<THREE.Material, THREE.Material>();
  private tinted = new Map<string, THREE.Material>();

  /** Armor view: plated gunhouses show their fixed catalog plates on the ship's thickness scale over a faded model;
   * open mounts and casemates, whose catalog armor covers the whole mount, take that thickness's colour. */
  setDisplay(display: 'paint' | 'armor' | 'internals', source: ConstructionSource, catalog: ConstructionCatalog, armorScale: ArmorScale = FIXED_ARMOR_SCALE) {
    const internal = new Set(source.construction.equipment.filter(item => catalog.equipment.find(part => part.id === item.partId)?.placement === 'internal').map(item => item.id));
    const armored = new Map<string, TurretArmor>();
    for (const item of display === 'armor' ? source.construction.equipment : []) {
      const gun = gunPartOf(catalog, item.partId);
      if (gun) armored.set(item.id, turretArmor(gun));
    }
    for (const [id, instance] of this.instances) {
      const armor = armored.get(id), key = armor?.plates.length ? `${armorScale.fromMm}-${armorScale.toMm}` : '';
      let overlay = instance.getObjectByName(TURRET_ARMOR) as THREE.Mesh | undefined;
      if (overlay && overlay.userData.key !== key) { overlay.removeFromParent(); disposeOverlay(overlay); overlay = undefined; }
      if (!overlay && armor && key) { overlay = turretArmorMesh(armor, armorScale); overlay.userData.key = key; overlay.userData.sourceId = id; instance.add(overlay); }
    }
    this.group.traverse(node => {
      if (!(node instanceof THREE.Mesh) || node.name === TURRET_ARMOR) return;
      const armor = armored.get(node.userData.sourceId), whole = armor && !armor.plates.length;
      if (whole) {
        // update() has just restored the originals; keep them on the node while the shared tint stands in.
        const color = armorThicknessColor(armor.armorMm, armorScale);
        let tinted = this.tinted.get(color);
        if (!tinted) { tinted = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }); this.tinted.set(color, tinted); }
        node.userData.armorOriginal ??= node.material; node.material = tinted;
        return;
      }
      if (node.userData.armorOriginal) { node.material = node.userData.armorOriginal; delete node.userData.armorOriginal; }
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

  /** The turret plate (or whole-mount armor) nearest along the ray, for the Armor view's hover reading. */
  armorHit(ray: THREE.Raycaster, source: ConstructionSource, catalog: ConstructionCatalog): { distance: number; equipmentId: string; name: string; thicknessMm: number; plated: boolean } | undefined {
    const targets: THREE.Object3D[] = [];
    for (const [id, instance] of this.instances) {
      const item = source.construction.equipment.find(entry => entry.id === id), gun = item && gunPartOf(catalog, item.partId);
      if (!gun) continue;
      const overlay = instance.getObjectByName(TURRET_ARMOR);
      if (overlay) targets.push(overlay); else instance.traverse(node => { if (node instanceof THREE.Mesh) targets.push(node); });
    }
    const hit = ray.intersectObjects(targets, false)[0];
    const id = hit?.object.userData.sourceId as string | undefined, item = id ? source.construction.equipment.find(entry => entry.id === id) : undefined;
    const gun = item && gunPartOf(catalog, item.partId), part = item && catalog.equipment.find(entry => entry.id === item.partId);
    if (!hit || !id || !gun || !part) return undefined;
    const armor = turretArmor(gun), plate = hit.object.name === TURRET_ARMOR ? armor.plates[hit.faceIndex ?? -1] : undefined;
    return { distance: hit.distance, equipmentId: id, name: part.name, thicknessMm: plate?.thicknessMm ?? armor.armorMm, plated: !!plate };
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
    if (!part || part.path || customFittingDefinitionOfPart(part) || !key || this.templates.has(key) || this.requests.has(key)) return;
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

  clone(partId: string, ghost = false, path?: ConstructionEquipment['path'], invalid = false, paint?: string, mount?: {item: ConstructionEquipment; surfaces: readonly ConstructionSurface[]}, finish?: ConstructionSurfaceFinish): THREE.Group | undefined {
    const part = this.catalog?.equipment.find(part => part.id === partId);
    const definition = customFittingDefinitionOfPart(part);
    if (definition) {
      // No published GLB: the one fitting builder draws the definition.
      const cacheKey = `${this.key(partId)}|${ghost ? 'ghost' : invalid ? 'invalid' : `${paint ?? ''}:${finish ?? ''}`}`;
      let base = this.custom.get(cacheKey);
      if (!base) {
        base = createConstructionFittingModel(definition, { ghost, finish });
        if (!ghost && !invalid) paintConstructionFitting(base, paint, false, finish);
        if (invalid) base.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          const material = node.material as THREE.MeshStandardMaterial;
          material.color.set('#ffb5a6'); material.emissive.set('#8a2018');
        });
        this.custom.set(cacheKey, base);
      }
      const clone = base.clone(true);
      clone.traverse(node => { node.userData.sharedPreviewResources = true; });
      return clone;
    }
    if (part?.path) {
      const model = createConstructionPathModel(part, path, ghost, mount);
      if (!ghost && !invalid) paintConstructionFitting(model, paint, false, finish, part.path.kind === 'rope' ? mount?.item.paint : undefined);
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
    if ((paint || finish) && !ghost && !invalid) {
      const paintKey = `${key}:${paint ?? ''}${finish ? ':' + finish : ''}`;
      let painted = this.painted.get(paintKey);
      if (!painted) {
        const model = template.model.clone(true);
        painted = { model, materials: paintConstructionFitting(model, paint, true, finish) };
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
      if (!(node instanceof THREE.Mesh) || node.name === TURRET_ARMOR) return;
      if (node.userData.armorOriginal) { node.material = node.userData.armorOriginal; delete node.userData.armorOriginal; return; }
      const restore = (material: THREE.Material) => this.originals.get(material) ?? material;
      node.material = Array.isArray(node.material) ? node.material.map(restore) : restore(node.material);
    });
  }

  update(source: ConstructionSource, catalog: ConstructionCatalog, supports?: ConstructionPropellerSupport[], invalid: ReadonlySet<string> = new Set(), surfaces: readonly ConstructionSurface[] = []) {
    this.restoreMaterials();
    if (this.catalog && this.catalog.revision !== catalog.revision) this.clear();
    this.catalog = catalog;
    const supportKey = JSON.stringify([supports ?? [], source.construction.finish]);
    if (supportKey !== this.supportKey) {
      disposeConstructionModel(this.supports);
      this.supports = createConstructionPropellerSupports(supports, source.construction.finish);
      if (this.supports.children.length) this.group.add(this.supports);
      this.supportKey = supportKey;
    }
    if (this.wallSurfaces !== surfaces) { this.wallSurfaces=surfaces; this.surfaceRevision++; }
    const ids = new Set(source.construction.equipment.map(item => item.id));
    for (const [id, instance] of this.instances) if (!ids.has(id)) { instance.removeFromParent(); if (instance.userData.path) disposeConstructionModel(instance); this.instances.delete(id); }
    for (const item of source.construction.equipment) {
      let instance = this.instances.get(item.id);
      const catalogPart = this.catalog.equipment.find(part => part.id === item.partId), path = catalogPart?.path;
      const paint = path?.kind === 'rope' ? item.paint : constructionFittingPaint(source, item, catalogPart);
      const key = `${item.wall || path?.kind === 'ladder' ? JSON.stringify([item, this.surfaceRevision]) : ''}:${this.key(item.partId)}${path ? ':' + JSON.stringify(item.path) : ''}:${invalid.has(item.id)}:${paint ?? ''}${source.construction.finish ? ':' + source.construction.finish : ''}`;
      if (instance && instance.userData.assetKey !== key) { instance.removeFromParent(); if (instance.userData.path) disposeConstructionModel(instance); this.instances.delete(item.id); instance = undefined; }
      if (!instance) {
        let model = this.clone(item.partId, false, item.path, invalid.has(item.id), paint, {item,surfaces}, source.construction.finish);
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
    // Drawings of definitions that changed or left the design.
    const current = new Set(catalog.equipment.filter(part => customFittingDefinitionOfPart(part)).map(part => this.key(part.id)));
    for (const [key, model] of this.custom) if (!current.has(key.slice(0, key.indexOf('|')))) { disposeConstructionModel(model); this.custom.delete(key); }
    this.group.updateMatrixWorld(true);
  }

  has(id: string) { return this.instances.has(id); }

  private clear() {
    this.restoreMaterials();
    this.faded.forEach(material => material.dispose()); this.faded.clear();
    this.tinted.forEach(material => material.dispose()); this.tinted.clear();
    this.group.traverse(node => { if (node.name === TURRET_ARMOR) disposeOverlay(node as THREE.Mesh); });
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
    for (const model of this.custom.values()) disposeConstructionModel(model);
    this.custom.clear();
    for (const painted of this.painted.values()) painted.materials.forEach(material => material.dispose());
    this.painted.clear();
  }

  dispose() { this.dead = true; this.clear(); }
}

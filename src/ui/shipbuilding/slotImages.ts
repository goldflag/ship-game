import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionPrimitive, Vec3 } from '../../ships/blueprint';
import { constructionEquipmentModelUrl } from '../../ships/constructionEquipment';
import { loadShipModel } from '../../game/loadShipModel';
import { constructionPaintColor } from './paints';
import { CORNER_SIGNS } from '../../ships/constructionVertex';
import { primitiveGeometry } from './primitiveGeometry';
import type { SlotItem } from './builderLayers';

/** Device pixels per card image; cards are 64 CSS px, so this stays crisp on 2× displays. */
const SIZE = 128;
/** The viewport's default orbit heading, so a card shows the piece the way it first appears in the scene. */
const HEADING = new THREE.Vector3(1, .7, -1.15).normalize();
/** Finished images outlive the editor: reopening it never renders a card twice. */
const baked = new Map<string, string>();

export function slotImageKey(item: SlotItem, catalog: ConstructionCatalog): string | undefined {
  if (item.kind === 'shape') return `shape:${item.shape.kind}:${item.shape.size.join('x')}`;
  if (item.kind === 'part') return `part:${catalog.revision}:${item.part.id}:${item.part.contentHash}`;
  return undefined;
}

function shapeModel(kind: ConstructionPrimitive['kind'], size: Vec3): THREE.Object3D {
  const geometry = primitiveGeometry(kind, size), group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: constructionPaintColor('naval-gray'), roughness: .78, metalness: 0 })));
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: '#dfe7e4', transparent: true, opacity: .55 })));
  if (kind === 'vertex') group.add(...cornerHandles(size));
  return group;
}

/** A fresh vertex hull is a cube, so its card wears the editor's corner handles: a light square with a
 * dark rim on all eight corners, drawn over the piece the way the on-screen handles are. */
function cornerHandles(size: Vec3): THREE.Object3D[] {
  const side = Math.max(...size) * .15, box = (scale: number) => new THREE.BoxGeometry(side * scale, side * scale, side * scale);
  const rim = new THREE.MeshBasicMaterial({ color: '#1f2225', depthTest: false, depthWrite: false }), face = new THREE.MeshBasicMaterial({ color: '#edf1ec', depthTest: false, depthWrite: false });
  return CORNER_SIGNS.map(sign => {
    const handle = new THREE.Group(); handle.position.set(sign[0] * size[0] / 2, sign[1] * size[1] / 2, sign[2] * size[2] / 2);
    const outline = new THREE.Mesh(box(1.5), rim), square = new THREE.Mesh(box(1), face); outline.renderOrder = 1; square.renderOrder = 2;
    handle.add(outline, square); return handle;
  });
}

async function partModel(part: ConstructionEquipmentPart, signal: AbortSignal): Promise<THREE.Object3D> {
  const asset = await loadShipModel(constructionEquipmentModelUrl(part), undefined, part.contentHash, signal);
  return asset.scene;
}

function dispose(object: THREE.Object3D) {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
  object.clear();
}

/** Palette cards show the piece itself. One offscreen context renders each hull
 * shape and catalog part from its real geometry, one at a time, in the scene's light. */
export class SlotImages {
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 4000);
  private tasks = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();
  private abort = new AbortController();
  private disposed = false;

  constructor() {
    this.scene.add(new THREE.HemisphereLight('#edf0f2', '#595c5f', 2.6));
    const sun = new THREE.DirectionalLight('#fff2d2', 3); sun.position.set(-80, 150, -120); this.scene.add(sun);
  }

  /** Resolves to a PNG data URL, or is undefined for items that are colors or tools. */
  get(item: SlotItem, catalog: ConstructionCatalog): Promise<string> | undefined {
    const key = slotImageKey(item, catalog);
    if (!key) return undefined;
    const ready = baked.get(key);
    if (ready) return Promise.resolve(ready);
    const pending = this.tasks.get(key);
    if (pending) return pending;
    const task = this.queue.then(async () => {
      if (this.disposed) throw new Error('The palette closed before rendering.');
      const object = item.kind === 'shape' ? shapeModel(item.shape.kind, item.shape.size) : await partModel((item as Extract<SlotItem, { kind: 'part' }>).part, this.abort.signal);
      try {
        if (this.disposed) throw new Error('The palette closed before rendering.');
        const image = this.render(object); baked.set(key, image); return image;
      } finally { dispose(object); }
    });
    this.queue = task.catch(() => {});
    this.tasks.set(key, task);
    task.catch(() => this.tasks.delete(key));
    return task;
  }

  private context() {
    if (!this.renderer) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE, false); renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer = renderer;
    }
    return this.renderer;
  }

  /** Frames the object's bounds exactly in a square, with a small margin. */
  private render(object: THREE.Object3D): string {
    const renderer = this.context();
    this.scene.add(object); object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) { this.scene.remove(object); throw new Error('The model has no geometry to render.'); }
    const center = box.getCenter(new THREE.Vector3());
    this.camera.position.copy(center).addScaledVector(HEADING, 1000);
    this.camera.up.set(0, 1, 0); this.camera.lookAt(center); this.camera.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const corner = new THREE.Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x); minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    }
    const half = (Math.max(maxX - minX, maxY - minY) / 2 || 1) * 1.06, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.camera.left = cx - half; this.camera.right = cx + half; this.camera.top = cy + half; this.camera.bottom = cy - half;
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
    const image = renderer.domElement.toDataURL('image/png');
    this.scene.remove(object);
    return image;
  }

  dispose() {
    this.disposed = true; this.abort.abort(); this.tasks.clear();
    this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer = undefined;
  }
}

/** Requests an image for every item that can have one and re-renders as each arrives. */
export function useSlotImages(images: SlotImages, items: SlotItem[], catalog: ConstructionCatalog): (item: SlotItem) => string | undefined {
  const [, arrived] = useState(0);
  useEffect(() => {
    let active = true;
    for (const item of items) {
      const key = slotImageKey(item, catalog);
      if (!key || baked.has(key)) continue;
      images.get(item, catalog)?.then(() => { if (active) arrived(count => count + 1); }).catch(() => {});
    }
    return () => { active = false; };
  }, [items, catalog, images]);
  return item => { const key = slotImageKey(item, catalog); return key ? baked.get(key) : undefined; };
}

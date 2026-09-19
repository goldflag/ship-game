import * as THREE from 'three';
import type { ConstructionSurface, Vec3 } from '../../../ships/blueprint';

export const BRASS = '#e0c58d',
  BRASS_LIGHT = '#efd5a0',
  MINT = '#86e4c5',
  READY = '#94d9bf',
  SALMON = '#ffb5a6',
  IVORY = '#edf1ec';

/** Two-letter tag for a center-of-gravity or center-of-buoyancy dot, drawn over the ship like the dot itself. */
export function centerTag(text: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.font = '600 44px Barlow, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 8;
  context.strokeStyle = 'rgba(10, 16, 20, .85)';
  context.strokeText(text, 64, 34);
  context.fillStyle = color;
  context.fillText(text, 64, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
  tag.name = `${text} tag`;
  return tag;
}

export function release(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (child.userData.sharedPreviewResources) return;
    if (child instanceof THREE.InstancedMesh) child.dispose();
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
  object.clear();
}

export function fan(surface: ConstructionSurface, position: number[], colors?: number[], color?: THREE.Color) {
  for (let i = 1; i < surface.vertices.length - 1; i++)
    for (const vertex of [surface.vertices[0], surface.vertices[i], surface.vertices[i + 1]]) {
      position.push(...vertex);
      if (colors && color) colors.push(color.r, color.g, color.b);
    }
}

/** A translucent sector on the water, clockwise bearings from the bow (−Z). */
export function arcMesh(arc: { bearingDeg: number; traverseDeg: number; radius: number; color: string }): THREE.Group {
  const traverse = (Math.min(180, Math.max(0, arc.traverseDeg)) * Math.PI) / 180,
    bearing = (arc.bearingDeg * Math.PI) / 180;
  const shape = new THREE.Shape();
  if (traverse >= Math.PI - 1e-6) shape.absarc(0, 0, arc.radius, 0, Math.PI * 2, false);
  else {
    shape.moveTo(0, 0);
    shape.absarc(0, 0, arc.radius, Math.PI / 2 - bearing - traverse, Math.PI / 2 - bearing + traverse, false);
    shape.closePath();
  }
  const group = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 48),
    new THREE.MeshBasicMaterial({ color: arc.color, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }),
  );
  const points = shape.getPoints(48).map((point) => new THREE.Vector3(point.x, point.y, 0));
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: arc.color, transparent: true, opacity: 0.7 }),
  );
  group.add(fill, edge);
  group.rotation.x = -Math.PI / 2;
  group.renderOrder = 5;
  return group;
}

export const same = (a: Vec3, b: Vec3) => a.every((value, index) => Math.abs(value - b[index]) < 1e-6);
export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const signedMetres = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Number(Math.abs(value).toFixed(2))}`;

/** The ray from the camera through a pointer position over the canvas. */
export function pointerRay(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement, camera: THREE.Camera) {
  const bounds = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, (-(event.clientY - bounds.top) / bounds.height) * 2 + 1),
    camera,
  );
  return ray;
}

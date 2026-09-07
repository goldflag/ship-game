import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original runtime recipe, metres / -Z nose. Provisional visual ordnance, not a historical reconstruction. */
export function aircraftOrdnanceGeometry(kind: 'bomb' | 'torpedo'): THREE.BufferGeometry {
  const bomb = kind === 'bomb';
  const length = bomb ? 1.55 : 4.1, radius = bomb ? .175 : .285;
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, color: string) => {
    const tint = new THREE.Color(color), colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(geometry);
  };
  const profile = [[0, -.5], [.3, -.45], [.5, -.3], [.95, -.16], [1, .22], [.86, .35], [.52, .45], [0, .5]];
  add(new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r * radius, z * length)), 20).rotateX(-Math.PI / 2), bomb ? '#626849' : '#6e7774');
  // Thin crossed tail vanes and a box tail keep a recognizable silhouette during the dive.
  const tail = length * .34, finLength = length * .26, span = radius * 2.9;
  for (const angle of [0, Math.PI / 2]) {
    add(new THREE.BoxGeometry(span, .018, finLength).translate(0, 0, tail).rotateZ(angle), bomb ? '#50583e' : '#545e5b');
  }
  if (bomb) {
    for (let side = 0; side < 4; side++) add(new THREE.BoxGeometry(span, .018, finLength * .65)
      .translate(0, span / 2, tail + finLength * .08).rotateZ(side * Math.PI / 2), '#50583e');
    add(new THREE.CylinderGeometry(radius * .99, radius * .99, .042, 20, 1, true)
      .rotateX(Math.PI / 2).translate(0, 0, -.28), '#c4a554');
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}

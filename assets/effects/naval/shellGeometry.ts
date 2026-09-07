import * as THREE from 'three/webgpu';

/** Original illustrative naval projectile, in calibers, +Y forward.
 * Shared by blueprint-authored guns; not a reconstruction of a specific round. */
export function shellGeometry(detailed = true): THREE.LatheGeometry {
  // Recessed tracer cup, beveled heel, two engraved driving bands, bourrelet,
  // cap joint and a curved ogive. All fittings are part of the closed profile.
  const profile: [number, number][] = [
    [0, -1.88], [.15, -1.88], [.17, -1.92], [.17, -2.05],
    [.36, -2.05], [.43, -2.01], [.48, -1.88], [.49, -1.66],
    [.5, -1.64], [.515, -1.61], [.515, -1.55], [.503, -1.54],
    [.503, -1.51], [.515, -1.5], [.515, -1.44], [.5, -1.41],
    [.49, -1.39], [.49, -1.26], [.515, -1.24], [.515, -1.18],
    [.503, -1.17], [.503, -1.14], [.515, -1.13], [.515, -1.07],
    [.49, -1.04], [.49, .45], [.5, .48], [.5, .63], [.488, .66],
    [.488, .73], [.48, .75], [.48, .78], [.488, .8],
  ];
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    profile.push([.488 * (1 - t ** 1.65), .8 + 1.55 * t]);
  }
  const silhouette = [[0, -2.05], [.36, -2.05], [.48, -1.88], [.49, -1.64], [.51, -1.61], [.51, -1.07], [.49, -1.04], [.49, .8],
    ...profile.slice(32).filter((_, i) => i % 4 === 3)];
  const geometry = new THREE.LatheGeometry((detailed ? profile : silhouette).map(([r, y]) => new THREE.Vector2(r, y)), detailed ? 48 : 12);
  const positions = geometry.getAttribute('position'), colors = new Float32Array(positions.count * 3);
  const steel = new THREE.Color('#6c7779'), cap = new THREE.Color('#8c9492');
  const copper = new THREE.Color('#b77b46'), groove = new THREE.Color('#68442d');
  const recess = new THREE.Color('#292d2b'), brass = new THREE.Color('#b7a16f');
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const band = (y > -1.65 && y < -1.4) || (y > -1.25 && y < -1.05);
    const radius = Math.hypot(x, z), angle = Math.atan2(x, z);
    color.copy(band ? (radius < .51 ? groove : copper)
      : y < -1.87 && radius < .18 ? recess : y < -2.02 ? brass : y > .77 ? cap : steel);
    // Fine longitudinal engraving in the copper and subtle machining on steel.
    const finish = band ? .88 + .12 * Math.cos(angle * 24 + y * 3) : .96 + .04 * Math.sin(y * 180);
    color.multiplyScalar(finish).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

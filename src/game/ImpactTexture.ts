import * as THREE from 'three/webgpu';

/** Original procedural paint loss, exposed steel and soot; no reference textures. */
export function impactTexture(): THREE.DataTexture {
  const size = 192, data = new Uint8Array(size * size * 4 * 4);
  for (let tile = 0; tile < 4; tile++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const angle = Math.atan2(v, u), r = Math.hypot(u, v);
    const grain = ((Math.imul(x + tile * 137, 374761393) ^ Math.imul(y, 668265263)) >>> 0) / 4294967295;
    const edge = .035 * Math.sin(angle * 13 + tile) + .025 * Math.sin(angle * 23 - tile);
    let radius = r + edge, alpha = 0, value = 30;
    if (tile === 2) radius = Math.hypot(u, v * (1.2 + .35 * u)) + edge; // Scored grazing strike.
    const soot = Math.max(0, 1 - radius / .95);
    alpha = soot * soot * (tile === 3 ? 1.6 : .8) * (.7 + grain * .3);
    const core = tile === 3 ? .16 : .31, rim = core + .15;
    if (radius < rim) {
      alpha = Math.max(alpha, Math.min(1, (rim - radius) * 28));
      const lighting = .5 + .5 * Math.sin(angle - .7);
      value = 68 + lighting * 110 + grain * 35;
      // The stopped projectile leaves a closed steel dish; a penetration is dark inside.
      if (radius < core) value = tile === 0 ? 9 + grain * 9 : tile === 1 ? 150 + lighting * 65 + grain * 20
        : tile === 2 ? 95 + grain * 72 : 22 + grain * 18;
    }
    // Radial tears / fine fragment scoring break up the circular paint boundary.
    const scar = Math.pow(Math.max(0, Math.sin(angle * (tile === 3 ? 31 : 17) + radius * 9)), 28);
    if (radius > rim && radius < .84) alpha = Math.max(alpha, scar * (.84 - radius) * (tile === 3 ? 1.1 : .55));
    const i = (y * size * 4 + tile * size + x) * 4;
    data[i] = value; data[i + 1] = value * .97; data[i + 2] = value * .9;
    data[i + 3] = Math.min(255, Math.round(alpha * 255));
  }
  const texture = new THREE.DataTexture(data, size * 4, size, THREE.RGBAFormat);
  texture.name = 'Original shell impact atlas'; texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

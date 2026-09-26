import * as THREE from 'three/webgpu';

/** The ocean renders several targets: float scene depth and integer auxiliary
 * depth. WebGPU requires each viewport copy to use its source target's format. */
export class EffectDepthTextureNode extends THREE.ViewportDepthTextureNode {
  override getTextureForReference(reference: THREE.RenderTarget | THREE.CanvasTarget | null = null): THREE.Texture {
    const texture = super.getTextureForReference(reference);
    const source = reference && 'depthTexture' in reference ? reference.depthTexture : null;
    const type = source?.type ?? THREE.UnsignedIntType;
    if (texture.type !== type) { texture.type = type; texture.needsUpdate = true; }
    return texture;
  }
}

/** Original periodic Worley volumes, following Sky Pro's coarse-shape / fine-erosion approach: the noise that animates ship-fire
 * flame tongues (`fireFlameMaterial`). Smoke and fire gas are baked puffs instead (`GasAtlas`). */
export function effectVolumeTexture(): THREE.Data3DTexture {
  const size = 32, pixels = new Uint8Array(size ** 3 * 4);
  const hash = (x: number, y: number, z: number, seed: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
    return n - Math.floor(n);
  };
  const worley = (x: number, y: number, z: number, cells: number) => {
    x *= cells; y *= cells; z *= cells;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let distance = 3;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const wx = (cx + cells) % cells, wy = (cy + cells) % cells, wz = (cz + cells) % cells;
      const px = cx + hash(wx, wy, wz, 1) - x;
      const py = cy + hash(wx, wy, wz, 2) - y;
      const pz = cz + hash(wx, wy, wz, 3) - z;
      distance = Math.min(distance, px * px + py * py + pz * pz);
    }
    return Math.max(0, 1 - Math.sqrt(distance));
  };
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = ((z * size + y) * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] = Math.round(worley((x + .5) / size, (y + .5) / size, (z + .5) / size, 4 * (channel + 1)) * 255);
    }
    pixels[i + 3] = 255;
  }
  const map = new THREE.Data3DTexture(pixels, size, size, size);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = map.wrapR = THREE.RepeatWrapping;
  map.unpackAlignment = 1; map.needsUpdate = true;
  return map;
}

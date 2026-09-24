/** The textures the terrain draws from: the field's heights, gradients, surface attributes and sunlight, a
 * procedural noise tile, and detail photographs of rock, grass, sand and snow packed into one texture. */
import * as THREE from 'three/webgpu';
import { assetUrl } from '../../assetUrl';
import { NOISE_SIZE, terrainNoise } from './TerrainNoise';

/** Heights in metres for the vertex shader, read texel by texel and interpolated exactly as `Heightfield.height`. */
export function heightTexture(heights: Float32Array, columns: number, rows: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(heights, columns, rows, THREE.RedFormat, THREE.FloatType);
  Object.assign(texture, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false, name: 'Terrain heights' });
  texture.needsUpdate = true;
  return texture;
}

/** Filtered data over the field's samples, mip-mapped so distant slopes average their detail. */
function sampledData(data: ArrayBufferView, columns: number, rows: number, format: THREE.PixelFormat, type: THREE.TextureDataType, name: string, mipmaps = true): THREE.DataTexture {
  const texture = new THREE.DataTexture(data as Uint8Array, columns, rows, format, type);
  Object.assign(texture, { magFilter: THREE.LinearFilter, minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, generateMipmaps: mipmaps,
    anisotropy: mipmaps ? 8 : 1, name });
  texture.needsUpdate = true;
  return texture;
}

/** Surface gradients (∂h/∂x, ∂h/∂z) as half floats: the smooth normal of every pixel. */
export const gradientTexture = (halves: Uint16Array, columns: number, rows: number) =>
  sampledData(halves, columns, rows, THREE.RGFormat, THREE.HalfFloatType, 'Terrain gradients');
/** Open sky, relief and coast distance (`surfaceAttributes`), on its coarser grid. */
export const attributeTexture = (bytes: Uint8Array, columns: number, rows: number) =>
  sampledData(bytes, columns, rows, THREE.RGBAFormat, THREE.UnsignedByteType, 'Terrain attributes');
/** The sun's visibility over the land (`sunVisibility`); rewritten in place when the sun moves. */
export const sunTexture = (bytes: Uint8Array, columns: number, rows: number) =>
  sampledData(bytes, columns, rows, THREE.RedFormat, THREE.UnsignedByteType, 'Terrain sunlight', false);

/** The noise tile (`terrainNoise`), repeating. */
export function noiseTexture(): THREE.DataTexture {
  const texture = sampledData(terrainNoise(), NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType, 'Terrain noise');
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Aerial photographs whose luminance becomes one channel each of the detail texture, with the metres one repeat of
 * each covers on the ground (Poly Haven's own measurements). All CC0; see public/harbor/ASSETS.md and
 * public/terrain/ASSETS.md. */
export const DETAIL_LAYERS = [
  { name: 'rock', url: 'harbor/rock-color.jpg', metres: 50 },
  { name: 'grass', url: 'harbor/ground-color.jpg', metres: 15 },
  { name: 'sand', url: 'terrain/sand-color.jpg', metres: 30 },
  { name: 'snow', url: 'terrain/snow-color.jpg', metres: 80 },
] as const;
export const DETAIL_SIZE = 1024;

let packed: Promise<Uint8Array | undefined> | undefined;

/** Luminance of each layer, normalised to its mean (0.5 is the mean; a texel twice as bright as the mean is 1). */
async function packDetail(): Promise<Uint8Array | undefined> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return undefined;
  const size = DETAIL_SIZE, out = new Uint8Array(size * size * 4);
  const canvas = new OffscreenCanvas(size, size), context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  const images = await Promise.all(DETAIL_LAYERS.map(async layer => {
    const response = await fetch(assetUrl(layer.url));
    if (!response.ok) throw new Error(`Unable to load the ${layer.name} terrain detail.`);
    return createImageBitmap(await response.blob());
  }));
  images.forEach((image, channel) => {
    context.drawImage(image, 0, 0, size, size);
    image.close();
    const pixels = context.getImageData(0, 0, size, size).data;
    const luminance = new Float32Array(size * size);
    let total = 0;
    for (let i = 0; i < luminance.length; i++) {
      const value = .2126 * pixels[i * 4] + .7152 * pixels[i * 4 + 1] + .0722 * pixels[i * 4 + 2];
      luminance[i] = value; total += value;
    }
    const mean = total / luminance.length || 1;
    for (let i = 0; i < luminance.length; i++) out[i * 4 + channel] = Math.min(255, Math.round(luminance[i] / mean * 127.5));
  });
  return out;
}

/** The detail texture: neutral (every channel at its mean) until the photographs load, then their luminance. The
 * packed bytes are kept for the page, so a later battle uploads them at once. */
export function detailTexture(): THREE.DataTexture {
  const data = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4).fill(128);
  const texture = sampledData(data, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType, 'Terrain detail');
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  let disposed = false;
  texture.addEventListener('dispose', () => { disposed = true; });
  packed ??= packDetail().catch(error => { console.warn(error); packed = undefined; return undefined; });
  void packed.then(bytes => {
    if (!bytes || disposed || !texture.image) return;
    (texture.image.data as Uint8Array).set(bytes);
    texture.needsUpdate = true;
  });
  return texture;
}

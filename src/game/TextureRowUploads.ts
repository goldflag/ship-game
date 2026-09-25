import { REVISION, type DataTexture } from 'three/webgpu';
import { effectUploads } from './InstanceUploads';

/** Three r185 uploads a data texture's whole image at every version, however little of it changed: an aircraft parts batch's pose
 * texture (up to 64 airframes' parts, 40–75 KB) for the few rows its flying aircraft rewrote. A writer that knows which rows it
 * changed flags them here after writing, and the backend hook below writes only those rows to a GPU texture that already holds
 * the rest. Anything else (the texture's first upload, a new or resized GPU texture, a version that moved after the rows were
 * flagged, `effectUploads.versioned` off) takes three's own whole upload. */

type TextureInternals = DataTexture & { image: { data: ArrayBufferView; width: number; height: number } };
type GpuTexture = { readonly width: number; readonly height: number; readonly depthOrArrayLayers: number };
type Backend = {
  device?: { queue: { writeTexture(destination: object, data: ArrayBufferView, layout: object, size: object): void } };
  get?(resource: object): { texture?: GpuTexture };
  updateTexture?(texture: object, options: object): void;
};

/** Rows [from, to) changed since the texture's last upload, as of `version`. */
const pending = new WeakMap<object, { from: number; to: number; version: number }>();
const installed = new WeakSet<object>();
/** Bytes written as rows and rows' uploads, for diagnostics. */
export const textureRowStats = { rowUploads: 0, rowBytes: 0, wholeUploads: 0 };

/** Rows [from, to) of `texture` were rewritten: flag it for upload (writers such as `BatchedMesh.setMatrixAt` already did) and keep
 * the rows until three uploads it, joined with any flagged since. Call after the frame's last write to the texture. */
export function flagTextureRows(texture: DataTexture, from: number, to: number): void {
  if (to <= from) return;
  texture.needsUpdate = true;
  const rows = pending.get(texture);
  if (rows) { rows.from = Math.min(rows.from, from); rows.to = Math.max(rows.to, to); rows.version = texture.version; }
  else pending.set(texture, { from, to, version: texture.version });
}

/** Write flagged rows instead of whole images through three r185's WebGPU backend (`backend.updateTexture`). */
export function installTextureRowUploads(value: object): void {
  const backend = value as Backend, update = backend.updateTexture, device = backend.device, get = backend.get;
  if (REVISION !== '185' || !update || !device || !get || installed.has(value)) return;
  installed.add(value);
  /** GPU textures three has filled whole since they were made. */
  const filled = new WeakSet<GpuTexture>();
  backend.updateTexture = function (this: Backend, texture: object, options: object) {
    const rows = pending.get(texture), gpu = get.call(this, texture).texture;
    pending.delete(texture);
    const data = texture as TextureInternals, image = data.image, bytesPerRow = image?.data ? image.data.byteLength / image.height : 0;
    if (effectUploads.versioned && rows && rows.version === data.version && gpu && filled.has(gpu) && data.isDataTexture && !data.flipY && !data.mipmaps?.length
      && gpu.width === image.width && gpu.height === image.height && gpu.depthOrArrayLayers === 1 && Number.isInteger(bytesPerRow) && rows.to <= image.height) {
      const height = rows.to - rows.from;
      device.queue.writeTexture({ texture: gpu, mipLevel: 0, origin: { x: 0, y: rows.from, z: 0 } }, image.data,
        { offset: rows.from * bytesPerRow, bytesPerRow, rowsPerImage: height }, { width: image.width, height, depthOrArrayLayers: 1 });
      textureRowStats.rowUploads++; textureRowStats.rowBytes += height * bytesPerRow;
      return;
    }
    update.call(this, texture, options);
    textureRowStats.wholeUploads++;
    const made = get.call(this, texture).texture;
    if (made) filled.add(made);
  };
}

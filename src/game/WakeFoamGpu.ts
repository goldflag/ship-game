import * as THREE from 'three/webgpu';
import { attribute, dot, float, Fn, positionLocal, smoothstep, uv, vec2, vec4 } from 'three/tsl';
import { SLICK_EXTENT, WAKE_EXTENT, type WakeStampTarget } from './WakeFoam';

/** Retain the last rasterization for each tile, including its own refresh time. Each stamp keeps
 * (x, z, rightX, rightZ, width, length, strength, ring + 2 × channel). */
export class WakeStampCollector implements WakeStampTarget {
  values = new Float64Array(256 * 8);
  count = 0;
  centerX = 0; centerZ = 0;
  /** Centre of the slick channel's wider square (SLICK_EXTENT), laid over the same tile. */
  slickX = 0; slickZ = 0;
  /** Moves with every change to the stamps or their frame, so a painter can keep what it made of an unchanged tile. */
  version = 0;
  begin(x: number, z: number, slickX = x, slickZ = z): void { this.centerX = x; this.centerZ = z; this.slickX = slickX; this.slickZ = slickZ; this.clear(); }
  clear(): void { this.count = 0; this.version++; }
  reserve(count: number): void {
    if (count * 8 <= this.values.length) return;
    const values = new Float64Array(Math.max(count * 8, this.values.length * 2));
    values.set(this.values); this.values = values;
  }
  stamp(x: number, z: number, rightX: number, rightZ: number, width: number, length: number, strength: number, ring: boolean, channel: 0 | 1 = 0): void {
    this.reserve(this.count + 1);
    const offset = this.count++ * 8, values = this.values;
    values[offset] = x; values[offset + 1] = z; values[offset + 2] = rightX; values[offset + 3] = rightZ;
    values[offset + 4] = width; values[offset + 5] = length; values[offset + 6] = strength; values[offset + 7] = Number(ring) + 2 * channel;
    this.version++;
  }
}

/** One collector's painted quads (box, axes, shape: twelve floats each) for a tile, as of its `version`, and where they
 * sit in the instance buffers. */
interface WakeBlock { version: number; slot: number; count: number; start: number; data: Float32Array; seen: number }

/** Where a collector's channel lies in world space: its centre and the edge (m) of the square a tile covers. Channel
 * 0 (red) is the trail foam's WAKE_EXTENT square; channel 1 (green) the slick's SLICK_EXTENT square. */
export function stampFrame(collector: WakeStampCollector, channel: number): { x: number; z: number; extent: number } {
  return channel ? { x: collector.slickX, z: collector.slickZ, extent: SLICK_EXTENT } : { x: collector.centerX, z: collector.centerZ, extent: WAKE_EXTENT };
}

/** Paints stamp collectors into a coverage atlas of `tiles` × `tiles` squares, `resolution`
 * texels each, with collector `i` in tile (i % tiles, ⌊i / tiles⌋). Row 0 of the atlas is the
 * tile row the ocean samples first. With two channels, green holds each collector's slick. */
export interface WakeFoamPainter {
  readonly texture: THREE.Texture;
  /** Prepare for this many stamps across every collector (growth stays supported). */
  reserve(count: number): void;
  update(collectors: readonly WakeStampCollector[]): void;
  diagnostics(): Record<string, number>;
  dispose(): void;
}
export type WakeFoamPainterFactory = (resolution: number, tiles: number, channels?: 1 | 2) => WakeFoamPainter;

/** The game's painter: every atlas is drawn on the GPU by `renderer`. */
export const gpuWakeFoamPainter = (renderer: THREE.WebGPURenderer): WakeFoamPainterFactory =>
  (resolution, tiles, channels) => new WakeFoamGpu(renderer, resolution, tiles, channels);

/** Paint the same max-coverage ellipses into an atlas using native GPU blending.
 * It owns visual textures only; ship motion and wake history remain on the CPU. */
export class WakeFoamGpu implements WakeFoamPainter {
  readonly target: THREE.RenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly savedColor = new THREE.Color();
  private capacity = 0;
  private allocations = 0;
  private draws = 0;
  private count = 0;
  private boxes!: THREE.InstancedBufferAttribute;
  private axes!: THREE.InstancedBufferAttribute;
  private shapes!: THREE.InstancedBufferAttribute;
  /** Each collector's quads, reused while it and its tile are unchanged; buffers they already fill are left alone. */
  private readonly blocks = new Map<WakeStampCollector, WakeBlock>();
  private updates = 0;

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly resolution: number, private readonly tiles = 8, readonly channels: 1 | 2 = 1) {
    const size = resolution * tiles;
    this.target = new THREE.RenderTarget(size, size, { format: channels === 2 ? THREE.RGFormat : THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.target.texture.name = 'Fleet wake foam';
    const plane = new THREE.PlaneGeometry(2, 2), geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index; geometry.attributes = plane.attributes; geometry.instanceCount = 0;
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    material.toneMapped = false; material.fog = false;
    const box = attribute<'vec4'>('wakeBox', 'vec4'), axes = attribute<'vec4'>('wakeAxes', 'vec4'), shape = attribute<'vec4'>('wakeShape', 'vec4');
    // WebGPU texture rows run down from the top. Put atlas row zero at NDC +Y
    // so the water samples the tile and coordinates the stamps were laid in.
    material.vertexNode = vec4(box.xy.mul(vec2(1, -1)).add(positionLocal.xy.mul(box.zw)), 0, 1);
    material.fragmentNode = Fn(() => {
      // Flip stamp coordinates too, retaining the quad's front-facing winding.
      const local = uv().mul(2).sub(1).mul(vec2(1, -1));
      const across = dot(local, axes.xy).add(shape.x), along = dot(local, axes.zw).add(shape.y);
      const radius = across.mul(across).add(along.mul(along));
      const ring = radius.sqrt().sub(.75).div(.13).pow(2).negate().exp();
      // shape.w holds ring + 2 × channel. Max blending leaves the other channel as it was.
      const slick = shape.w.greaterThan(1.5), rim = shape.w.sub(slick.select(2, 0)).greaterThan(.5);
      const profile = rim.select(ring, float(1).sub(smoothstep(0, 1, radius)));
      const coverage = radius.lessThan(1).select(profile.mul(shape.z), 0);
      return vec4(slick.select(0, coverage), slick.select(coverage, 0), 0, 1);
    })();
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.frustumCulled = false;
    this.scene.name = 'Fleet wake raster'; this.scene.add(this.mesh); this.allocate(256);
  }

  private allocate(count: number): void {
    if (count <= this.capacity) return;
    this.allocations++;
    this.capacity = Math.max(count, this.capacity * 2);
    const previous = this.mesh.geometry, geometry = new THREE.InstancedBufferGeometry();
    geometry.index = previous.index;
    for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, previous.attributes[name]);
    for (const [name, field] of [['wakeBox', 'boxes'], ['wakeAxes', 'axes'], ['wakeShape', 'shapes']] as const) {
      this[field] = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, this[field]);
    }
    this.mesh.geometry = geometry; previous.dispose();
    // New buffers hold nothing yet.
    for (const block of this.blocks.values()) block.start = -1;
  }

  get texture(): THREE.Texture { return this.target.texture; }

  reserve(count: number): void { this.allocate(count); }

  /** Lay the collectors' quads end to end in slot order. A collector unchanged since the last update keeps its quads, and
   * where they already sit at the same place in the buffers nothing is written or uploaded again. */
  update(collectors: readonly WakeStampCollector[]): void {
    this.allocate(collectors.reduce((n, tile) => n + tile.count, 0));
    const boxes = this.boxes.array as Float32Array, axes = this.axes.array as Float32Array, shapes = this.shapes.array as Float32Array;
    const seen = ++this.updates;
    let count = 0, from = Infinity, to = 0;
    collectors.forEach((tile, slot) => {
      let block = this.blocks.get(tile);
      if (!block || block.version !== tile.version || block.slot !== slot) {
        block = this.paint(tile, slot, block);
        this.blocks.set(tile, block);
      }
      block.seen = seen;
      if (block.start !== count) {
        const data = block.data, n = block.count;
        for (let i = 0, j = count * 4; i < n; i++, j += 4) {
          const k = i * 12;
          boxes[j] = data[k]; boxes[j + 1] = data[k + 1]; boxes[j + 2] = data[k + 2]; boxes[j + 3] = data[k + 3];
          axes[j] = data[k + 4]; axes[j + 1] = data[k + 5]; axes[j + 2] = data[k + 6]; axes[j + 3] = data[k + 7];
          shapes[j] = data[k + 8]; shapes[j + 1] = data[k + 9]; shapes[j + 2] = data[k + 10]; shapes[j + 3] = data[k + 11];
        }
        block.start = count;
        if (n) { from = Math.min(from, count); to = count + n; }
      }
      count += block.count;
    });
    // A collector that left the list has lost its place in the buffers.
    for (const [tile, block] of this.blocks) if (block.seen !== seen) this.blocks.delete(tile);
    this.mesh.geometry.instanceCount = count;
    this.count = count; this.draws++;
    for (const attribute of [this.boxes, this.axes, this.shapes]) {
      attribute.clearUpdateRanges();
      if (to > from) { attribute.addUpdateRange(from * 4, (to - from) * 4); attribute.needsUpdate = true; }
    }
    const renderer = this.renderer, target = renderer.getRenderTarget(), clear = renderer.autoClear;
    const alpha = renderer.getClearAlpha(); renderer.getClearColor(this.savedColor);
    try {
      renderer.autoClear = true; renderer.setClearColor(0, 0); renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    } finally { renderer.setRenderTarget(target); renderer.autoClear = clear; renderer.setClearColor(this.savedColor, alpha); }
  }

  /** One collector's quads for its tile, rounded to the buffers' floats exactly as writing them there would. */
  private paint(tile: WakeStampCollector, slot: number, reuse?: WakeBlock): WakeBlock {
    const size = this.resolution * this.tiles, values = tile.values;
    const ox = slot % this.tiles * this.resolution, oy = Math.floor(slot / this.tiles) * this.resolution;
    const frames = [stampFrame(tile, 0), stampFrame(tile, 1)];
    let data = reuse?.data;
    if (!data || data.length < tile.count * 12) data = new Float32Array(Math.max(tile.count * 12, (data?.length ?? 0) * 2, 12 * 64));
    let count = 0;
    for (let i = 0; i < tile.count * 8; i += 8) {
      const x = values[i], z = values[i + 1], rightX = values[i + 2], rightZ = values[i + 3];
      const width = values[i + 4], length = values[i + 5], strength = values[i + 6], ring = values[i + 7];
      const frame = frames[ring > 1.5 ? 1 : 0], scale = this.resolution / frame.extent;
      const cx = (x - frame.x) * scale + this.resolution / 2 - .5;
      const cz = (z - frame.z) * scale + this.resolution / 2 - .5;
      const rx = (Math.abs(rightX) * width + Math.abs(rightZ) * length) * scale;
      const rz = (Math.abs(rightZ) * width + Math.abs(rightX) * length) * scale;
      const minX = Math.max(0, Math.floor(cx - rx)), maxX = Math.min(this.resolution - 1, Math.ceil(cx + rx));
      const minZ = Math.max(0, Math.floor(cz - rz)), maxZ = Math.min(this.resolution - 1, Math.ceil(cz + rz));
      if (minX > maxX || minZ > maxZ) continue;
      const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
      const dx = (centerX - cx) / scale, dz = (centerZ - cz) / scale;
      const halfX = (maxX - minX + 1) / 2, halfZ = (maxZ - minZ + 1) / 2, k = count++ * 12;
      data[k] = (ox + centerX + .5) / size * 2 - 1; data[k + 1] = (oy + centerZ + .5) / size * 2 - 1; data[k + 2] = halfX / size * 2; data[k + 3] = halfZ / size * 2;
      data[k + 4] = halfX / scale * rightX / width; data[k + 5] = halfZ / scale * rightZ / width;
      data[k + 6] = -halfX / scale * rightZ / length; data[k + 7] = halfZ / scale * rightX / length;
      data[k + 8] = (dx * rightX + dz * rightZ) / width; data[k + 9] = (-dx * rightZ + dz * rightX) / length; data[k + 10] = strength; data[k + 11] = ring;
    }
    return { version: tile.version, slot, count, start: -1, data, seen: 0 };
  }

  diagnostics() { return { capacity: this.capacity, allocations: this.allocations, draws: this.draws, stamps: this.count }; }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.target.dispose(); }
}

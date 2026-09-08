import * as THREE from 'three/webgpu';
import { attribute, dot, float, Fn, positionLocal, smoothstep, uv, vec4 } from 'three/tsl';
import { WAKE_EXTENT, type WakeStampTarget } from './WakeFoam';

/** Retain the last rasterization for each tile, including its own refresh time. */
export class WakeStampCollector implements WakeStampTarget {
  values = new Float64Array(256 * 8);
  count = 0;
  centerX = 0; centerZ = 0;
  begin(x: number, z: number): void { this.centerX = x; this.centerZ = z; this.clear(); }
  clear(): void { this.count = 0; }
  reserve(count: number): void {
    if (count * 8 <= this.values.length) return;
    const values = new Float64Array(Math.max(count * 8, this.values.length * 2));
    values.set(this.values); this.values = values;
  }
  stamp(x: number, z: number, rightX: number, rightZ: number, width: number, length: number, strength: number, ring: boolean): void {
    this.reserve(this.count + 1);
    const offset = this.count++ * 8, values = this.values;
    values[offset] = x; values[offset + 1] = z; values[offset + 2] = rightX; values[offset + 3] = rightZ;
    values[offset + 4] = width; values[offset + 5] = length; values[offset + 6] = strength; values[offset + 7] = Number(ring);
  }
}

/** Paint the same max-coverage ellipses into an atlas using native GPU blending.
 * It owns visual textures only; ship motion and wake history remain on the CPU. */
export class WakeFoamGpu {
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

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly resolution: number, private readonly tiles = 8) {
    const size = resolution * tiles;
    this.target = new THREE.RenderTarget(size, size, { format: THREE.RedFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.target.texture.name = 'Fleet wake foam';
    const plane = new THREE.PlaneGeometry(2, 2), geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index; geometry.attributes = plane.attributes; geometry.instanceCount = 0;
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    material.toneMapped = false; material.fog = false;
    const box = attribute<'vec4'>('wakeBox', 'vec4'), axes = attribute<'vec4'>('wakeAxes', 'vec4'), shape = attribute<'vec4'>('wakeShape', 'vec4');
    material.vertexNode = vec4(box.xy.add(positionLocal.xy.mul(box.zw)), 0, 1);
    material.fragmentNode = Fn(() => {
      const local = uv().mul(2).sub(1);
      const across = dot(local, axes.xy).add(shape.x), along = dot(local, axes.zw).add(shape.y);
      const radius = across.mul(across).add(along.mul(along));
      const ring = radius.sqrt().sub(.75).div(.13).pow(2).negate().exp();
      const profile = shape.w.greaterThan(.5).select(ring, float(1).sub(smoothstep(0, 1, radius)));
      const coverage = radius.lessThan(1).select(profile.mul(shape.z), 0);
      return vec4(coverage, 0, 0, 1);
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
  }

  reserve(count: number): void { this.allocate(count); }

  update(collectors: readonly WakeStampCollector[]): void {
    this.allocate(collectors.reduce((n, tile) => n + tile.count, 0));
    const scale = this.resolution / WAKE_EXTENT, size = this.resolution * this.tiles;
    let count = 0;
    collectors.forEach((tile, slot) => {
      const ox = slot % this.tiles * this.resolution, oy = Math.floor(slot / this.tiles) * this.resolution;
      for (let i = 0; i < tile.count * 8; i += 8) {
        const values = tile.values, x = values[i], z = values[i + 1], rightX = values[i + 2], rightZ = values[i + 3];
        const width = values[i + 4], length = values[i + 5], strength = values[i + 6], ring = values[i + 7];
        const cx = (x - tile.centerX) * scale + this.resolution / 2 - .5;
        const cz = (z - tile.centerZ) * scale + this.resolution / 2 - .5;
        const rx = (Math.abs(rightX) * width + Math.abs(rightZ) * length) * scale;
        const rz = (Math.abs(rightZ) * width + Math.abs(rightX) * length) * scale;
        const minX = Math.max(0, Math.floor(cx - rx)), maxX = Math.min(this.resolution - 1, Math.ceil(cx + rx));
        const minZ = Math.max(0, Math.floor(cz - rz)), maxZ = Math.min(this.resolution - 1, Math.ceil(cz + rz));
        if (minX > maxX || minZ > maxZ) continue;
        const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
        const dx = (centerX - cx) / scale, dz = (centerZ - cz) / scale;
        const halfX = (maxX - minX + 1) / 2, halfZ = (maxZ - minZ + 1) / 2;
        this.boxes.setXYZW(count, (ox + centerX + .5) / size * 2 - 1, (oy + centerZ + .5) / size * 2 - 1, halfX / size * 2, halfZ / size * 2);
        this.axes.setXYZW(count, halfX / scale * rightX / width, halfZ / scale * rightZ / width, -halfX / scale * rightZ / length, halfZ / scale * rightX / length);
        this.shapes.setXYZW(count, (dx * rightX + dz * rightZ) / width, (-dx * rightZ + dz * rightX) / length, strength, ring);
        count++;
      }
    });
    this.mesh.geometry.instanceCount = count;
    this.count = count; this.draws++;
    for (const attribute of [this.boxes, this.axes, this.shapes]) {
      attribute.clearUpdateRanges();
      if (count) { attribute.addUpdateRange(0, count * 4); attribute.needsUpdate = true; }
    }
    const renderer = this.renderer, target = renderer.getRenderTarget(), clear = renderer.autoClear;
    const alpha = renderer.getClearAlpha(); renderer.getClearColor(this.savedColor);
    try {
      renderer.autoClear = true; renderer.setClearColor(0, 0); renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    } finally { renderer.setRenderTarget(target); renderer.autoClear = clear; renderer.setClearColor(this.savedColor, alpha); }
  }

  diagnostics() { return { capacity: this.capacity, allocations: this.allocations, draws: this.draws, stamps: this.count }; }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.target.dispose(); }
}

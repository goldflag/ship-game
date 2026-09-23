import * as THREE from 'three/webgpu';
import type { EffectLighting } from './EffectLighting';
import { smokeRibbonMaterial } from './SmokeSpriteMaterial';

/** One released smoke sample along a plume, oldest first when handed to `SmokeRibbons.strip`. */
export interface RibbonPoint {
  position: THREE.Vector3;
  /** Full plume width in metres. */
  width: number;
  opacity: number;
  color: THREE.Color;
  /** Metres along the plume at release; anchors the turbulence to the smoke, not the ship. */
  along: number;
  age: number;
  /** Fraction of the sample's life spent (0–1); old smoke dissolves into patches. */
  spent: number;
}

const FLOATS = { position: 3, plumeSide: 3, plumeData: 4, plumeTint: 4, plumeSpent: 1 } as const;

/** Camera-facing plume strips for the whole fleet in one draw. Each strip is a continuous triangle
 * ribbon through released smoke samples; the material shades it as a lit, turbulent tube. Strips
 * seen end-on, or passing through the camera, thin out so they never fill the screen. */
export class SmokeRibbons {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly attributes: Record<keyof typeof FLOATS, THREE.BufferAttribute>;
  private readonly index: THREE.BufferAttribute;
  private vertices = 0;
  private indices = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly fallback = new THREE.Vector3();
  private near = .1;

  constructor(lighting: EffectLighting, readonly capacity = 32768) {
    const geometry = new THREE.BufferGeometry();
    this.attributes = Object.fromEntries(Object.entries(FLOATS).map(([name, size]) => {
      const attribute = new THREE.BufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
      return [name, attribute];
    })) as Record<keyof typeof FLOATS, THREE.BufferAttribute>;
    const IndexArray = capacity * 2 > 65535 ? Uint32Array : Uint16Array;
    this.index = new THREE.BufferAttribute(new IndexArray(capacity * 3), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setIndex(this.index);
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geometry, smokeRibbonMaterial(lighting));
    this.mesh.name = 'Funnel smoke trails';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  begin(camera: THREE.Camera): void {
    this.vertices = 0; this.indices = 0;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldDirection(this.cameraForward);
    this.near = (camera as THREE.PerspectiveCamera).near ?? .1;
  }

  /** Append one plume. `points` run oldest to newest; only the first `count` are read. */
  strip(points: readonly RibbonPoint[], count: number): void {
    if (count < 2 || this.vertices + count * 2 > this.capacity || this.indices + (count - 1) * 6 > this.index.count) return;
    // Direct typed-array writes: attribute setters cost more than the geometry itself here.
    const position = this.attributes.position.array as Float32Array, plumeSide = this.attributes.plumeSide.array as Float32Array;
    const plumeData = this.attributes.plumeData.array as Float32Array, plumeTint = this.attributes.plumeTint.array as Float32Array;
    const plumeSpent = this.attributes.plumeSpent.array as Float32Array, index = this.index.array as Uint16Array | Uint32Array;
    const first = this.vertices;
    for (let i = 0; i < count; i++) {
      const p = points[i], previous = points[Math.max(0, i - 1)], next = points[Math.min(count - 1, i + 1)];
      this.tangent.subVectors(next.position, previous.position);
      if (this.tangent.lengthSq() < 1e-6) this.tangent.set(0, 1, 0); else this.tangent.normalize();
      this.toCamera.subVectors(this.cameraPosition, p.position);
      const distance = this.toCamera.length();
      this.toCamera.divideScalar(Math.max(distance, 1e-4));
      this.side.crossVectors(this.tangent, this.toCamera);
      const sideLength = this.side.length();
      // End-on, blend toward a stable horizontal side instead of letting the strip twist.
      this.fallback.crossVectors(THREE.Object3D.DEFAULT_UP, this.toCamera);
      if (this.fallback.lengthSq() < 1e-6) this.fallback.set(1, 0, 0);
      this.fallback.normalize();
      if (sideLength > 1e-5) this.side.divideScalar(sideLength);
      const endOn = 1 - THREE.MathUtils.smoothstep(sideLength, .08, .45);
      this.side.lerp(this.fallback, endOn).normalize();
      const depth = this.toCamera.dot(this.cameraForward) * -distance;
      // A plume passing the lens or behind it would cover the screen; the sprites carry it there.
      const nearFade = THREE.MathUtils.smoothstep(distance, p.width * .7, p.width * 2.5) * (depth > this.near ? 1 : 0);
      const opacity = p.opacity * nearFade * (1 - endOn * .55);
      // The side's length carries how squarely the plume faces the camera (1) or recedes (→0).
      const facing = Math.max(.05, Math.min(1, sideLength)), half = p.width / 2;
      for (let s = 0; s < 2; s++) {
        const across = s === 0 ? -1 : 1, v = this.vertices++, v3 = v * 3, v4 = v * 4;
        position[v3] = p.position.x + this.side.x * across * half;
        position[v3 + 1] = p.position.y + this.side.y * across * half;
        position[v3 + 2] = p.position.z + this.side.z * across * half;
        plumeSide[v3] = this.side.x * facing; plumeSide[v3 + 1] = this.side.y * facing; plumeSide[v3 + 2] = this.side.z * facing;
        plumeData[v4] = across; plumeData[v4 + 1] = p.along; plumeData[v4 + 2] = p.age; plumeData[v4 + 3] = p.width;
        plumeTint[v4] = p.color.r; plumeTint[v4 + 1] = p.color.g; plumeTint[v4 + 2] = p.color.b; plumeTint[v4 + 3] = opacity;
        plumeSpent[v] = p.spent;
      }
    }
    for (let i = 0; i < count - 1; i++) {
      const a = first + i * 2;
      index[this.indices++] = a; index[this.indices++] = a + 1; index[this.indices++] = a + 2;
      index[this.indices++] = a + 2; index[this.indices++] = a + 1; index[this.indices++] = a + 3;
    }
  }

  end(): void {
    const geometry = this.mesh.geometry;
    geometry.setDrawRange(0, this.indices);
    this.mesh.visible = this.indices > 0;
    if (!this.indices) return;
    for (const attribute of [...Object.values(this.attributes), this.index]) {
      const used = attribute === this.index ? this.indices : this.vertices * attribute.itemSize;
      attribute.clearUpdateRanges(); attribute.addUpdateRange(0, used); attribute.needsUpdate = true;
    }
  }

  get segments(): number { return this.indices / 6; }
  reset(): void { this.vertices = 0; this.indices = 0; this.mesh.geometry.setDrawRange(0, 0); this.mesh.visible = false; }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

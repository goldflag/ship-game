import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { ExpandableInstances } from './ExpandableInstances';
const PAGE_SIZE = 144;

/** Screen coverage for aircraft whose thin triangles no longer cover a pixel.
 * This only supplements the rendered silhouette; simulation size stays unchanged. */
export function aircraftContactAppearance(spanPixels: number) {
  // Only assist tiny, edge-on geometry. A constant large, dark icon obscures
  // the model's paint and makes distant formations look bigger as they recede.
  const fadeIn = 1 - THREE.MathUtils.smoothstep(spanPixels, 2, 12);
  return { pixels: Math.min(3, Math.max(0, spanPixels)), opacity: .28 * fadeIn };
}

function contactTexture() {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    // A soft point survives subpixel sampling without inventing a large,
    // camera-facing aircraft shape over the correctly oriented model.
    const alpha = 1 - THREE.MathUtils.smoothstep(Math.hypot(u, v), 0, .95);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255; pixels[i + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Paged depth-tested, fogged draws for the airborne group. */
export class AircraftContacts {
  private geometry = new THREE.PlaneGeometry(1, 1);
  private texture = contactTexture();
  private material = new THREE.MeshBasicNodeMaterial({ color: '#23313b', map: this.texture, transparent: true, depthWrite: false });
  private opacity = new THREE.InstancedBufferAttribute(new Float32Array(PAGE_SIZE), 1);
  readonly mesh = new ExpandableInstances(this.geometry, this.material, PAGE_SIZE);
  private viewPosition = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private matrix = new THREE.Matrix4();
  private height = 1080;
  count = 0;
  constructor() {
    this.geometry.setAttribute('aircraftOpacity', this.opacity);
    this.material.opacityNode = attribute('aircraftOpacity', 'float');
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.name = 'Distant aircraft silhouettes';
  }
  resize(height: number) { this.height = Math.max(1, height); }
  begin() { this.count = 0; }
  add(position: THREE.Vector3, wingspan: number, camera: THREE.Camera, bank: number) {
    const depth = -this.viewPosition.copy(position).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= 0) return;
    const worldPerPixel = 2 * depth / (camera.projectionMatrix.elements[5] * this.height);
    const appearance = aircraftContactAppearance(wingspan / worldPerPixel);
    if (appearance.opacity <= .001) return;
    camera.getWorldQuaternion(this.rotation);
    this.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank));
    this.scale.setScalar(appearance.pixels * worldPerPixel);
    this.mesh.setMatrixAt(this.count, this.matrix.compose(position, this.rotation, this.scale));
    this.mesh.setScalarAttributeAt('aircraftOpacity', this.count++, appearance.opacity);
  }
  finish() { this.mesh.visible = this.count > 0; this.mesh.publish(this.count); }
  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); this.texture.dispose(); }
}

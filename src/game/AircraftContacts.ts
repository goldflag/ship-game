import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { MAX_AIRBORNE } from '../simulation/aircraft';

/** Screen coverage for aircraft whose thin triangles no longer cover a pixel.
 * This only supplements the rendered silhouette; simulation size stays unchanged. */
export function aircraftContactAppearance(spanPixels: number, distance: number) {
  const fadeIn = 1 - THREE.MathUtils.smoothstep(spanPixels, 5, 14);
  const fadeOut = 1 - THREE.MathUtils.smoothstep(distance, 16000, 20000);
  return { pixels: 7, opacity: .8 * fadeIn * fadeOut };
}

function silhouetteTexture() {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const body = Math.hypot(u / .22, v / .7);
    const wing = Math.max(Math.abs(u) / .96, Math.abs(v + Math.abs(u) * .12) / .18);
    const alpha = 1 - THREE.MathUtils.smoothstep(Math.min(body, wing), .7, 1);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255; pixels[i + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** One depth-tested, fogged draw for the entire airborne group. */
export class AircraftContacts {
  private geometry = new THREE.PlaneGeometry(1, 1);
  private texture = silhouetteTexture();
  private material = new THREE.MeshBasicNodeMaterial({ color: '#23313b', map: this.texture, transparent: true, depthWrite: false });
  private opacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_AIRBORNE), 1);
  readonly mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_AIRBORNE);
  private viewPosition = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private matrix = new THREE.Matrix4();
  private height = 1080;
  constructor() {
    this.geometry.setAttribute('aircraftOpacity', this.opacity);
    this.material.opacityNode = attribute('aircraftOpacity', 'float');
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.name = 'Distant aircraft silhouettes';
  }
  resize(height: number) { this.height = Math.max(1, height); }
  begin() { this.mesh.count = 0; }
  add(position: THREE.Vector3, wingspan: number, camera: THREE.Camera, bank: number) {
    if (this.mesh.count >= MAX_AIRBORNE) return;
    const depth = -this.viewPosition.copy(position).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= 0) return;
    const worldPerPixel = 2 * depth / (camera.projectionMatrix.elements[5] * this.height);
    const appearance = aircraftContactAppearance(wingspan / worldPerPixel, position.distanceTo(camera.position));
    if (appearance.opacity <= .001) return;
    camera.getWorldQuaternion(this.rotation);
    this.rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank));
    this.scale.setScalar(appearance.pixels * worldPerPixel);
    this.mesh.setMatrixAt(this.mesh.count, this.matrix.compose(position, this.rotation, this.scale));
    this.opacity.setX(this.mesh.count++, appearance.opacity);
  }
  finish() { this.mesh.visible = this.mesh.count > 0; this.mesh.instanceMatrix.needsUpdate = true; this.opacity.needsUpdate = true; }
  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); this.texture.dispose(); }
}

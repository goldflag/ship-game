import * as THREE from 'three/webgpu';
import { attribute, positionLocal, texture, uniform, uv, vec4 } from 'three/tsl';

const GRAVITY = 9.81, DRAG = .12, PARCELS = 512, STRIDE = 10;
const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);

interface Plume {
  origin: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
  distance: number;
  parcels: Float32Array;
  count: number;
}

/** A dense ballistic water body assembled from porous, shaded parcels.
 * Small rounded parcels merge into a coherent column at birth, separate into
 * irregular lobes at the crest, and shrink into rain as gravity returns them.
 * One instanced draw, fixed storage, no raymarch or per-parcel object/matrix. */
export class WaterPlumes {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly plumes: Plume[];
  private readonly active: Plume[] = [];
  private readonly centers: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly right = uniform(new THREE.Vector3(1, 0, 0));
  private readonly up = uniform(new THREE.Vector3(0, 1, 0));
  private readonly illumination = uniform(1);
  private readonly sun = new THREE.Vector3(-.55, .74, -.39).normalize();
  private readonly center = new THREE.Vector3();
  private cursor = 0;

  constructor(readonly capacity: number, map: THREE.DataTexture) {
    const plane = new THREE.PlaneGeometry(1, 1), geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(plane.index!.clone());
    for (const name of ['position', 'uv']) geometry.setAttribute(name, plane.getAttribute(name).clone());
    plane.dispose();
    const buffer = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * PARCELS * size), size).setUsage(THREE.DynamicDrawUsage);
    this.centers = buffer(4); this.shapes = buffer(4); this.colors = buffer(3);
    geometry.setAttribute('waterParcel', this.centers); geometry.setAttribute('waterShape', this.shapes);
    geometry.setAttribute('waterTint', this.colors); geometry.instanceCount = 0; geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.forceSinglePass = true;
    const parcel = attribute<'vec4'>('waterParcel', 'vec4'), shape = attribute<'vec4'>('waterShape', 'vec4');
    const localY = positionLocal.y.mul(shape.z);
    const x = positionLocal.x.mul(shape.x).sub(localY.mul(shape.y));
    const y = positionLocal.x.mul(shape.y).add(localY.mul(shape.x));
    material.positionNode = parcel.xyz.add(this.right.mul(x).add(this.up.mul(y)).mul(parcel.w));
    const water = texture(map, uv());
    material.colorNode = vec4(attribute<'vec3'>('waterTint', 'vec3').mul(water.rgb).mul(this.illumination), 1);
    material.opacityNode = water.a.mul(shape.w);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Ballistic water body'; this.mesh.frustumCulled = false;
    this.plumes = Array.from({ length: capacity }, () => ({ origin: new THREE.Vector3(), age: 0, life: 0,
      scale: 1, distance: 0, count: 0, parcels: new Float32Array(PARCELS * STRIDE) }));
  }

  emit(origin: THREE.Vector3, scale: number, direction: THREE.Vector3, random: () => number): void {
    const plume = this.plumes[this.cursor++ % this.capacity], rootScale = Math.sqrt(scale);
    const steepness = Math.min(1, Math.abs(direction.y));
    const lean = (1.5 + 4.5 * (1 - steepness)) * rootScale;
    const lift = .82 + .18 * Math.sqrt(steepness), rotation = random() * Math.PI * 2;
    plume.origin.copy(origin); plume.scale = scale; plume.age = 0; plume.life = 7.2 * rootScale;
    plume.count = Math.ceil(PARCELS * Math.min(1, rootScale));
    for (let i = 0; i < plume.count; i++) {
      const offset = i * STRIDE, crown = i % 4 === 2, fine = i % 4 === 3;
      const angle = random() * Math.PI * 2, cosine = Math.cos(angle), sine = Math.sin(angle);
      const along = .12 + random() * .88;
      const lobe = 1 + Math.sin(angle * 3 + rotation) * .12 + Math.sin(angle * 7 - rotation) * .07;
      const up = (crown ? 5 + random() * 8 : (9 + along * 30) * lobe) * rootScale * lift;
      const out = (crown ? 9 + random() * 12 : (1 + random() * (fine ? 6 : 3)) * (.3 + along * .7)) * rootScale;
      const diameter = (crown ? .25 + random() * .65 : fine ? .15 + random() * .65 : 1.7 + random() * 1.7) * scale;
      const turn = random() * Math.PI * 2;
      plume.parcels.set([cosine * random() * 1.3 * scale, sine * random() * 1.3 * scale,
        cosine * out + direction.x * lean, up, sine * out + direction.z * lean,
        diameter, Math.cos(turn), Math.sin(turn), crown ? .38 : fine ? .34 : .62,
        .45 + along * .22 + random() * .13], offset);
    }
  }

  setSun(direction: THREE.Vector3, intensity = 1): void {
    this.sun.copy(direction); this.illumination.value = intensity;
  }

  advance(dt: number): void {
    for (const plume of this.plumes) if (plume.age < plume.life) plume.age += dt;
  }

  publish(camera: THREE.Camera): void {
    this.right.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.value.setFromMatrixColumn(camera.matrixWorld, 1);
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const projection = camera.projectionMatrix.elements;
    this.active.length = 0;
    for (const plume of this.plumes) {
      if (plume.age <= 0 || plume.age >= plume.life) continue;
      plume.distance = plume.origin.distanceToSquared(camera.position);
      if (perspective) {
        this.center.copy(plume.origin); this.center.y += 24 * plume.scale;
        this.center.applyMatrix4(camera.matrixWorldInverse);
        const radius = 65 * Math.max(plume.scale, Math.sqrt(plume.scale)), depth = -this.center.z;
        if (depth + radius < .1 || Math.abs(this.center.x) > Math.max(depth, 0) / projection[0] + radius * 2
          || Math.abs(this.center.y) > Math.max(depth, 0) / projection[5] + radius * 2) continue;
      }
      this.active.push(plume);
    }
    this.active.sort((a, b) => b.distance - a.distance);
    let count = 0;
    for (const plume of this.active) {
      const age = plume.age, rootScale = Math.sqrt(plume.scale);
      const travel = -Math.expm1(-DRAG * age) / DRAG;
      const decay = Math.exp(-DRAG * age);
      const fall = GRAVITY / DRAG * (age - travel);
      const opening = 1 - Math.exp(-age * 38 / rootScale);
      const breakup = smooth(.6 * rootScale, 5 * rootScale, age);
      const fade = 1 - smooth(plume.life * .65, plume.life, age);
      // Keep the mass at range; omit only the finest fringe. Zoom restores it.
      const distant = perspective && 45 * plume.scale * projection[5] / Math.max(1, Math.sqrt(plume.distance)) < .08;
      for (let i = 0; i < plume.count; i++) {
        if (distant && i % 2 === 1) continue;
        const p = i * STRIDE, data = plume.parcels;
        const height = data[p + 3] * travel - fall;
        if (height <= 0) continue;
        const body = i % 4 < 2;
        const size = data[p + 5] * opening * (body ? 1 - breakup * .9 : 1);
        const alpha = data[p + 8] * opening * fade * smooth(0, size * .5, height)
          * (body ? 1 - breakup * .5 : 1) * (distant && body ? 1.65 : 1);
        const vx = data[p + 2] * decay, vy = data[p + 3] * decay - GRAVITY * travel, vz = data[p + 4] * decay;
        const screenX = vx * this.right.value.x + vy * this.right.value.y + vz * this.right.value.z;
        const screenY = vx * this.up.value.x + vy * this.up.value.y + vz * this.up.value.z;
        const speed = Math.hypot(screenX, screenY);
        // Mild, area-preserving elongation suggests flowing water. It becomes
        // round at the apex, so there is no rod-like flip when motion reverses.
        const stretch = body ? 1 + Math.min(.55, speed * .018) : 1;
        this.centers.setXYZW(count, plume.origin.x + data[p] + data[p + 2] * travel,
          plume.origin.y + height, plume.origin.z + data[p + 1] + data[p + 4] * travel, size / Math.sqrt(stretch));
        this.shapes.setXYZW(count, body && speed > .001 ? screenY / speed : data[p + 6],
          body && speed > .001 ? -screenX / speed : data[p + 7], stretch, alpha);
        const facing = (data[p] * this.sun.x + data[p + 1] * this.sun.z) / Math.max(.1, Math.hypot(data[p], data[p + 1]));
        const light = data[p + 9] * (.86 + this.sun.y * .14 + facing * .16);
        this.colors.setXYZ(count, light * .84, light * .96, light);
        count++;
      }
    }
    this.mesh.geometry.instanceCount = count;
    this.mesh.geometry.setDrawRange(0, count ? 6 : 0);
    for (const buffer of [this.centers, this.shapes, this.colors]) {
      buffer.clearUpdateRanges();
      if (count) { buffer.addUpdateRange(0, count * buffer.itemSize); buffer.needsUpdate = true; }
    }
  }

  get count(): number { return this.active.length; }
  get particleCount(): number { return this.mesh.geometry.instanceCount; }
  get particleCapacity(): number { return this.capacity * PARCELS; }
  reset(): void {
    for (const plume of this.plumes) { plume.age = 0; plume.life = 0; }
    this.cursor = 0; this.active.length = 0;
    this.mesh.geometry.instanceCount = 0; this.mesh.geometry.setDrawRange(0, 0);
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

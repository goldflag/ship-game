import * as THREE from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import type { EnsignDesign } from '../ships/rig';
import { motionVelocity } from './session/motion';
import { SHIP_PACE } from '../ships/mobility';
import { ensignAspects, rasterEnsign } from '../../assets/parts/ensigns';
import { FlagCloth } from './FlagCloth';
import type { Combatant } from '../game/session/elements';
import { turnFrom } from './jointTurns';

const textures = new Map<EnsignDesign, { texture: THREE.DataTexture; users: number }>();
function retainTexture(design: EnsignDesign): THREE.DataTexture {
  let entry = textures.get(design);
  if (!entry) {
    const { data, width, height } = rasterEnsign(design);
    const texture = new THREE.DataTexture(data, width, height);
    texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
    texture.anisotropy = 8; texture.needsUpdate = true;
    textures.set(design, entry = { texture, users: 0 });
  }
  entry.users++; return entry.texture;
}

/** Two numbers equal bit for bit as far as arithmetic can tell: a zero's sign counts, and NaN matches NaN. */
const same = (a: number, b: number) => a === b ? a !== 0 || 1 / a === 1 / b : a !== a && b !== b;

/** The view frustum every rig tests its flags against: a function of the camera's projection and view matrices and depth
 * conventions only, so it is kept while those stay the same. */
class SharedFrustum {
  readonly frustum = new THREE.Frustum();
  private built = false;
  private readonly projection = new Float64Array(16);
  private readonly view = new Float64Array(16);
  private system = 0;
  private reversed = false;
  private readonly matrix = new THREE.Matrix4();
  of(camera: THREE.Camera): THREE.Frustum {
    const p = camera.projectionMatrix.elements, v = camera.matrixWorldInverse.elements, known = this.projection, view = this.view;
    let fresh = this.built && this.system === camera.coordinateSystem && this.reversed === camera.reversedDepth;
    for (let i = 0; fresh && i < 16; i++) fresh = same(p[i], known[i]) && same(v[i], view[i]);
    if (!fresh) {
      this.built = true; this.system = camera.coordinateSystem; this.reversed = camera.reversedDepth; known.set(p); view.set(v);
      this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    }
    return this.frustum;
  }
}

/** Wind and sensor motion are visual equipment, independent of combat poses. */
export class ShipRigView {
  /** Off: each rig builds its own frustum from the camera every update, for comparison. */
  static shareFrustum = true;
  private static readonly shared = new SharedFrustum();
  readonly root = new THREE.Group();
  readonly radars: { node: THREE.Object3D; base: THREE.Quaternion; rpm: number; sweepDeg?: number; phase: number; angle: number }[];
  readonly flags: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; cloth: FlagCloth; design: EnsignDesign }[];
  private readonly inverse = new THREE.Quaternion();
  private readonly wind = new THREE.Vector3();
  private readonly gravity = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly flagBounds = new THREE.Sphere();
  private readonly relativeWind = [0, 0, 0];
  private readonly localGravity = [0, -9.81, 0];
  private readonly yaw = new THREE.Vector3(0, 1, 0);
  private clock = 0;

  constructor(definition: ShipDefinition, nodes: Map<string, THREE.Object3D>, seed: string) {
    this.root.name = 'Wind-driven national ensigns';
    let phase = 0; for (const c of seed) phase = (Math.imul(phase, 31) + c.charCodeAt(0)) >>> 0;
    this.radars = (definition.rig?.radars ?? []).map(r => {
      const node = nodes.get(r.nodeId);
      if (!node) throw new Error(`Ship export is missing ${r.nodeId}. Rebuild with bun run ship:build ${definition.id}`);
      return { node, base: node.quaternion.clone(), rpm: r.rpm, sweepDeg: r.sweepDeg, phase: (r.phaseDeg ?? 0) * Math.PI / 180, angle: 0 };
    });
    this.flags = (definition.rig?.ensigns ?? []).map((flag, i) => {
      const cloth = new FlagCloth(flag.width, flag.width / ensignAspects[flag.design], (phase % 628) / 100 + i);
      const geometry = new THREE.BufferGeometry();
      // Uploaded once per new fold, when `update` or `reset` marks it: dynamic usage would upload it in every pass, still or not.
      geometry.setAttribute('position', new THREE.BufferAttribute(cloth.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(cloth.indices, 1));
      const uv: number[] = [];
      for (let y = 0; y <= cloth.rows; y++) for (let x = 0; x <= cloth.columns; x++) uv.push(x / cloth.columns, 1 - y / cloth.rows);
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.computeVertexNormals();
      // Conservative cloth reach keeps culling correct through every fold and gust.
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -cloth.height / 2, 0), cloth.width + cloth.height);
      const material = new THREE.MeshStandardMaterial({ map: retainTexture(flag.design), side: THREE.DoubleSide, roughness: .95, metalness: 0 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${flag.id} · ${flag.design}`; mesh.position.set(...flag.position);
      mesh.userData.nodeId = `${flag.id}.cloth`; mesh.userData.assemblyId = flag.id;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.root.add(mesh);
      return { mesh, cloth, design: flag.design };
    });
  }

  update(dt: number, windSpeed: number, windDirection: number, hull: THREE.Object3D, motion: Combatant['motion'], sunk: boolean, camera?: THREE.Camera, radarsActive = true): void {
    const step = Math.max(0, Math.min(dt, .1));
    if (radarsActive && !sunk) this.clock += step;
    for (const radar of this.radars) {
      const cycle = this.clock * radar.rpm * Math.PI / 30 + radar.phase;
      radar.angle = radar.sweepDeg === undefined ? cycle % (Math.PI * 2) : Math.sin(cycle) * radar.sweepDeg * Math.PI / 180;
      turnFrom(radar.node, radar.base, this.yaw.x, this.yaw.y, this.yaw.z, -radar.angle);
    }
    // The frustum and the hull's wind frame serve only cloth that folds this frame.
    let frustum: THREE.Frustum | undefined, velocity: ReturnType<typeof motionVelocity> | undefined;
    for (const { mesh, cloth } of this.flags) {
      this.position.copy(mesh.position).applyQuaternion(hull.quaternion).add(hull.position);
      mesh.visible = this.position.y > cloth.height * .5;
      // Subpixel flags can retain their last fold; binocular magnification must
      // restore motion even when the observed ship is several kilometres away.
      const pixels = camera ? cloth.width * Math.abs(camera.projectionMatrix.elements[5]) * 540 / Math.max(1, camera.position.distanceTo(this.position)) : Infinity;
      if (!mesh.visible || pixels < 1) continue;
      // Keep the full cloth reach, including wind reversal, inside the test.
      // Offscreen cloth resumes just like a previously subpixel flag on zoom-in.
      this.flagBounds.set(this.position, cloth.width + cloth.height);
      if (camera) frustum ??= ShipRigView.shareFrustum ? ShipRigView.shared.of(camera)
        : this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
      if (frustum && !frustum.intersectsSphere(this.flagBounds)) continue;
      if (!velocity) {
        this.inverse.copy(hull.quaternion).invert();
        this.gravity.set(0, -9.81, 0).applyQuaternion(this.inverse).toArray(this.localGravity);
        velocity = motionVelocity(motion);
      }
      this.wind.set(Math.cos(windDirection) * windSpeed - velocity[0], -velocity[1], Math.sin(windDirection) * windSpeed - velocity[2]);
      this.wind.applyQuaternion(this.inverse);
      // Apparent wind includes the hoist's velocity as the hull turns.
      this.wind.x += motion.yawRate * SHIP_PACE * mesh.position.z;
      this.wind.z -= motion.yawRate * SHIP_PACE * mesh.position.x;
      this.wind.toArray(this.relativeWind);
      if (cloth.advance(step, this.relativeWind, this.localGravity)) {
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    }
  }

  reset(): void {
    this.clock = 0;
    for (const f of this.flags) {
      f.cloth.reset(); f.mesh.geometry.attributes.position.needsUpdate = true;
      f.mesh.geometry.computeVertexNormals();
    }
  }
  diagnostics() { return { flags: this.flags.map(f => ({ design: f.design, position: f.mesh.position.toArray(), visible: f.mesh.visible,
    tip: Array.from(f.cloth.positions.slice(f.cloth.columns * 3, f.cloth.columns * 3 + 3)) })),
    radars: this.radars.map(r => ({ nodeId: r.node.userData.nodeId, angle: r.angle, rpm: r.rpm, sweepDeg: r.sweepDeg })) }; }
  dispose(): void {
    for (const f of this.flags) {
      f.mesh.geometry.dispose(); f.mesh.material.dispose();
      const entry = textures.get(f.design)!;
      if (--entry.users === 0) { entry.texture.dispose(); textures.delete(f.design); }
    }
    this.root.clear(); this.root.removeFromParent();
  }
}

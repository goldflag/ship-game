import type { BattleSession } from './session/BattleSession';
import { ExpandableInstances } from './ExpandableInstances';
import { assetUrl } from '../assetUrl';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { aircraftDeckSpot, onFlightDeck } from '../simulation/aircraft';
import { aircraftAttitude, aircraftControls } from '../simulation/aircraftFlight';
import { aircraftGroundPose } from '../simulation/aircraftGroundPose';
import { disposeObjects } from './disposeObjects';
import { AircraftContacts } from './AircraftContacts';
import { AircraftGunfire } from './AircraftGunfire';
import { aircraftOrdnanceGeometry } from '../../assets/effects/naval/aircraft-ordnance';
import { FIXED_DT } from '../simulation/ship';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { batchShipModel } from './ShipBatching';
import { GAMEPLAY_AIRCRAFT } from '../ships/blueprint';

// Authored deck capacity is bounded at 24; hangar aircraft have no scene instance.
// Three may bind the full matrix array as uniforms even when few instances draw.
// Keep each allocation below WebGPU's 64 KiB uniform binding limit.
const BATCH_CAPACITY = 768;
type AircraftBatch = THREE.InstancedMesh<THREE.InstancedBufferGeometry>;
type Joint = { object: THREE.Object3D; id: string; rotation: THREE.Euler };
type Model = { root: THREE.Group; joints: Joint[]; meshes: { source: THREE.Mesh; batches: AircraftBatch[] }[]; count: number; wingspan: number; radius: number };

function aircraftBatch(source: THREE.Mesh, name: string): AircraftBatch {
  // Three sizes the shader's matrix array from mesh.count on its first draw.
  // Keep that capacity fixed; InstancedBufferGeometry supplies the live draw
  // count so later launches fit without drawing hundreds of unused airframes.
  // Each batch owns a geometry shell but shares the authored vertex buffers.
  const geometry = new THREE.InstancedBufferGeometry();
  const { index, attributes, morphAttributes, morphTargetsRelative, groups, drawRange, boundingBox, boundingSphere } = source.geometry;
  Object.assign(geometry, { index, attributes, morphAttributes, morphTargetsRelative, groups, drawRange, boundingBox, boundingSphere });
  geometry.instanceCount = 0;
  const batch = new THREE.InstancedMesh(geometry, source.material, BATCH_CAPACITY);
  batch.name = name;
  batch.visible = false; batch.frustumCulled = false; batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return batch;
}
/** Shared authored geometry/materials, instanced per rigid component at each LOD. */
export class AircraftView {
  readonly root = new THREE.Group();
  private models = new Map<string, Model>();
  private contacts = new AircraftContacts();
  private gunfire = new AircraftGunfire();
  private matrix = new THREE.Matrix4();
  private transform = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private unit = new THREE.Vector3(1, 1, 1);
  private payloadGeometry = aircraftOrdnanceGeometry('torpedo');
  private bombGeometry = aircraftOrdnanceGeometry('bomb');
  private payloadMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .65, metalness: .25 });
  private bombs = new ExpandableInstances(this.bombGeometry, this.payloadMaterial, 768);
  private direction = new THREE.Vector3();
  private releaseRotation = new THREE.Quaternion();
  private nose = new THREE.Vector3(0, 0, -1);
  private payloads = new ExpandableInstances(this.payloadGeometry, this.payloadMaterial, 768);
  private payloadCount = 0;
  private bombCount = 0;
  private loadPromise?: Promise<void>;
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere();
  private readonly viewPosition = new THREE.Vector3();
  private height = 1080;
  private culled = 0;
  private silhouettes = 0;
  constructor() {
    this.payloads.name = 'Aircraft torpedo payloads'; this.bombs.name = 'Aircraft bombs';
    this.root.add(this.gunfire.root, this.payloads, this.contacts.mesh, this.bombs);
    for (const mesh of [this.payloads, this.bombs]) {
      mesh.instanceMatrix.array.fill(0); mesh.visible = false; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }
  resize(height: number) { this.height = Math.max(1, height); this.contacts.resize(height); }
  load(modelIds: readonly string[] = Object.keys(GAMEPLAY_AIRCRAFT)): Promise<void> {
    const ids = [...new Set(modelIds)];
    if (ids.some(id => !Object.hasOwn(GAMEPLAY_AIRCRAFT, id))) return Promise.reject(new Error('Unsupported combat aircraft'));
    // A later fleet can introduce another air group. Serialize additions so
    // overlapping requests share existing models and disposal can await them.
    return this.loadPromise = (this.loadPromise ?? Promise.resolve()).catch(() => {}).then(() => this.loadModels(ids));
  }
  private async loadModels(ids: readonly string[]) {
    const previous = new Set(this.models.keys());
    const palette = new ShipMaterialPalette();
    const results = await Promise.allSettled(ids.flatMap(id => [0, 1, 2].filter(lod => !previous.has(`${id}/${lod}`)).map(async lod => {
      const url = assetUrl(lod ? `models/aircraft/LOD${lod}/${id}-lod${lod}.glb` : `models/aircraft/${id}.glb`);
      const root = (await new GLTFLoader().loadAsync(url)).scene;
      // The shared authoring-node boundaries preserve propellers, controls,
      // landing gear and sockets while rigid paint surfaces share a draw.
      palette.apply(root); batchShipModel(root);
      const bounds = new THREE.Box3().setFromObject(root);
      const model: Model = { root, joints: [], meshes: [], count: 0, wingspan: bounds.max.x - bounds.min.x,
        radius: Math.hypot(...(['x', 'y', 'z'] as const).map(axis => Math.max(Math.abs(bounds.min[axis]), Math.abs(bounds.max[axis])))) + 2 };
      root.traverse(object => {
        const nodeId = object.userData.nodeId as string | undefined;
        if (nodeId) model.joints.push({ object, id: nodeId, rotation: object.rotation.clone() });
        if (!(object as THREE.Mesh).isMesh) return;
        const source = object as THREE.Mesh;
        const batch = aircraftBatch(source, `Aircraft model ${id}/${lod}`);
        this.root.add(batch);
        const batches = [batch];
        model.meshes.push({ source, batches });
      });
      // Most authored nodes are fixed. Only mechanism owners need their local
      // matrices recomposed for each aircraft pose.
      const moving = new Set(model.joints.map(j => j.object));
      root.traverse(object => { if (!moving.has(object)) { object.updateMatrix(); object.matrixAutoUpdate = false; } });
      this.models.set(`${id}/${lod}`, model);
    })));
    const failure = results.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') { this.clearModels(new Set([...this.models.keys()].filter(key => !previous.has(key)))); throw failure.reason; }
  }
  update(sim: BattleSession, camera: THREE.Camera, visible: boolean, inPort = false, carrierRoots = new Map<string, THREE.Object3D>()) {
    this.root.visible = visible;
    if (!visible) return;
    for (const model of this.models.values()) model.count = 0;
    this.culled = 0; this.silhouettes = 0;
    this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const actors = new Map(sim.actors.map(a => [a.motion.id, a]));
    this.contacts.begin();
    let payloadCount = 0, bombCount = 0;
    const alpha = sim.interpolationAlpha;
    for (const plane of sim.aircraft) {
      const crashing = plane.phase === 'lost' && plane.wreck && !plane.wreck.impacted;
      if ((plane.phase === 'lost' && !crashing) || (inPort && (crashing || plane.ownerId !== sim.player.motion.id))) continue;
      const deck = onFlightDeck(plane);
      if (!deck && !crashing && !['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(plane.phase)) continue;
      const actor = actors.get(plane.ownerId)!;
      if (deck) {
        const local = ['ready', 'queued', 'rearming'].includes(plane.phase) ? aircraftDeckSpot(actor, plane) : plane.deckPosition!;
        this.position.fromArray(local);
        const carrierRoot = carrierRoots.get(plane.ownerId);
        if (carrierRoot) {
          this.position.applyMatrix4(carrierRoot.matrixWorld);
          this.quaternion.copy(carrierRoot.quaternion);
          if (plane.phase === 'taxi' || plane.phase === 'parking') this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(plane.deckHeading ?? plane.heading - actor.motion.heading)));
          this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), aircraftGroundPose(plane.modelId).pitch));
        } else {
          this.position.fromArray(plane.position);
          this.quaternion.setFromEuler(new THREE.Euler(plane.pitch, -plane.heading, plane.bank, 'YXZ'));
        }
      } else {
        this.position.fromArray(plane.previousPosition).lerp(new THREE.Vector3().fromArray(plane.position), alpha);
        const attitude = aircraftAttitude(plane, alpha);
        this.quaternion.setFromEuler(new THREE.Euler(attitude.pitch, -attitude.heading, attitude.bank, 'YXZ'));
      }
      const dimensions = this.models.get(`${plane.modelId}/0`);
      if (!dimensions) continue;
      this.sphere.set(this.position, dimensions.radius);
      // Aircraft do not cast fleet shadows; water captures share this camera.
      // Keep the nearby radius conservative through wing fold and control travel.
      if (!inPort && !this.frustum.intersectsSphere(this.sphere)) { this.culled++; continue; }
      const depth = -this.viewPosition.copy(this.position).applyMatrix4(camera.matrixWorldInverse).z;
      const span = dimensions.wingspan * camera.projectionMatrix.elements[5] * this.height / (2 * Math.max(.001, depth));
      if (!deck && !inPort && !crashing) this.contacts.add(this.position, dimensions.wingspan, camera, aircraftAttitude(plane, alpha).bank);
      // Keep the lowest-detail airframe at every distance. The contact supplements
      // thin/subpixel geometry instead of replacing it at a hard zoom threshold.
      if (!deck && !inPort && !crashing && span < 9) this.silhouettes++;
      const lod = span > 90 ? 0 : span > 28 ? 1 : 2;
      const model = this.models.get(`${plane.modelId}/${lod}`);
      if (!model) continue;
      for (const { source, batches } of model.meshes) if (model.count >= batches.length * BATCH_CAPACITY) {
        const batch = aircraftBatch(source, batches[0].name);
        this.root.add(batch); batches.push(batch);
      }
      this.transform.compose(this.position, this.quaternion, this.unit);
      const controls = aircraftControls(plane, alpha), gear = 1 - controls.gear;
      for (const { object, id, rotation } of model.joints) {
        object.rotation.copy(rotation);
        if (id.startsWith('wing.fold.')) object.rotateOnAxis(new THREE.Vector3().fromArray(object.userData.foldAxis), plane.wingFold * Number(object.userData.foldAngleDegrees) * Math.PI / 180);
        if (id === 'propeller.spin') object.rotateZ(controls.propeller);
        if (id.startsWith('gear.') && !object.userData.fixed && object.userData.articulation !== 'fixed') {
          const angle = gear * Math.PI * .43 * (id.endsWith('.port') ? 1 : -1) * (id.endsWith('.tail') ? .5 : 1);
          if (object.userData.axis === 'spanwise') object.rotateX(angle); else object.rotateZ(angle);
        }
        if (id.startsWith('control.aileron.')) object.rotateX(controls.aileron * (id.endsWith('.port') ? 1 : -1));
        if (id.startsWith('control.elevator.')) object.rotateX(controls.elevator);
        if (id === 'control.rudder') object.rotateY(controls.rudder);
        if (id === 'arrestor.hook') object.rotateX(controls.hook * .65);
        if (id.startsWith('diveBrake.')) object.rotateX(controls.brakes * .55 * Number(object.userData.rotationMultiplier ?? 1));
      }
      model.root.updateMatrixWorld(true);
      for (const { source, batches } of model.meshes) batches[Math.floor(model.count / BATCH_CAPACITY)].setMatrixAt(model.count % BATCH_CAPACITY, this.matrix.multiplyMatrices(this.transform, source.matrixWorld));
      if (plane.payload && !['ready', 'queued', 'rearming', 'parking', 'rollout'].includes(plane.phase) && payloadCount < 768) {
        const socket = model.joints.find(j => j.id === 'socket.payload')?.object;
        this.matrix.copy(this.transform);
        if (socket) this.matrix.multiply(socket.matrixWorld);
        if (plane.role === 'dive-bomber') { this.bombs.setMatrixAt(bombCount++, this.matrix); }
        else this.payloads.setMatrixAt(payloadCount++, this.matrix);
      }
      model.count++;
    }
    for (const model of this.models.values()) for (const { batches } of model.meshes) batches.forEach((batch, i) => {
      batch.geometry.instanceCount = Math.max(0, Math.min(BATCH_CAPACITY, model.count - i * BATCH_CAPACITY));
      batch.visible = batch.geometry.instanceCount > 0;
      if (batch.visible) batch.instanceMatrix.needsUpdate = true;
    });
    this.contacts.finish();
    for (const bomb of sim.shells) {
      if (!bomb.bomb || bomb.lodged) continue;
      // Sample the same one-tick presentation delay as the aircraft, bounded by release.
      const lag = Math.min(bomb.age, (1 - alpha) * FIXED_DT), age = bomb.age - lag;
      this.position.fromArray(bomb.position).addScaledVector(this.direction.fromArray(bomb.velocity), -lag);
      this.position.y -= 4.905 * lag * lag;
      this.direction.y += 9.81 * lag;
      this.quaternion.setFromUnitVectors(this.nose, this.direction.normalize());
      const release = bomb.bomb;
      this.releaseRotation.setFromEuler(new THREE.Euler(release.pitch, -release.heading, release.bank, 'YXZ'));
      // Fins progressively weathercock the body into its falling trajectory.
      this.releaseRotation.slerp(this.quaternion, 1 - Math.exp(-age * 3));
      this.bombs.setMatrixAt(bombCount++, this.matrix.compose(this.position, this.releaseRotation, this.unit));
    }
    for (const release of sim.airReleases) {
      this.position.fromArray(release.position);
      this.quaternion.setFromUnitVectors(this.nose, this.direction.fromArray(release.velocity).normalize());
      this.payloads.setMatrixAt(payloadCount++, this.matrix.compose(this.position, this.quaternion, this.unit));
    }
    this.payloadCount = payloadCount; this.payloads.visible = payloadCount > 0;
    this.payloads.publish(payloadCount);
    this.bombCount = bombCount; this.bombs.visible = bombCount > 0;
    this.bombs.publish(bombCount);
    this.gunfire.update(sim, camera);
  }
  diagnostics() { return { models: this.models.size, instances: [...this.models.values()].reduce((n, m) => n + m.count, 0), batches: [...this.models.values()].reduce((n, m) => n + Math.ceil(m.count / BATCH_CAPACITY) * m.meshes.length, 0), culled: this.culled, silhouettes: this.silhouettes, contacts: this.contacts.count, payloads: this.payloadCount + this.bombCount, bombs: this.bombCount, tracers: this.gunfire.diagnostics() }; }
  private clearModels(keys = new Set(this.models.keys())) {
    for (const key of keys) {
      const model = this.models.get(key)!;
      for (const { batches } of model.meshes) for (const batch of batches) { batch.removeFromParent(); batch.dispose(); batch.geometry.dispose(); }
      disposeObjects(model.root); this.models.delete(key);
    }
  }
  async dispose() {
    await this.loadPromise?.catch(() => {});
    this.clearModels(); this.root.removeFromParent(); this.gunfire.dispose();
    this.contacts.dispose();
    this.payloads.dispose(); this.bombs.dispose(); this.payloadGeometry.dispose(); this.bombGeometry.dispose(); this.payloadMaterial.dispose();
  }
}

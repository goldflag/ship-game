import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CombatSimulation } from '../simulation/combat';
import { aircraftDeckSpot, onFlightDeck } from '../simulation/aircraft';
import { aircraftAttitude, aircraftControls } from '../simulation/aircraftFlight';
import { disposeObjects } from './disposeObjects';
import { AircraftContacts } from './AircraftContacts';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { batchShipModel } from './ShipBatching';

// Authored deck capacity is bounded at 24; hangar aircraft have no scene instance.
const CAPACITY = 60 * 24 + 144;
// Three may bind the full matrix array as uniforms even when few instances draw.
// Keep each allocation below WebGPU's 64 KiB uniform binding limit.
const BATCH_CAPACITY = 768;
type Joint = { object: THREE.Object3D; id: string; rotation: THREE.Euler };
type Model = { root: THREE.Group; joints: Joint[]; meshes: { source: THREE.Mesh; batches: THREE.InstancedMesh[] }[]; count: number; wingspan: number };
/** Shared authored geometry/materials, instanced per rigid component at each LOD. */
export class AircraftView {
  readonly root = new THREE.Group();
  private models = new Map<string, Model>();
  private contacts = new AircraftContacts();
  private traces = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffdda0', transparent: true, opacity: .8 }));
  private matrix = new THREE.Matrix4();
  private transform = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private unit = new THREE.Vector3(1, 1, 1);
  private payloadGeometry = new THREE.CapsuleGeometry(.24, 2.5, 3, 6).rotateX(Math.PI / 2);
  private payloadMaterial = new THREE.MeshStandardMaterial({ color: '#4c5356', roughness: .65 });
  private payloads = new THREE.InstancedMesh(this.payloadGeometry, this.payloadMaterial, 768);
  private loadPromise?: Promise<void>;
  constructor() { this.traces.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(128 * 6), 3)); this.traces.geometry.setDrawRange(0, 0); this.root.add(this.traces, this.payloads, this.contacts.mesh); this.payloads.count = 0; this.payloads.visible = false; this.payloads.frustumCulled = false; this.traces.frustumCulled = false; }
  resize(height: number) { this.contacts.resize(height); }
  load(): Promise<void> {
    return this.loadPromise ??= this.loadModels();
  }
  private async loadModels() {
    const palette = new ShipMaterialPalette();
    const results = await Promise.allSettled(['f4f-4-wildcat', 'sbd-3-dauntless', 'tbd-1-devastator'].flatMap(id => [0, 1, 2].map(async lod => {
      const url = lod ? `/models/aircraft/LOD${lod}/${id}-lod${lod}.glb` : `/models/aircraft/${id}.glb`;
      const root = (await new GLTFLoader().loadAsync(url)).scene;
      // The shared authoring-node boundaries preserve propellers, controls,
      // landing gear and sockets while rigid paint surfaces share a draw.
      palette.apply(root); batchShipModel(root);
      const model: Model = { root, joints: [], meshes: [], count: 0, wingspan: new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).x };
      root.traverse(object => {
        const id = object.userData.nodeId as string | undefined;
        if (id) model.joints.push({ object, id, rotation: object.rotation.clone() });
        if (!(object as THREE.Mesh).isMesh) return;
        const source = object as THREE.Mesh;
        const batches = Array.from({ length: Math.ceil(CAPACITY / BATCH_CAPACITY) }, (_, i) => {
          const batch = new THREE.InstancedMesh(source.geometry, source.material, Math.min(BATCH_CAPACITY, CAPACITY - i * BATCH_CAPACITY));
          batch.count = 0; batch.visible = false; batch.frustumCulled = false; batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.root.add(batch); return batch;
        });
        model.meshes.push({ source, batches });
      });
      this.models.set(`${id}/${lod}`, model);
    })));
    const failure = results.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') { this.clearModels(); this.loadPromise = undefined; throw failure.reason; }
  }
  update(sim: CombatSimulation, camera: THREE.Camera, visible: boolean, inPort = false, carrierRoots = new Map<string, THREE.Object3D>()) {
    this.root.visible = visible;
    if (!visible) return;
    for (const model of this.models.values()) model.count = 0;
    this.contacts.begin();
    let payloadCount = 0;
    const alpha = sim.interpolationAlpha;
    for (const plane of sim.aircraft) {
      if (plane.phase === 'lost' || (inPort && plane.ownerId !== sim.player.motion.id)) continue;
      const actor = sim.actors.find(a => a.motion.id === plane.ownerId)!;
      const deck = onFlightDeck(plane);
      if (!deck && !['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(plane.phase)) continue;
      if (deck) {
        const local = ['ready', 'queued', 'rearming'].includes(plane.phase) ? aircraftDeckSpot(actor, plane) : plane.deckPosition!;
        this.position.fromArray(local);
        const carrierRoot = carrierRoots.get(plane.ownerId);
        if (carrierRoot) {
          this.position.applyMatrix4(carrierRoot.matrixWorld);
          this.quaternion.copy(carrierRoot.quaternion);
          if (plane.phase === 'taxi' || plane.phase === 'parking') this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(plane.heading - actor.motion.heading)));
        } else {
          this.position.fromArray(plane.position);
          this.quaternion.setFromEuler(new THREE.Euler(plane.pitch, -plane.heading, plane.bank, 'YXZ'));
        }
      } else {
        this.position.fromArray(plane.previousPosition).lerp(new THREE.Vector3().fromArray(plane.position), alpha);
        const attitude = aircraftAttitude(plane, alpha);
        this.quaternion.setFromEuler(new THREE.Euler(attitude.pitch, -attitude.heading, attitude.bank, 'YXZ'));
      }
      const distance = this.position.distanceTo(camera.position), lod = distance < 120 ? 0 : distance < 400 ? 1 : 2;
      const model = this.models.get(`${plane.modelId}/${lod}`);
      if (!model || model.count >= CAPACITY) continue;
      if (!deck && !inPort) this.contacts.add(this.position, model.wingspan, camera, aircraftAttitude(plane, alpha).bank);
      this.transform.compose(this.position, this.quaternion, this.unit);
      const controls = aircraftControls(plane, alpha), gear = 1 - controls.gear;
      for (const { object, id, rotation } of model.joints) {
        object.rotation.copy(rotation);
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
        this.payloads.setMatrixAt(payloadCount++, this.matrix);
      }
      model.count++;
    }
    for (const model of this.models.values()) for (const { batches } of model.meshes) batches.forEach((batch, i) => {
      batch.count = Math.max(0, Math.min(BATCH_CAPACITY, model.count - i * BATCH_CAPACITY));
      batch.visible = batch.count > 0; batch.instanceMatrix.needsUpdate = true;
    });
    this.contacts.finish();
    for (const bomb of sim.shells.filter(shell => shell.caliberM === .35 && shell.ammunition === 'he')) {
      if (payloadCount >= 768) break;
      this.position.fromArray(bomb.position);
      this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...bomb.velocity).normalize());
      this.payloads.setMatrixAt(payloadCount++, this.matrix.compose(this.position, this.quaternion, new THREE.Vector3(1, 1, .5)));
    }
    for (const release of sim.airReleases) {
      if (payloadCount >= 768) break;
      this.position.fromArray(release.position);
      this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...release.velocity).normalize());
      this.payloads.setMatrixAt(payloadCount++, this.matrix.compose(this.position, this.quaternion, this.unit));
    }
    this.payloads.count = payloadCount; this.payloads.visible = payloadCount > 0; this.payloads.instanceMatrix.needsUpdate = true;
    const lines: number[] = [];
    for (const event of sim.events) {
      if (event.kind === 'aircraft-fire' && event.aircraft?.target && sim.tick - event.tick < 8) lines.push(...event.position, ...event.aircraft.target);
      if (event.kind === 'aircraft-lost' && sim.tick - event.tick < 90) {
        const age = (sim.tick - event.tick) / 60;
        lines.push(event.position[0], event.position[1] - age * age * 12, event.position[2], event.position[0], event.position[1] - age * age * 12 + 12, event.position[2]);
      }
    }
    const positions = this.traces.geometry.getAttribute('position') as THREE.BufferAttribute;
    (positions.array as Float32Array).set(lines.slice(0, positions.array.length)); positions.needsUpdate = true; this.traces.geometry.setDrawRange(0, Math.min(lines.length, positions.array.length) / 3);
  }
  diagnostics() { return { models: this.models.size, instances: [...this.models.values()].reduce((n, m) => n + m.count, 0), batches: [...this.models.values()].reduce((n, m) => n + Math.ceil(m.count / BATCH_CAPACITY) * m.meshes.length, 0), contacts: this.contacts.mesh.count, payloads: this.payloads.count }; }
  private clearModels() {
    for (const model of this.models.values()) { for (const { batches } of model.meshes) for (const batch of batches) { batch.removeFromParent(); batch.dispose(); } disposeObjects(model.root); }
    this.models.clear();
  }
  async dispose() {
    await this.loadPromise?.catch(() => {});
    this.clearModels(); this.root.removeFromParent(); this.traces.geometry.dispose(); this.traces.material.dispose();
    this.contacts.dispose();
    this.payloads.dispose(); this.payloadGeometry.dispose(); this.payloadMaterial.dispose();
  }
}

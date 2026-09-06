import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CombatSimulation } from '../simulation/combat';
import { airborne } from '../simulation/aircraft';
import { disposeObjects } from './disposeObjects';

const CAPACITY = 144;
type Joint = { object: THREE.Object3D; id: string; rotation: THREE.Euler };
type Model = { root: THREE.Group; joints: Joint[]; meshes: { source: THREE.Mesh; batch: THREE.InstancedMesh }[]; count: number };
/** Shared authored geometry/materials, instanced per rigid component at each LOD. */
export class AircraftView {
  readonly root = new THREE.Group();
  private models = new Map<string, Model>();
  private traces = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffdda0', transparent: true, opacity: .8 }));
  private matrix = new THREE.Matrix4();
  private transform = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private unit = new THREE.Vector3(1, 1, 1);
  private payloadGeometry = new THREE.CapsuleGeometry(.24, 2.5, 3, 6).rotateX(Math.PI / 2);
  private payloadMaterial = new THREE.MeshStandardMaterial({ color: '#4c5356', roughness: .65 });
  private payloads = new THREE.InstancedMesh(this.payloadGeometry, this.payloadMaterial, 384);
  private loadPromise?: Promise<void>;
  constructor() { this.traces.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(128 * 6), 3)); this.traces.geometry.setDrawRange(0, 0); this.root.add(this.traces, this.payloads); this.payloads.count = 0; this.payloads.frustumCulled = false; this.traces.frustumCulled = false; }
  load(): Promise<void> {
    return this.loadPromise ??= this.loadModels();
  }
  private async loadModels() {
    const results = await Promise.allSettled(['f4f-4-wildcat', 'sbd-3-dauntless', 'tbd-1-devastator'].flatMap(id => [0, 1, 2].map(async lod => {
      const url = lod ? `/models/aircraft/LOD${lod}/${id}-lod${lod}.glb` : `/models/aircraft/${id}.glb`;
      const root = (await new GLTFLoader().loadAsync(url)).scene;
      const model: Model = { root, joints: [], meshes: [], count: 0 };
      root.traverse(object => {
        const id = object.userData.nodeId as string | undefined;
        if (id) model.joints.push({ object, id, rotation: object.rotation.clone() });
        if (!(object as THREE.Mesh).isMesh) return;
        const source = object as THREE.Mesh;
        const batch = new THREE.InstancedMesh(source.geometry, source.material, CAPACITY);
        batch.count = 0; batch.frustumCulled = false; batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.root.add(batch); model.meshes.push({ source, batch });
      });
      this.models.set(`${id}/${lod}`, model);
    })));
    const failure = results.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') { this.clearModels(); this.loadPromise = undefined; throw failure.reason; }
  }
  update(sim: CombatSimulation, camera: THREE.Camera, visible: boolean) {
    this.root.visible = visible;
    if (!visible) return;
    for (const model of this.models.values()) model.count = 0;
    let payloadCount = 0;
    const time = sim.tick / 60, alpha = sim.interpolationAlpha;
    for (const plane of sim.aircraft) {
      if (!airborne(plane)) continue;
      this.position.fromArray(plane.previousPosition).lerp(new THREE.Vector3().fromArray(plane.position), alpha);
      const distance = this.position.distanceTo(camera.position), lod = distance < 120 ? 0 : distance < 400 ? 1 : 2;
      const model = this.models.get(`${plane.modelId}/${lod}`);
      if (!model || model.count >= CAPACITY) continue;
      this.quaternion.setFromEuler(new THREE.Euler(plane.pitch, -plane.heading, plane.bank, 'YXZ'));
      this.transform.compose(this.position, this.quaternion, this.unit);
      const gear = plane.phase === 'takeoff' || plane.phase === 'landing' ? 0 : 1;
      for (const { object, id, rotation } of model.joints) {
        object.rotation.copy(rotation);
        if (id === 'propeller.spin') object.rotateZ(time * 65);
        if (id.startsWith('gear.') && !object.userData.fixed && object.userData.articulation !== 'fixed') {
          const angle = gear * Math.PI * .43 * (id.endsWith('.port') ? 1 : -1) * (id.endsWith('.tail') ? .5 : 1);
          if (object.userData.axis === 'spanwise') object.rotateX(angle); else object.rotateZ(angle);
        }
        if (id.startsWith('control.aileron.')) object.rotateX(plane.bank * .3 * (id.endsWith('.port') ? 1 : -1));
        if (id.startsWith('control.elevator.')) object.rotateX(plane.pitch * .3);
        if (id.startsWith('diveBrake.')) object.rotateX(plane.phase === 'attack' ? .55 * Number(object.userData.rotationMultiplier ?? 1) : 0);
      }
      model.root.updateMatrixWorld(true);
      for (const { source, batch } of model.meshes) batch.setMatrixAt(model.count, this.matrix.multiplyMatrices(this.transform, source.matrixWorld));
      if (plane.payload && payloadCount < 384) {
        const socket = model.joints.find(j => j.id === 'socket.payload')?.object;
        this.matrix.copy(this.transform);
        if (socket) this.matrix.multiply(socket.matrixWorld);
        this.payloads.setMatrixAt(payloadCount++, this.matrix);
      }
      model.count++;
    }
    for (const model of this.models.values()) for (const { batch } of model.meshes) { batch.count = model.count; batch.visible = model.count > 0; batch.instanceMatrix.needsUpdate = true; }
    for (const bomb of sim.shells.filter(shell => shell.caliberM === .35 && shell.ammunition === 'he')) {
      if (payloadCount >= 384) break;
      this.position.fromArray(bomb.position);
      this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...bomb.velocity).normalize());
      this.payloads.setMatrixAt(payloadCount++, this.matrix.compose(this.position, this.quaternion, new THREE.Vector3(1, 1, .5)));
    }
    for (const release of sim.airReleases) {
      if (payloadCount >= 384) break;
      this.position.fromArray(release.position);
      this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...release.velocity).normalize());
      this.payloads.setMatrixAt(payloadCount++, this.matrix.compose(this.position, this.quaternion, this.unit));
    }
    this.payloads.count = payloadCount; this.payloads.instanceMatrix.needsUpdate = true;
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
  diagnostics() { return { models: this.models.size, instances: [...this.models.values()].reduce((n, m) => n + m.count, 0), batches: [...this.models.values()].reduce((n, m) => n + (m.count ? m.meshes.length : 0), 0), payloads: this.payloads.count }; }
  private clearModels() {
    for (const model of this.models.values()) { for (const { batch } of model.meshes) { batch.removeFromParent(); batch.dispose(); } disposeObjects(model.root); }
    this.models.clear();
  }
  async dispose() {
    await this.loadPromise?.catch(() => {});
    this.clearModels(); this.root.removeFromParent(); this.traces.geometry.dispose(); this.traces.material.dispose();
    this.payloads.dispose(); this.payloadGeometry.dispose(); this.payloadMaterial.dispose();
  }
}

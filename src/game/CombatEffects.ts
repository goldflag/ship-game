import * as THREE from 'three/webgpu';
import type { CombatSimulation } from '../simulation/combat';

/** Fixed pools keep successive salvos from growing geometry/material allocations. */
export class CombatEffects {
  readonly root = new THREE.Group();
  private projectiles = new THREE.InstancedMesh(new THREE.SphereGeometry(1.1, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffe2a0' }), 256);
  private bursts: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; age: number; duration: number; splash: boolean }[] = [];
  private cursor = 0;
  private sequence = 0;
  private dummy = new THREE.Object3D();
  private hiddenProjectile = new THREE.Matrix4().makeScale(0, 0, 0);
  private activeProjectiles = 0;
  constructor() {
    this.projectiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.projectiles.frustumCulled = false;
    // Three sizes the instancing shader buffer from count at first compilation.
    // Keep the full capacity even in port; zero-scale unused slots instead.
    for (let i = 0; i < this.projectiles.count; i++) this.projectiles.setMatrixAt(i, this.hiddenProjectile);
    this.root.add(this.projectiles);
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < 64; i++) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      mesh.visible = false; this.root.add(mesh); this.bursts.push({ mesh, age: 0, duration: 0, splash: false });
    }
  }
  update(sim: CombatSimulation, dt: number): void {
    sim.shells.forEach((s, i) => { this.dummy.position.fromArray(s.position); this.dummy.updateMatrix(); this.projectiles.setMatrixAt(i, this.dummy.matrix); });
    for (let i = sim.shells.length; i < this.activeProjectiles; i++) this.projectiles.setMatrixAt(i, this.hiddenProjectile);
    this.activeProjectiles = sim.shells.length;
    this.projectiles.instanceMatrix.needsUpdate = true;
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.kind === 'penetration') continue;
      const b = this.bursts[this.cursor++ % this.bursts.length];
      b.age = 0; b.duration = event.kind === 'shot' ? .45 : event.kind === 'splash' ? 3 : 5;
      b.splash = event.kind === 'splash'; b.mesh.visible = true; b.mesh.position.fromArray(event.position);
      b.mesh.material.color.set(b.splash ? '#d8ebed' : event.kind === 'shot' ? '#ffd590' : '#5a5d58');
    }
    this.bursts.forEach(b => {
      b.age += dt;
      b.mesh.visible = b.age < b.duration;
      if (!b.mesh.visible) return;
      const progress = b.age / b.duration, size = 1 + progress * (b.splash ? 8 : 11);
      b.mesh.material.opacity = (1 - progress) * .8;
      b.mesh.scale.set(size, size * (b.splash ? 3 : 1), size);
      b.mesh.position.y += dt * (b.splash ? 0 : 2);
    });
  }
}

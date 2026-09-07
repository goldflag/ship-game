import { localToWorld } from '../simulation/geometry';
import * as THREE from 'three/webgpu';
import { nodeObject, uniform } from 'three/tsl';
import type { CombatEvent, CombatSimulation } from '../simulation/combat';
import { EffectParticlePool, effectTexture } from './EffectParticles';
import { EffectDepthTextureNode, effectVolumeMaterial, effectVolumeTexture } from './EffectVolume';

const UP = new THREE.Vector3(0, 1, 0);
const WARM = new THREE.Color('#ffe7b6');
const SMOKE = new THREE.Color('#b9b6ae'), WATER = new THREE.Color('#e7f2f1');

/** Visual randomness is local and seeded by the event; combat never consumes it. */
function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Ballistics come from the CPU simulation. Only gas, spray and fragments live here. */
export class CombatEffects {
  readonly root = new THREE.Group();
  private readonly maps = { smoke: effectTexture('smoke'), flash: effectTexture('flash'), foam: effectTexture('foam'), tracer: effectTexture('tracer'), wake: effectTexture('wake') };
  private readonly volumeMap = effectVolumeTexture();
  private readonly sun = uniform(new THREE.Vector3(-.55, .74, -.39).normalize());
  private readonly volumeDepthTexture = new THREE.DepthTexture(1, 1);
  private readonly volumeDepth = nodeObject(new EffectDepthTextureNode(undefined, null, this.volumeDepthTexture)).r;
  private readonly smoke = new EffectParticlePool(192, this.maps.smoke, false, effectVolumeMaterial(this.volumeMap, this.sun, this.volumeDepth, 12, true));
  private readonly spouts = new EffectParticlePool(192, this.maps.smoke, false, effectVolumeMaterial(this.volumeMap, this.sun, this.volumeDepth, 10));
  private readonly spray = new EffectParticlePool(1536, this.maps.smoke);
  private readonly fire = new EffectParticlePool(256, this.maps.flash, true);
  private readonly foam = new EffectParticlePool(96, this.maps.foam);
  private readonly pools = [this.foam, this.smoke, this.spouts, this.spray, this.fire];
  private readonly projectiles = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.5, 2, 2, 6),
    new THREE.MeshBasicMaterial({ color: '#b9ad91' }), 256);
  // Water's depth-based postprocessing otherwise classifies these low-flying
  // lights as sea pixels and erases them. Reject the transparent quad margins.
  private readonly shellGlows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: this.maps.flash, color: new THREE.Color('#fff1cc').multiplyScalar(4),
      transparent: true, blending: THREE.AdditiveBlending, alphaTest: .02, depthWrite: true, side: THREE.DoubleSide }), 256);
  private readonly streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: this.maps.tracer, color: new THREE.Color('#ffc16b').multiplyScalar(3), transparent: true, opacity: .9,
      blending: THREE.AdditiveBlending, alphaTest: .02, depthWrite: true, side: THREE.DoubleSide }), 256);
  private readonly torpedoBodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.5, 1, 3, 8),
    new THREE.MeshBasicMaterial({ color: '#82948f' }), 128);
  private readonly depthChargeBodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(.5, .5, 1, 12), new THREE.MeshBasicMaterial({ color: '#7b8d88' }), 128);
  private readonly torpedoWakes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: this.maps.wake, color: '#d7f1e7', transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide }), 128);
  private readonly lights = Array.from({ length: 4 }, () => ({ light: new THREE.PointLight('#ffd29a', 0, 145, 2), age: 1, power: 0, duration: .2 }));
  private readonly wind = new THREE.Vector3(2.4, 0, .9);
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly vertical = new THREE.Vector3();
  private readonly dummy = new THREE.Object3D();
  private readonly tracerBasis = new THREE.Matrix4();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraRotation = new THREE.Quaternion();
  private sequence = 0;
  private fireTick = -1;
  private lightCursor = 0;
  private shellCount = 0;
  private torpedoCount = 0;
  private depthChargeCount = 0;

  constructor() {
    this.root.name = 'Combat effects';
    this.projectiles.name = 'Shell bodies'; this.streaks.name = 'Shell streaks'; this.shellGlows.name = 'Shell glows';
    this.streaks.material.forceSinglePass = true; this.shellGlows.material.forceSinglePass = true;
    this.smoke.mesh.name = 'Propellant and impact volumes';
    this.spouts.mesh.name = 'Aerated water volumes';
    this.spray.mesh.name = 'Water droplets and mist';
    this.pools.forEach(pool => this.root.add(pool.mesh));
    this.depthChargeBodies.name = 'Depth charge bodies';
    this.torpedoBodies.name = 'Torpedo bodies'; this.torpedoWakes.name = 'Torpedo surface wakes';
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.torpedoWakes, this.depthChargeBodies]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.instanceMatrix.array.fill(0); this.root.add(mesh);
    }
    this.lights.forEach(({ light }) => this.root.add(light));
  }

  setWind(speed: number): void { this.wind.set(speed * .28, 0, speed * .11); }
  setSun(direction: THREE.Vector3): void { this.sun.value.copy(direction); }

  update(sim: CombatSimulation, dt: number, camera: THREE.Camera, hidePlayerSmoke = false): void {
    // Advance before emitting: a slow frame still gets one visible muzzle flash.
    for (const item of this.lights) {
      item.age += dt;
      item.light.intensity = item.age < item.duration ? item.power * Math.exp(-item.age / item.duration * 5) : 0;
    }
    const updatePool = (pool: EffectParticlePool, elapsed: number) => pool.update(elapsed, camera, this.wind,
      hidePlayerSmoke && pool === this.smoke ? sim.player.motion.id : undefined);
    this.pools.forEach(pool => updatePool(pool, dt));
    let emitted = false;
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      this.emit(event); emitted = true;
    }
    if (emitted) this.pools.forEach(pool => updatePool(pool, 0));
    if (dt > 0 && sim.tick >= this.fireTick + 15) {
      this.fireTick = sim.tick;
      let count = 0;
      for (const actor of sim.actors) for (let i = 0; i < actor.mounts.length && count < 32; i++) {
        const intensity = actor.damage.control.mounts[i].intensity;
        if (intensity <= 0 || actor.damage.sunk) continue;
        count++;
        const m = actor.definition.mounts[i];
        this.position.fromArray(localToWorld([m.position[0], m.position[1] + m.weapon.gunhouseSize[2], m.position[2]], actor.motion));
        const flame = this.fire.emit(this.position); flame.size = 2 * intensity; flame.growth = 2; flame.life = .6;
        flame.velocity.set(0, 2, 0); flame.opacity = .6; flame.color.copy(WARM);
        const smoke = this.smoke.emit(this.position); smoke.size = 3; smoke.growth = 2; smoke.life = 5;
        smoke.velocity.set(0, 3, 0); smoke.opacity = .35 * intensity; smoke.color.copy(SMOKE).multiplyScalar(.4);
      }
      this.pools.forEach(pool => updatePool(pool, 0));
    }
    this.updateShells(sim, camera);
    this.updateTorpedoes(sim);
    this.depthChargeCount = Math.min(sim.depthCharges.length, 128);
    sim.depthCharges.slice(0, 128).forEach((charge, i) => {
      this.dummy.position.fromArray(charge.position);
      this.dummy.rotation.set(Math.PI / 2, 0, charge.submerged ? 0 : charge.age * 2);
      this.dummy.scale.set(charge.weapon.diameterM, charge.weapon.lengthM, charge.weapon.diameterM);
      this.dummy.updateMatrix(); this.depthChargeBodies.setMatrixAt(i, this.dummy.matrix);
    });
    this.depthChargeBodies.instanceMatrix.array.fill(0, this.depthChargeCount * 16);
    this.depthChargeBodies.instanceMatrix.needsUpdate = true;
  }

  private updateTorpedoes(sim: CombatSimulation): void {
    const count = Math.min(sim.torpedoes.length, 128);
    this.torpedoCount = count;
    for (let i = 0; i < count; i++) {
      const t = sim.torpedoes[i];
      this.direction.fromArray(t.velocity).normalize();
      this.dummy.position.fromArray(t.position);
      this.dummy.quaternion.setFromUnitVectors(UP, this.direction);
      this.dummy.scale.set(t.weapon.diameterM, t.weapon.lengthM / 2, t.weapon.diameterM);
      this.dummy.updateMatrix(); this.torpedoBodies.setMatrixAt(i, this.dummy.matrix);
      const surface = t.position[1] > 0 ? 0 : THREE.MathUtils.clamp((t.position[1] + 6) / 4, 0, 1);
      const length = Math.max(0, Math.min(60, t.distance)) * surface;
      // Surface trails follow the horizontal course, even during depth settling.
      // Place the center using the displayed length so its tip stays on the round.
      this.direction.y = 0; this.direction.normalize();
      this.dummy.position.addScaledVector(this.direction, -length / 2);
      this.dummy.position.y = .45;
      // Flattening the XY plane maps +Y to north (-Z); its in-plane rotation
      // must oppose the clockwise course or diagonal wakes point across the run.
      this.dummy.rotation.set(-Math.PI / 2, 0, -Math.atan2(this.direction.x, -this.direction.z));
      if (length > 0 && this.direction.lengthSq() > 0) this.dummy.scale.set(3 * surface, length, 1);
      else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix(); this.torpedoWakes.setMatrixAt(i, this.dummy.matrix);
    }
    for (const mesh of [this.torpedoBodies, this.torpedoWakes]) {
      mesh.instanceMatrix.array.fill(0, count * 16); mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateShells(sim: CombatSimulation, camera: THREE.Camera): void {
    const count = Math.min(sim.shells.length, 256);
    this.shellCount = count;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraRotation);
    for (let i = 0; i < count; i++) {
      const shell = sim.shells[i];
      this.position.fromArray(shell.position);
      this.direction.fromArray(shell.velocity).normalize();
      if (this.direction.lengthSq() === 0) this.direction.copy(UP);
      this.dummy.position.copy(this.position);
      this.dummy.quaternion.setFromUnitVectors(UP, this.direction);
      this.dummy.scale.setScalar(shell.caliberM);
      this.dummy.updateMatrix(); this.projectiles.setMatrixAt(i, this.dummy.matrix);
      // Preserve physical shell size, with a luminous tip that remains legible at
      // battle distances. Projection scale follows binocular zoom as well as range.
      this.normal.copy(this.position).applyMatrix4(camera.matrixWorldInverse);
      const depth = camera.projectionMatrix.elements[11] === -1 ? Math.max(.1, -this.normal.z) : 1;
      const viewHeight = 2 * depth / camera.projectionMatrix.elements[5];
      const glowSize = shell.lodged ? 0 : Math.max(shell.caliberM * 3, Math.min(64, viewHeight * .005));
      this.dummy.quaternion.copy(this.cameraRotation);
      this.dummy.scale.set(glowSize, glowSize, 1);
      this.dummy.updateMatrix(); this.shellGlows.setMatrixAt(i, this.dummy.matrix);

      // A short exposure of the CPU velocity forms a warm, tapered ribbon.
      // Its tip ends at the shell and its tail cannot extend behind a fresh muzzle.
      const speed = Math.hypot(...shell.velocity);
      const exposure = .16 * THREE.MathUtils.clamp((shell.caliberM / .38) ** .35, .4, 1.2);
      const length = shell.lodged ? 0 : Math.min(150, speed * Math.min(exposure, shell.age));
      this.dummy.position.addScaledVector(this.direction, -length / 2);
      this.normal.subVectors(this.cameraPosition, this.dummy.position).normalize();
      this.across.crossVectors(this.direction, this.normal);
      // End-on trails collapse naturally; the round tip stays visible in shell follow.
      if (this.across.lengthSq() < 1e-8) {
        this.normal.set(1, 0, 0);
        if (Math.abs(this.direction.x) > .9) this.normal.copy(UP);
        this.across.crossVectors(this.direction, this.normal);
      }
      this.across.normalize();
      this.normal.crossVectors(this.across, this.direction).normalize();
      this.tracerBasis.makeBasis(this.across, this.direction, this.normal);
      this.dummy.quaternion.setFromRotationMatrix(this.tracerBasis);
      this.dummy.scale.set(Math.max(shell.caliberM * 1.6, Math.min(24, viewHeight * .0026)), length, 1);
      this.dummy.updateMatrix(); this.streaks.setMatrixAt(i, this.dummy.matrix);
    }
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows]) {
      mesh.instanceMatrix.array.fill(0, count * 16); mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private emit(event: CombatEvent): void {
    const random = randomFor(event.sequence * 7919 + (event.shell?.id ?? 0));
    const scale = THREE.MathUtils.clamp((event.shell?.caliberM ?? .38) / .38, .25, 1.7);
    this.position.fromArray(event.position);
    this.direction.fromArray(event.shell?.velocity ?? [0, 0, -1]).normalize();
    this.across.crossVectors(this.direction, UP).normalize();
    if (this.across.lengthSq() < .01) this.across.set(1, 0, 0);
    this.vertical.crossVectors(this.across, this.direction).normalize();
    if (event.kind === 'depth-charge-blast' || event.kind === 'depth-charge-splash') {
      this.position.y = 0;
      this.splash(event.kind === 'depth-charge-blast' ? 1.35 : .3, random);
    } else if (event.kind === 'torpedo-hit') {
      this.position.y = 0;
      this.splash(1.7, random);
    } else if (event.kind === 'torpedo-launch' || event.kind === 'torpedo-dud') {
      const p = this.foam.emit(this.position);
      p.position.y = .45; p.size = 3; p.growth = 1.5; p.life = 2; p.opacity = .55;
      p.color.copy(WATER);
    } else if (event.kind === 'shot') this.muzzle(scale, random, event.shipId);
    else if (event.kind === 'splash') this.splash(scale, random);
    else if (event.kind === 'burst' && event.detonation) this.shellBurst(event.blastRadiusM ?? 2, random);
    else if (event.detonation) this.detonation(scale, random, event.shipId);
    else if (event.normal) this.impact(event, scale, random);
    // Internal damage and sinking are state changes, not external fireballs.
  }

  private illuminate(power: number, duration = .2): void {
    const item = this.lights[this.lightCursor++ % this.lights.length];
    item.age = 0; item.power = power; item.duration = duration; item.light.position.copy(this.position);
    item.light.intensity = power;
  }

  private muzzle(scale: number, random: () => number, sourceId: string): void {
    const size = Math.pow(scale, .8);
    this.illuminate(28000 * size * size, .75);
    // Short white ignition sits inside the much larger, longer-lived hot gas volume.
    for (let i = 0; i < 3; i++) {
      const p = this.fire.emit(this.position);
      p.position.addScaledVector(this.direction, (2 + i * 4) * size);
      p.velocity.copy(this.direction).multiplyScalar(38 * size);
      p.size = (7 + i * 3) * size; p.growth = 45 * size;
      p.life = .11 + i * .05; p.color.copy(WARM).multiplyScalar(3);
      p.opacity = .8; p.drag = 3;
    }
    // The same evolving 3D density field cools from fire into propellant smoke.
    // Few overlapping volumes avoid a stack of identical flat cotton-ball sprites.
    for (let i = 0; i < 3; i++) {
      const p = this.smoke.emit(this.position, sourceId), angle = random() * Math.PI * 2;
      const spread = random() * 6 * size;
      p.position.addScaledVector(this.direction, (4 + i * 10) * size)
        .addScaledVector(this.across, Math.cos(angle) * spread)
        .addScaledVector(this.vertical, Math.sin(angle) * spread);
      p.velocity.copy(this.direction).multiplyScalar((45 + random() * 32) * size)
        .addScaledVector(this.across, Math.cos(angle) * (5 + random() * 8) * size)
        .addScaledVector(this.vertical, Math.sin(angle) * (3 + random() * 6) * size);
      p.velocity.y += 2;
      p.size = (14 + random() * 9) * size; p.growth = (48 + random() * 24) * size; p.growthDecay = 2.6;
      p.diffusion = (.9 + random() * .6) * size;
      p.life = 4.5 + random() * 1.5; p.drag = 2.3 + random() * .35;
      p.gravity = -1 - random() * 1.2; p.wind = .5 + random() * .25;
      p.heat = .85 + random() * .15; p.cooling = (.62 + random() * .2) * Math.sqrt(size);
      p.opacity = .92; p.density = 3.2 + random() * 1.1;
      p.color.copy(SMOKE).multiplyScalar(.88 + random() * .16);
    }
    if (scale > .6 && this.position.y < 22) {
      const p = this.foam.emit(this.position);
      p.position.addScaledVector(this.direction, 10 * size); p.position.y = .45;
      p.size = 8 * size; p.growth = 80 * size; p.life = .65; p.opacity = .06;
      p.align = 'water'; p.color.copy(WATER);
    }
  }

  private splash(scale: number, random: () => number): void {
    const size = Math.pow(scale, .65);
    this.position.y = .35;
    // A continuous column of aerated water separates into rounded, expanding lobes.
    // No water element rotates with velocity, so nothing flips at its ballistic apex.
    for (let i = 0; i < 8; i++) {
      const p = this.spouts.emit(this.position), angle = random() * Math.PI * 2;
      const height = i / 7, radial = (1 + random() * 3) * size;
      p.velocity.set(Math.cos(angle) * radial, (10 + height * 26) * Math.sqrt(size), Math.sin(angle) * radial)
        .addScaledVector(this.direction, 2 * size);
      p.size = (4 + random() * 2 + (1 - height) * 3) * size;
      p.growth = (3 + random() * 3) * size; p.growthDecay = .65;
      p.life = 3 + height * 1.6; p.age = -random() * .1; p.drag = .12; p.gravity = 9.81;
      p.waterline = true; p.opacity = .9; p.density = 3.5;
      p.color.copy(WATER);
    }
    for (let i = 0; i < 132; i++) {
      const p = this.spray.emit(this.position), angle = random() * Math.PI * 2;
      const speed = (2 + random() ** 2 * 14) * size;
      p.velocity.set(Math.cos(angle) * speed, (8 + random() * 28) * Math.sqrt(size), Math.sin(angle) * speed);
      p.size = (.2 + random() ** 2 * .85) * size; p.growth = .08;
      p.life = 4 + random() * 2; p.age = -random() * .22;
      p.drag = .08 + random() * .12; p.gravity = 9.81; p.waterline = true;
      p.opacity = .86; p.color.copy(WATER); p.angle = random() * 6;
    }
    // Fine mist spreads over the surface while the heavy water falls back.
    for (let i = 0; i < 14; i++) {
      const p = this.spray.emit(this.position), angle = random() * Math.PI * 2;
      p.position.y = 1 + random() * 2;
      p.velocity.set(Math.cos(angle) * 4 * size, 1 + random(), Math.sin(angle) * 4 * size);
      p.size = (3 + random() * 3) * size; p.growth = 2.5 * size;
      p.age = -.25 - random() * 1.3; p.life = 4.5; p.drag = .6; p.wind = .45;
      p.opacity = .14; p.fadeIn = .4; p.color.copy(WATER); p.angle = random() * 6;
    }
    // ShipWake stamps the remaining foam onto the ocean's own displaced surface.
  }

  private impact(event: CombatEvent, scale: number, random: () => number): void {
    this.normal.fromArray(event.normal!).normalize();
    // Polygon winding may face either side; contact fragments leave the incoming side.
    if (this.normal.dot(this.direction) > 0) this.normal.negate();
    this.position.addScaledVector(this.normal, .25);
    const size = Math.sqrt(scale), ricochet = event.kind === 'ricochet';
    if (ricochet) this.direction.reflect(this.normal);
    else this.direction.copy(this.normal);
    this.illuminate(2500 * scale);
    const flash = this.fire.emit(this.position);
    flash.size = 4 * size; flash.growth = 15 * size; flash.life = .12;
    flash.color.copy(WARM).multiplyScalar(2);
    for (let i = 0; i < 22; i++) {
      const p = this.fire.emit(this.position);
      p.velocity.copy(this.direction).multiplyScalar((12 + random() * (ricochet ? 75 : 38)) * size);
      p.velocity.x += (random() - .5) * 20 * size;
      p.velocity.y += (random() - .3) * 20 * size;
      p.velocity.z += (random() - .5) * 20 * size;
      p.size = (.12 + random() * .24) * size; p.stretch = 5 + random() * 10;
      p.align = 'velocity'; p.life = .25 + random() * .7; p.gravity = 9.81; p.drag = .6;
      p.color.copy(WARM).multiplyScalar(1.7); p.waterline = true;
    }
    for (let i = 0; i < 9; i++) {
      const p = this.smoke.emit(this.position, event.shipId);
      p.velocity.copy(this.normal).multiplyScalar((2 + random() * 10) * size);
      p.velocity.y += 1 + random() * 3;
      p.size = (1.5 + random() * 3) * size; p.growth = 1.3 * size;
      p.life = 2 + random() * 2; p.drag = 1; p.wind = .55;
      p.color.set('#73746f'); p.opacity = .65; p.angle = random() * 6; p.spin = .12;
    }
  }

  private shellBurst(radius: number, random: () => number): void {
    const size = Math.max(.25, radius * .25);
    this.illuminate(5000 * size, .15);
    for (let i = 0; i < 6; i++) {
      const p = this.fire.emit(this.position);
      p.velocity.set((random() - .5) * size * 4, (random() - .5) * size * 4, (random() - .5) * size * 4);
      p.size = size; p.growth = size; p.life = .15 + random() * .2; p.drag = 2;
      p.color.set('#ffb56e'); p.opacity = .8;
    }
    for (let i = 0; i < 8; i++) {
      const p = this.smoke.emit(this.position);
      p.velocity.set((random() - .5) * size * 2, 1 + random() * size, (random() - .5) * size * 2);
      p.size = size; p.growth = size * .3; p.life = 2 + random() * 2;
      p.drag = 1; p.wind = .6; p.gravity = -.2; p.opacity = .55;
      p.color.set('#55524e'); p.angle = random() * 6; p.spin = .1;
    }
  }

  private detonation(scale: number, random: () => number, sourceId: string): void {
    this.position.y = Math.max(this.position.y, 2);
    this.illuminate(150000 * scale);
    for (let i = 0; i < 18; i++) {
      const p = this.fire.emit(this.position);
      p.velocity.set((random() - .5) * 22, random() * 24, (random() - .5) * 22);
      p.size = 7 + random() * 10; p.growth = 7; p.life = .4 + random() * .4; p.drag = 1.4;
      p.color.set('#ffad51'); p.opacity = .8;
    }
    for (let i = 0; i < 32; i++) {
      const p = this.smoke.emit(this.position, sourceId);
      p.velocity.set((random() - .5) * 17, 6 + random() * 21, (random() - .5) * 17);
      p.size = 6 + random() * 7; p.growth = 2; p.life = 8 + random() * 4;
      p.drag = .6; p.wind = .7; p.gravity = -.5; p.opacity = .8;
      p.color.set('#4e504e'); p.angle = random() * 6; p.spin = .1;
    }
  }

  reset(): void {
    this.pools.forEach(pool => pool.reset()); this.shellCount = 0; this.torpedoCount = 0; this.depthChargeCount = 0; this.fireTick = -1;
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.torpedoWakes, this.depthChargeBodies]) { mesh.instanceMatrix.array.fill(0); mesh.instanceMatrix.needsUpdate = true; }
    this.lights.forEach(item => { item.age = 1; item.light.intensity = 0; }); this.sequence = 0;
  }
  diagnostics() {
    return { shells: this.shellCount, torpedoes: this.torpedoCount, depthCharges: this.depthChargeCount, smoke: this.smoke.count, spray: this.spray.count + this.spouts.count,
      flashes: this.fire.count, foam: this.foam.count,
      particleCapacity: this.pools.reduce((sum, pool) => sum + pool.capacity, 0) };
  }
  dispose(): void {
    this.root.removeFromParent(); this.pools.forEach(pool => pool.dispose());
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.torpedoWakes, this.depthChargeBodies]) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
    Object.values(this.maps).forEach(map => map.dispose());
    this.volumeMap.dispose();
    this.volumeDepthTexture.dispose();
    this.lights.forEach(({ light }) => light.dispose());
  }
}

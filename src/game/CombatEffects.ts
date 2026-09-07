import { ExpandableInstances } from './ExpandableInstances';
import { localToWorld } from '../simulation/geometry';
import * as THREE from 'three/webgpu';
import { nodeObject, uniform } from 'three/tsl';
import type { CombatEvent, CombatSimulation } from '../simulation/combat';
import { EffectParticlePool, effectTexture } from './EffectParticles';
import { EffectDepthTextureNode, effectVolumeMaterial, effectVolumeTexture } from './EffectVolume';
import { WaterPlumes } from './WaterPlumes';

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
  private readonly maps = { smoke: effectTexture('smoke'), flash: effectTexture('flash'), foam: effectTexture('foam'), tracer: effectTexture('tracer'), wake: effectTexture('wake'),
    droplet: effectTexture('droplet'), spray: effectTexture('spray') };
  private readonly volumeMap = effectVolumeTexture();
  private readonly sun = uniform(new THREE.Vector3(-.55, .74, -.39).normalize());
  private readonly volumeDepthTexture = new THREE.DepthTexture(1, 1);
  private readonly volumeDepth = nodeObject(new EffectDepthTextureNode(undefined, null, this.volumeDepthTexture)).r;
  private readonly smoke = new EffectParticlePool(192, this.maps.smoke, false, effectVolumeMaterial(this.volumeMap, this.sun, this.volumeDepth, 12, true));
  private readonly spouts = new WaterPlumes(16, this.maps.spray);
  private readonly spray = new EffectParticlePool(1536, this.maps.droplet, false, undefined, true);
  private readonly mist = new EffectParticlePool(128, this.maps.spray, false, undefined, true);
  private readonly aircraftSmoke = new EffectParticlePool(768, this.maps.smoke);
  private readonly aircraftTrails = new Map<string, { position: THREE.Vector3; age: number }>();
  private readonly fire = new EffectParticlePool(256, this.maps.flash, true);
  private readonly foam = new EffectParticlePool(96, this.maps.foam);
  private readonly pools = [this.foam, this.smoke, this.aircraftSmoke, this.mist, this.spray, this.fire];
  private readonly projectiles = new ExpandableInstances(new THREE.CapsuleGeometry(.5, 2, 2, 6),
    new THREE.MeshBasicMaterial({ color: '#8c877b' }), 256);
  // Water's depth-based postprocessing otherwise classifies these low-flying
  // lights as sea pixels and erases them. Reject the transparent quad margins.
  private readonly shellGlows = new ExpandableInstances(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: this.maps.flash, color: new THREE.Color('#f3dfba').multiplyScalar(1.8), opacity: .7,
      transparent: true, blending: THREE.AdditiveBlending, alphaTest: .02, depthWrite: true, side: THREE.DoubleSide }), 256);
  private readonly streaks = new ExpandableInstances(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: this.maps.tracer, color: new THREE.Color('#e8bd85').multiplyScalar(1.6), transparent: true, opacity: .55,
      blending: THREE.AdditiveBlending, alphaTest: .02, depthWrite: true, side: THREE.DoubleSide }), 256);
  private readonly torpedoBodies = new ExpandableInstances(new THREE.CapsuleGeometry(.5, 1, 3, 8),
    new THREE.MeshBasicMaterial({ color: '#82948f' }), 128);
  private readonly depthChargeBodies = new ExpandableInstances(new THREE.CylinderGeometry(.5, .5, 1, 12), new THREE.MeshBasicMaterial({ color: '#7b8d88' }), 128);
  private readonly torpedoWakes = new ExpandableInstances(new THREE.PlaneGeometry(1, 1),
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
    this.aircraftSmoke.mesh.name = 'Falling aircraft smoke';
    this.smoke.mesh.name = 'Propellant and impact volumes';
    this.spray.mesh.name = 'Water droplets and mist';
    this.mist.mesh.name = 'Wind-carried water mist';
    this.root.add(this.spouts.mesh);
    this.pools.forEach(pool => this.root.add(pool.mesh));
    this.depthChargeBodies.name = 'Depth charge bodies';
    this.torpedoBodies.name = 'Torpedo bodies'; this.torpedoWakes.name = 'Torpedo surface wakes';
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.torpedoWakes, this.depthChargeBodies]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.instanceMatrix.array.fill(0); this.root.add(mesh);
    }
    this.lights.forEach(({ light }) => this.root.add(light));
  }

  setWind(speed: number, direction: number): void {
    // Match the ocean/funnel convention: radians from +X toward +Z.
    this.wind.set(Math.cos(direction), 0, Math.sin(direction)).multiplyScalar(speed * .35);
  }
  setSun(direction: THREE.Vector3, intensity = 1): void {
    this.sun.value.copy(direction); this.spouts.setSun(direction, intensity);
    // Tint also reaches existing airborne water when the environment changes.
    this.spray.mesh.material.color.setScalar(intensity);
    this.mist.mesh.material.color.setScalar(intensity);
  }

  update(sim: CombatSimulation, dt: number, camera: THREE.Camera, hidePlayerSmoke = false): void {
    // Advance before emitting: a slow frame still gets one visible muzzle flash.
    for (const item of this.lights) {
      item.age += dt;
      item.light.intensity = item.age < item.duration ? item.power * Math.exp(-item.age / item.duration * 5) : 0;
    }
    for (const pool of this.pools) pool.advance(dt, this.wind);
    this.spouts.advance(dt);
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      this.emit(event);
    }
    if (dt > 0 && sim.tick >= this.fireTick + 15) {
      this.fireTick = sim.tick;
      let count = 0;
      for (const actor of sim.actors) {
        if (actor.damage.sunk) continue;
        for (let i = 0; i < actor.damage.control.rooms.length && count < 32; i++) {
          const intensity = actor.damage.control.rooms[i].intensity;
          const room = actor.definition.compartments[i], vent = room.fire?.ventPosition;
          if (intensity <= 0 || !vent) continue;
          this.position.fromArray(localToWorld(vent, actor.motion));
          if (this.position.y <= 0) continue;
          count++;
          const smoke = this.smoke.emit(this.position, actor.motion.id); smoke.size = 2 + intensity * 2; smoke.growth = 2; smoke.life = 6;
          smoke.velocity.set(0, 2 + intensity, 0); smoke.wind = 1; smoke.opacity = .35 * intensity; smoke.color.copy(SMOKE).multiplyScalar(.4);
        }
        for (let i = 0; i < actor.mounts.length && count < 32; i++) {
        const intensity = actor.damage.control.mounts[i].intensity;
        if (intensity <= 0 || actor.damage.sunk) continue;
        count++;
        const m = actor.definition.mounts[i];
        this.position.fromArray(localToWorld([m.position[0], m.position[1] + m.weapon.gunhouseSize[2], m.position[2]], actor.motion));
        const flame = this.fire.emit(this.position); flame.size = 2 * intensity; flame.growth = 2; flame.life = .6;
        flame.velocity.set(0, 2, 0); flame.opacity = .6; flame.color.copy(WARM);
        const smoke = this.smoke.emit(this.position, actor.motion.id); smoke.size = 3; smoke.growth = 2; smoke.life = 5;
        smoke.velocity.set(0, 3, 0); smoke.wind = 1;
        smoke.opacity = .35 * intensity; smoke.color.copy(SMOKE).multiplyScalar(.4);
        }
      }
    }
    if (dt > 0) this.updateAircraftSmoke(sim);
    for (const pool of this.pools) pool.publish(camera,
      hidePlayerSmoke && pool === this.smoke ? sim.player.motion.id : undefined);
    this.spouts.publish(camera);
    this.updateShells(sim, camera);
    this.updateTorpedoes(sim);
    this.depthChargeCount = sim.depthCharges.length;
    sim.depthCharges.forEach((charge, i) => {
      this.dummy.position.fromArray(charge.position);
      this.dummy.rotation.set(Math.PI / 2, 0, charge.submerged ? 0 : charge.age * 2);
      this.dummy.scale.set(charge.weapon.diameterM, charge.weapon.lengthM, charge.weapon.diameterM);
      this.dummy.updateMatrix(); this.depthChargeBodies.setMatrixAt(i, this.dummy.matrix);
    });
    this.depthChargeBodies.publish(this.depthChargeCount);
  }

  private updateAircraftSmoke(sim: CombatSimulation): void {
    const active = new Set<string>();
    for (const plane of sim.aircraft) {
      if (plane.phase !== 'lost' || !plane.wreck || plane.wreck.impacted || plane.lossReason === 'Endurance exhausted') continue;
      active.add(plane.id);
      const alpha = sim.interpolationAlpha;
      this.position.fromArray(plane.previousPosition).lerp(this.direction.fromArray(plane.position), alpha);
      let trail = this.aircraftTrails.get(plane.id);
      if (!trail) {
        trail = { position: this.position.clone(), age: Math.max(0, plane.wreck.age - 1 / 60) };
        this.aircraftTrails.set(plane.id, trail);
      }
      const elapsed = plane.wreck.age - trail.age, distance = trail.position.distanceTo(this.position);
      if (elapsed < .035 && distance < 3) continue;
      // Sample along the actual travelled segment, so slower frames cannot leave dotted smoke.
      const count = Math.min(16, Math.max(1, Math.ceil(distance / 3), Math.ceil(elapsed / .055)));
      const random = randomFor(sim.tick * 17 + plane.id.length * 311);
      for (let i = 1; i <= count; i++) {
        this.normal.copy(trail.position).lerp(this.position, i / count);
        const smoke = this.aircraftSmoke.emit(this.normal);
        smoke.size = 3.6 + random() * 1.5; smoke.growth = 3.5; smoke.growthDecay = .25; smoke.diffusion = .6;
        smoke.life = 6 + random() * 2; smoke.age = elapsed * (1 - i / count);
        smoke.velocity.set((random() - .5) * 2, 1.6 + random(), (random() - .5) * 2);
        smoke.wind = .65; smoke.drag = .5; smoke.opacity = .6 + random() * .18;
        smoke.color.set('#46433f').multiplyScalar(.75 + random() * .45);
        smoke.angle = random() * Math.PI * 2; smoke.spin = (random() - .5) * .35;
      }
      const flame = this.fire.emit(this.position);
      flame.size = 2.2 + random(); flame.growth = 1.6; flame.life = .16; flame.opacity = .6;
      flame.color.set('#ff9a3c').multiplyScalar(1.6);
      flame.velocity.fromArray(plane.velocity).multiplyScalar(.45);
      trail.position.copy(this.position); trail.age = plane.wreck.age;
    }
    for (const id of this.aircraftTrails.keys()) if (!active.has(id)) this.aircraftTrails.delete(id);
  }

  private updateTorpedoes(sim: CombatSimulation): void {
    const count = sim.torpedoes.length;
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
      mesh.publish(count);
    }
  }

  private updateShells(sim: CombatSimulation, camera: THREE.Camera): void {
    const shells = sim.shells.filter(shell => !shell.bomb);
    const count = shells.length;
    this.shellCount = count;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraRotation);
    for (let i = 0; i < count; i++) {
      const shell = shells[i];
      this.position.fromArray(shell.position);
      this.direction.fromArray(shell.velocity).normalize();
      if (this.direction.lengthSq() === 0) this.direction.copy(UP);
      this.dummy.position.copy(this.position);
      this.dummy.quaternion.setFromUnitVectors(UP, this.direction);
      this.dummy.scale.setScalar(shell.caliberM);
      this.dummy.updateMatrix(); this.projectiles.setMatrixAt(i, this.dummy.matrix);
      // Preserve physical shell size, with a restrained tip for tracking at range.
      // Projection scale follows binocular zoom without enlarging the glow.
      this.normal.copy(this.position).applyMatrix4(camera.matrixWorldInverse);
      const depth = camera.projectionMatrix.elements[11] === -1 ? Math.max(.1, -this.normal.z) : 1;
      const viewHeight = 2 * depth / camera.projectionMatrix.elements[5];
      const glowSize = shell.lodged ? 0 : Math.max(shell.caliberM * 2, Math.min(32, viewHeight * .0025));
      this.dummy.quaternion.copy(this.cameraRotation);
      this.dummy.scale.set(glowSize, glowSize, 1);
      this.dummy.updateMatrix(); this.shellGlows.setMatrixAt(i, this.dummy.matrix);

      // A short exposure of the CPU velocity forms a warm, tapered ribbon.
      // Its tip ends at the shell and its tail cannot extend behind a fresh muzzle.
      const speed = Math.hypot(...shell.velocity);
      const exposure = .075 * THREE.MathUtils.clamp((shell.caliberM / .38) ** .35, .4, 1.2);
      const length = shell.lodged ? 0 : Math.min(72, speed * Math.min(exposure, shell.age));
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
      this.dummy.scale.set(Math.max(shell.caliberM * 1.15, Math.min(12, viewHeight * .0013)), length, 1);
      this.dummy.updateMatrix(); this.streaks.setMatrixAt(i, this.dummy.matrix);
    }
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows]) {
      mesh.publish(count);
    }
  }

  private emit(event: CombatEvent): void {
    const random = randomFor(event.sequence * 7919 + (event.shell?.id ?? 0));
    const scale = THREE.MathUtils.clamp((event.shell?.caliberM ?? .38) / .38, .25, 1.7);
    this.position.fromArray(event.position);
    this.direction.fromArray(event.shell?.velocity ?? [0, -1, 0]).normalize();
    this.across.crossVectors(this.direction, UP).normalize();
    if (this.across.lengthSq() < .01) this.across.set(1, 0, 0);
    this.vertical.crossVectors(this.across, this.direction).normalize();
    if (event.kind === 'aircraft-crash') {
      this.direction.fromArray(event.aircraft?.velocity ?? [0, -1, 0]).normalize();
      this.splash(1.3, random);
      // Forward-moving wreckage throws a broad low fan beyond the main water column.
      this.direction.y = 0; this.direction.normalize();
      for (let i = 0; i < 30; i++) {
        const p = this.spray.emit(this.position);
        p.velocity.copy(this.direction).multiplyScalar(8 + random() * 22);
        p.velocity.x += (random() - .5) * 18; p.velocity.z += (random() - .5) * 18; p.velocity.y = 5 + random() * 14;
        p.size = 1 + random() * 2; p.growth = 1.5; p.life = 3; p.gravity = 9.81; p.drag = .3; p.waterline = true; p.opacity = .7; p.color.copy(WATER);
      }
    } else if (event.kind === 'depth-charge-blast' || event.kind === 'depth-charge-splash') {
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
    else if (event.kind === 'splash') this.splash(THREE.MathUtils.clamp((event.shell?.caliberM ?? .38) / .38, .035, 1.7), random, event.position[1]);
    else if (event.kind === 'burst' && event.detonation && event.waterBurstY !== undefined) {
      const attenuation = Math.exp(Math.min(0, event.position[1] - event.waterBurstY) / 12);
      this.position.y = event.waterBurstY;
      this.splash(Math.min(2, (event.blastRadiusM ?? 2) / 3) * attenuation, random, event.waterBurstY);
    } else if (event.kind === 'contact' && event.hullDamage !== undefined) {
      this.position.y = Math.max(0, event.position[1]); this.splash(.45, random);
    } else if (event.kind === 'burst' && event.detonation) this.shellBurst(event.blastRadiusM ?? 2, random);
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

  private splash(scale: number, random: () => number, surfaceY = 0): void {
    const size = Math.pow(scale, .65);
    const rootSize = Math.sqrt(size);
    const lift = .8 + .2 * Math.sqrt(Math.min(1, Math.abs(this.direction.y)));
    const lean = (1.5 + 4.5 * (1 - Math.min(1, Math.abs(this.direction.y)))) * rootSize;
    this.position.y = surfaceY + .35;
    this.spouts.emit(this.position, size, this.direction, random);
    // Fine droplets fringe the dense water body and its low outward crown.
    const droplets = Math.ceil(96 * Math.min(1, size));
    for (let i = 0; i < droplets; i++) {
      const p = this.spray.emit(this.position), angle = random() * Math.PI * 2;
      const crown = i < droplets / 4;
      const speed = (crown ? 8 + random() * 13 : 1 + random() ** 2 * 7) * rootSize;
      p.velocity.set(Math.cos(angle) * speed + this.direction.x * lean,
        (crown ? 7 + random() * 10 : 13 + random() * 29) * rootSize * lift,
        Math.sin(angle) * speed + this.direction.z * lean);
      p.size = (.09 + random() ** 2 * .42) * size; p.growth = .015 * size;
      p.life = 2 * p.velocity.y / 9.81 + .4; p.age = -random() * .16;
      p.drag = .12; p.gravity = 9.81; p.waterline = true; p.surfaceY = surfaceY;
      p.wind = .04; p.opacity = .86; p.color.copy(WATER).multiplyScalar(.8 + random() * .2);
      p.angle = random() * Math.PI * 2;
    }
    // Returning water lifts a low, wind-carried veil around the foam footprint.
    for (let i = 0; i < 8; i++) {
      const p = this.mist.emit(this.position), angle = random() * Math.PI * 2;
      const delay = (1.5 + random() * 1.8) * rootSize;
      const radius = (5 + random() * 10) * size;
      p.position.x += Math.cos(angle) * radius + this.direction.x * lean * delay;
      p.position.z += Math.sin(angle) * radius + this.direction.z * lean * delay;
      p.position.y += .5;
      p.velocity.set(Math.cos(angle) * 2 * rootSize, 1.5, Math.sin(angle) * 2 * rootSize);
      p.size = (3 + random() * 3) * size; p.growth = 1.8 * size; p.growthDecay = .4;
      p.age = -delay; p.life = 3 + random(); p.drag = .6; p.wind = .8; p.gravity = .8;
      p.waterline = true; p.surfaceY = surfaceY;
      p.opacity = .15; p.fadeIn = .3; p.color.copy(WATER); p.angle = random() * Math.PI * 2;
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
    this.pools.forEach(pool => pool.reset()); this.spouts.reset(); this.aircraftTrails.clear(); this.shellCount = 0; this.torpedoCount = 0; this.depthChargeCount = 0; this.fireTick = -1;
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.torpedoWakes, this.depthChargeBodies]) { mesh.publish(0); }
    this.lights.forEach(item => { item.age = 1; item.light.intensity = 0; }); this.sequence = 0;
  }
  diagnostics() {
    return { shells: this.shellCount, torpedoes: this.torpedoCount, depthCharges: this.depthChargeCount, smoke: this.smoke.count + this.aircraftSmoke.count, aircraftSmoke: this.aircraftSmoke.count, spray: this.spray.count + this.spouts.particleCount + this.mist.count,
      flashes: this.fire.count, foam: this.foam.count,
      particleCapacity: this.spouts.particleCapacity + this.pools.reduce((sum, pool) => sum + pool.capacity, 0) };
  }
  dispose(): void {
    this.root.removeFromParent(); this.pools.forEach(pool => pool.dispose()); this.spouts.dispose();
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.torpedoWakes, this.depthChargeBodies]) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
    Object.values(this.maps).forEach(map => map.dispose());
    this.volumeMap.dispose();
    this.volumeDepthTexture.dispose();
    this.lights.forEach(({ light }) => light.dispose());
  }
}

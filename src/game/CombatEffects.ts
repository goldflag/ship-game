import type { BattleSession } from './session/BattleSession';
import { LocalizedFireEffects, type FireDisplayPose } from './LocalizedFireEffects';
import { ExpandableInstances } from './ExpandableInstances';
import { localToWorld } from './geometry';
import * as THREE from 'three/webgpu';
import { attribute, color, mix, positionGeometry, uniform } from 'three/tsl';
import { FIXED_DT } from './session/motion';
import { EffectParticlePool, effectTexture } from './EffectParticles';
import { GasAtlas, gasSpriteMaterial } from './GasAtlas';
import { EffectLighting } from './EffectLighting';
import { rejectTemporalHistory } from './TemporalAntialiasing';
import { WaterPlumes } from './WaterPlumes';
import { applySpraySprite } from './SprayMaterial';
import { smokeBillowTexture } from './SmokeSpriteMaterial';
import { shellGeometry } from '../../assets/effects/naval/shellGeometry';
import { ShellTrails } from './ShellTrails';
import { BlastEffects } from './BlastEffects';
import { writeInstancePose } from './instancePose';
import type { CombatEvent } from '../game/session/elements';

const UP = new THREE.Vector3(0, 1, 0);
const WATER = new THREE.Color('#e7f2f1');
/** Flash light reaching smoke, per unit of point-light power (see VolumeIllumination.flashes). */
const FLASH_ON_SMOKE = .06;

function projectileGeometry(detailed: boolean, capacity: number): THREE.LatheGeometry {
  const geometry = shellGeometry(detailed);
  geometry.setAttribute('shellHeat', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  return geometry;
}

function projectileMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: .45, roughness: .36 });
  // Illustrative incandescence: an orange body and a hotter gold nose. The
  // original vertex finish keeps the engraved bands visible through the heat.
  // Emission and the existing halo need no per-shell light or bloom pass.
  const nose = positionGeometry.y.add(1.8).div(4.15).clamp(0, 1).pow(2);
  material.emissiveNode = mix(color('#ff3c08'), color('#ffce83'), nose)
    .mul(mix(.8, 2.6, nose)).mul(attribute('shellHeat', 'float'))
    .mul(attribute<'vec3'>('color', 'vec3').mul(.35).add(.65));
  return material;
}

/** Visual randomness is local and seeded by the event; combat never consumes it. */
function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Ballistics come from the CPU simulation. Only gas, spray and fragments live here. */
export class CombatEffects {
  readonly root = new THREE.Group();
  private readonly maps = { smoke: effectTexture('smoke'), flash: effectTexture('flash'), shellGlow: effectTexture('glow'), foam: effectTexture('foam'), tracer: effectTexture('tracer'),
    droplet: effectTexture('droplet'), billow: smokeBillowTexture() };
  /** Baked puffs of smoke and fire that every gas sprite relights (filled by `prepare`). */
  readonly gasAtlas = new GasAtlas();
  private readonly ownsLighting: boolean;
  /** Scene light, wind and depth, shared with ship fires and funnel exhaust. */
  readonly lighting: EffectLighting;
  private readonly wind: THREE.Vector3;
  private readonly smoke: EffectParticlePool;
  // Splash water, created in its drawing order: the billowing spray around a column's base, the jets rising
  // out of it (their streaks run on over the billows), drops, then mist.
  /** The dense, lumpy spray around a splash's base and the low wall of it rolling out over the sea. */
  private readonly billows: EffectParticlePool;
  private readonly spouts: WaterPlumes;
  private readonly spray: EffectParticlePool;
  private readonly mist: EffectParticlePool;
  private readonly aircraftSmoke: EffectParticlePool;
  private readonly flakSmoke: EffectParticlePool;
  private readonly airbursts = new Map<number, CombatEvent>();
  private readonly aircraftTrails = new Map<string, { position: THREE.Vector3; age: number }>();
  private readonly fire = new EffectParticlePool(512, this.maps.flash, true, undefined, false, true);
  private readonly foam = new EffectParticlePool(96, this.maps.foam, false, undefined, false, true);
  private readonly pools: EffectParticlePool[];
  private readonly projectiles = new ExpandableInstances(projectileGeometry(false, 256), projectileMaterial(), 256);
  private readonly detailedProjectiles = new ExpandableInstances(projectileGeometry(true, 16), this.projectiles.material, 16);
  private readonly shellTrails = new ShellTrails();
  // Water's depth-based postprocessing otherwise classifies these low-flying
  // lights as sea pixels and erases them. Reject the transparent quad margins.
  private readonly shellGlows = new ExpandableInstances(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: this.maps.shellGlow, color: new THREE.Color('#ffaa44').multiplyScalar(2.4), opacity: .35,
      transparent: true, blending: THREE.AdditiveBlending, alphaTest: .004, depthWrite: true, side: THREE.DoubleSide }), 256);
  private readonly streaks = new ExpandableInstances(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: this.maps.tracer, color: new THREE.Color('#fff1d0').multiplyScalar(3.2), transparent: true, opacity: .9,
      blending: THREE.AdditiveBlending, alphaTest: .02, depthWrite: true, side: THREE.DoubleSide }), 256);
  private readonly torpedoBodies = new ExpandableInstances(new THREE.CapsuleGeometry(.5, 1, 3, 8),
    new THREE.MeshBasicMaterial({ color: '#82948f' }), 128);
  private readonly depthChargeBodies = new ExpandableInstances(new THREE.CylinderGeometry(.5, .5, 1, 12), new THREE.MeshBasicMaterial({ color: '#7b8d88' }), 128);
  private readonly lights = Array.from({ length: 4 }, () => ({ light: new THREE.PointLight('#ffd29a', 0, 145, 2), age: 1, power: 0, duration: .2 }));
  /** The same four flashes as seen by the gas shader: xyz position, w current power. */
  private readonly flashes = this.lights.map(() => uniform(new THREE.Vector4()));
  private readonly blasts: BlastEffects;
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly vertical = new THREE.Vector3();
  private readonly streak = new THREE.Vector3();
  // Instance poses need no Object3D: its rotation would re-derive an Euler angle at every quaternion change.
  private readonly pose = new THREE.Quaternion();
  private readonly tumble = new THREE.Euler();
  private readonly tracerBasis = new THREE.Matrix4();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraRotation = new THREE.Quaternion();
  private sequence = 0;
  private readonly localFires: LocalizedFireEffects;
  private lightCursor = 0;
  private shellCount = 0;
  private torpedoCount = 0;
  private depthChargeCount = 0;

  constructor(lighting?: EffectLighting) {
    this.ownsLighting = !lighting;
    this.lighting = lighting ?? new EffectLighting();
    this.wind = this.lighting.wind;
    this.billows = new EffectParticlePool(320, this.maps.billow, false, undefined, false, true);
    applySpraySprite(this.billows.mesh.material, this.lighting, this.maps.billow);
    this.spouts = new WaterPlumes(640, this.lighting);
    this.spray = new EffectParticlePool(1536, this.maps.droplet, false, undefined, true);
    this.mist = new EffectParticlePool(192, this.maps.smoke, false, undefined, true);
    const gas = { lighting: this.lighting, flashes: this.flashes };
    this.smoke = new EffectParticlePool(768, this.maps.smoke, false, gasSpriteMaterial(this.gasAtlas, gas), false, true);
    this.aircraftSmoke = new EffectParticlePool(768, this.maps.smoke, false, gasSpriteMaterial(this.gasAtlas, gas), false, true);
    this.flakSmoke = new EffectParticlePool(256, this.maps.smoke, false, gasSpriteMaterial(this.gasAtlas, gas), false, true);
    this.pools = [this.foam, this.smoke, this.aircraftSmoke, this.flakSmoke, this.mist, this.billows, this.spray, this.fire];
    this.localFires = new LocalizedFireEffects(this.lighting, this.gasAtlas);
    this.blasts = new BlastEffects({ volumes: this.smoke, gasMaterial: () => gasSpriteMaterial(this.gasAtlas, gas), fire: this.fire, foam: this.foam,
      mist: this.mist, spray: this.spray, spouts: this.spouts,
      illuminate: (position, power, duration, distance) => this.illuminate(position, power, duration, distance) }, this.lighting);
    this.root.name = 'Combat effects';
    this.root.add(this.localFires.root, this.shellTrails.mesh, this.blasts.root);
    this.projectiles.name = 'Shell bodies'; this.streaks.name = 'Shell streaks'; this.shellGlows.name = 'Shell glows';
    this.detailedProjectiles.name = 'Detailed shell bodies'; this.root.add(this.detailedProjectiles);
    this.streaks.material.forceSinglePass = true; this.shellGlows.material.forceSinglePass = true;
    this.aircraftSmoke.mesh.name = 'Falling aircraft smoke';
    this.flakSmoke.mesh.name = 'Heavy AA burst smoke';
    this.smoke.mesh.name = 'Propellant and impact volumes';
    this.spray.mesh.name = 'Water droplets and mist';
    this.mist.mesh.name = 'Wind-carried water mist';
    this.billows.mesh.name = 'Splash spray billows';
    this.root.add(this.spouts.mesh);
    this.pools.forEach(pool => this.root.add(pool.mesh));
    this.depthChargeBodies.name = 'Depth charge bodies';
    this.torpedoBodies.name = 'Torpedo bodies';
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.depthChargeBodies]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.instanceMatrix.array.fill(0); this.root.add(mesh);
      // Each instance moves on its own; temporal AA cannot follow it from the mesh.
      rejectTemporalHistory(mesh);
    }
    this.lights.forEach(({ light }) => this.root.add(light));
  }

  /** Bake the gas atlas on the renderer's GPU: once, before the first battle frame draws any gas. */
  prepare(renderer: THREE.WebGPURenderer): void { this.gasAtlas.bake(renderer); }

  setWind(speed: number, direction: number): void {
    // Match the ocean/funnel convention: radians from +X toward +Z.
    this.lighting.setWind(speed, direction);
  }
  setSun(direction: THREE.Vector3, intensity = 1): void {
    // The water jets and spray billows read the same lighting.
    this.lighting.setSun(direction, intensity);
    // Tint also reaches existing airborne water when the environment changes.
    this.spray.mesh.material.color.setScalar(intensity);
    this.mist.mesh.material.color.setScalar(intensity);
  }
  /** Match the scene's weather/daylight or moonlight; hot gas remains emissive. */
  setIllumination(color: THREE.Color, intensity: number, ambient: number): void {
    this.lighting.setIllumination(color, intensity, ambient);
  }

  /** `opticsShipId` is the hull the lens sits on: its own smoke is left out so the
   * view from its bridge stays clear, whether that is the player's ship or a followed teammate. */
  update(sim: BattleSession, dt: number, camera: THREE.Camera, opticsShipId?: string, poses?: readonly FireDisplayPose[]): void {
    // Advance before emitting: a slow frame still gets one visible muzzle flash.
    for (const item of this.lights) {
      item.age += dt;
      item.light.intensity = item.age < item.duration ? item.power * Math.exp(-item.age / item.duration * 5) : 0;
    }
    for (const pool of this.pools) pool.advance(dt, this.wind);
    this.spouts.advance(dt);
    // Strikes stay attached to their hull: smouldering holes follow its display pose.
    this.blasts.setHulls(id => {
      const actor = sim.actors?.find(a => a.motion.id === id);
      if (!actor) return undefined;
      return { pose: poses?.find(p => p.actor === actor)?.motion ?? actor.motion, lengthM: actor.definition.hull.length };
    });
    this.blasts.update(dt, this.wind);
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      this.emit(event);
    }
    this.blasts.flushShots();
    this.lights.forEach((item, i) => this.flashes[i].value.set(item.light.position.x, item.light.position.y, item.light.position.z, item.light.intensity * FLASH_ON_SMOKE));
    this.updateAirbursts(sim);
    this.localFires.update(sim, dt, camera, this.wind, opticsShipId, poses);
    if (dt > 0) this.updateAircraftSmoke(sim);
    for (const pool of this.pools) pool.publish(camera, pool === this.smoke ? opticsShipId : undefined);
    this.blasts.publish(camera, opticsShipId);
    this.spouts.publish(camera);
    this.updateShells(sim, camera);
    this.shellTrails.update(sim.shells, dt, camera);
    this.updateTorpedoes(sim);
    this.depthChargeCount = sim.depthCharges.length;
    sim.depthCharges.forEach((charge, i) => {
      this.position.fromArray(charge.position);
      this.pose.setFromEuler(this.tumble.set(Math.PI / 2, 0, charge.submerged ? 0 : charge.age * 2));
      this.place(this.depthChargeBodies, i, this.position, this.pose, charge.weapon.diameterM, charge.weapon.lengthM, charge.weapon.diameterM);
    });
    this.depthChargeBodies.publish(this.depthChargeCount);
  }

  /** `mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))`, written in place. */
  private place(mesh: ExpandableInstances<THREE.BufferGeometry, THREE.Material>, index: number, position: THREE.Vector3, rotation: THREE.Quaternion, sx: number, sy: number, sz: number): void {
    writeInstancePose(mesh.page(index).instanceMatrix.array as Float32Array, index % mesh.pageSize * 16, position.x, position.y, position.z,
      rotation.x, rotation.y, rotation.z, rotation.w, sx, sy, sz);
  }

  private updateAirbursts(sim: BattleSession): void {
    const now = (sim.tick - 1 + sim.interpolationAlpha) * FIXED_DT;
    for (const [id, event] of this.airbursts) {
      const data = event.aircraft!, burst = data.airburst!;
      const age = now - event.tick * FIXED_DT - burst.flightTime;
      if (age < 0) continue;
      this.airbursts.delete(id);
      // A late frame shows the puff at its current age, without replaying an old burst.
      if (age >= 6.5) continue;
      const random = randomFor(event.sequence * 7919);
      const scale = THREE.MathUtils.clamp(Math.sqrt(burst.caliberM / .105), .8, 1.3);
      this.position.fromArray(data.target!);
      for (let i = 0; i < 3; i++) {
        // Keep flak separate from muzzle smoke: distant bursts remain visible in optics.
        const puff = this.flakSmoke.emit(this.position);
        if (i > 0) puff.position.add(new THREE.Vector3((random() - .5) * 5, (random() - .5) * 5, (random() - .5) * 5).multiplyScalar(scale));
        puff.size = (7 + random() * 3) * scale;
        puff.growth = 18 * scale; puff.growthDecay = 3; puff.diffusion = 1.1 * scale;
        puff.life = 5.5 + random(); puff.age = age; puff.opacity = .95; puff.fadeIn = .035;
        // Unequal hot lobes ignite together, then expose the charcoal cloud.
        puff.heat = i === 0 ? 1.7 : 1.3 + random() * .3;
        // Charcoal, not ink: dark grey that the sun still greys on its lit side, thinning into a smudge.
        puff.density = 2.4; puff.cooling = .3 + random() * .12; puff.dissipationTime = 2.6;
        puff.velocity.set((random() - .5) * .8, .4 + random() * .5, (random() - .5) * .8);
        puff.wind = 1; puff.seed = random() * 100;
        puff.color.set('#8c9096').multiplyScalar(.85 + random() * .3);
        puff.position.addScaledVector(puff.velocity, age).addScaledVector(this.wind, age);
      }
      // Brief radial gas fingers break up the round cloud silhouette. Their
      // world axes stay fixed as they open and cool; this is cosmetic debris.
      for (let i = 0; i < 5; i++) {
        const yaw = random() * Math.PI * 2, y = random() * 1.8 - .9;
        this.direction.set(Math.cos(yaw) * Math.sqrt(1 - y * y), y, Math.sin(yaw) * Math.sqrt(1 - y * y));
        const life = .85 + random() * .45;
        const speed = (8 + random() * 5) * scale, seed = random() * 100;
        if (age >= life) continue;
        const puff = this.flakSmoke.emit(this.position);
        puff.position.addScaledVector(this.direction, 2 * scale);
        puff.velocity.copy(this.direction).multiplyScalar(speed);
        puff.size = 4 * scale; puff.growth = 38 * scale; puff.growthDecay = 6;
        puff.volumeAspect = 3.2; puff.volumeYaw = yaw; puff.volumeAxisY = y;
        puff.life = life; puff.age = age; puff.opacity = .9;
        puff.heat = .8; puff.cooling = .18; puff.density = 2; puff.dissipationTime = .55;
        puff.wind = 1; puff.seed = seed; puff.color.set('#72767c');
        puff.position.addScaledVector(puff.velocity, age).addScaledVector(this.wind, age);
      }
      // Narrow, separated fragments leave the fireball and burn out quickly.
      // Reuse the bounded ignition batch; no per-burst objects or lights.
      for (let i = 0; i < 14; i++) {
        const life = .22 + random() * .16;
        const yaw = random() * Math.PI * 2, y = 1 - 2 * (i + .5) / 14;
        const speed = (65 + random() * 55) * scale, size = (.18 + random() * .14) * scale, stretch = 16 + random() * 12;
        if (age >= life) continue;
        const fragment = this.fire.emit(this.position);
        fragment.velocity.set(Math.cos(yaw) * Math.sqrt(1 - y * y), y, Math.sin(yaw) * Math.sqrt(1 - y * y))
          .multiplyScalar(speed);
        fragment.size = size; fragment.stretch = stretch;
        fragment.align = 'velocity'; fragment.life = life; fragment.age = age;
        fragment.gravity = 9.81; fragment.opacity = .9; fragment.color.set('#ffd391').multiplyScalar(2.5);
        fragment.position.addScaledVector(fragment.velocity, age);
        fragment.position.y -= .5 * fragment.gravity * age * age;
        fragment.velocity.y -= fragment.gravity * age;
      }
    }
  }

  private updateAircraftSmoke(sim: BattleSession): void {
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
        smoke.size = 3.2 + random() * 1.5; smoke.growth = 3.5; smoke.growthDecay = .25; smoke.diffusion = .6;
        smoke.life = 6 + random() * 2; smoke.age = elapsed * (1 - i / count);
        smoke.velocity.set((random() - .5) * 2, 1.6 + random(), (random() - .5) * 2);
        smoke.wind = .65; smoke.drag = .5; smoke.opacity = .7 + random() * .18;
        // Burning fuel and oil: dark smoke, glowing at the flame for its first moments, that thins as it spreads.
        smoke.heat = 1.1; smoke.cooling = .25 + random() * .15; smoke.density = 2.6; smoke.dissipationTime = 3;
        smoke.color.set('#5a5550').multiplyScalar(.8 + random() * .4);
      }
      const flame = this.fire.emit(this.position);
      flame.size = 2.2 + random(); flame.growth = 1.6; flame.life = .16; flame.opacity = .6;
      flame.color.set('#ff9a3c').multiplyScalar(1.6);
      flame.velocity.fromArray(plane.velocity).multiplyScalar(.45);
      trail.position.copy(this.position); trail.age = plane.wreck.age;
    }
    for (const id of this.aircraftTrails.keys()) if (!active.has(id)) this.aircraftTrails.delete(id);
  }

  private updateTorpedoes(sim: BattleSession): void {
    const count = sim.torpedoes.length;
    this.torpedoCount = count;
    for (let i = 0; i < count; i++) {
      const t = sim.torpedoes[i];
      this.direction.fromArray(t.velocity).normalize();
      this.position.fromArray(t.position);
      this.place(this.torpedoBodies, i, this.position, this.pose.setFromUnitVectors(UP, this.direction), t.weapon.diameterM, t.weapon.lengthM / 2, t.weapon.diameterM);
    }
    // ShipWake lays the bubble tracks on the ocean surface itself.
    this.torpedoBodies.publish(count);
  }

  private updateShells(sim: BattleSession, camera: THREE.Camera): void {
    const shells = sim.shells.filter(shell => !shell.bomb);
    const count = shells.length;
    this.shellCount = count;
    let detailCount = 0;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraRotation);
    for (let i = 0; i < count; i++) {
      const shell = shells[i];
      const luminous = shell.waterDragPerSecond === undefined;
      this.projectiles.setScalarAttributeAt('shellHeat', i, luminous ? 1 : 0);
      this.position.fromArray(shell.position);
      this.direction.fromArray(shell.velocity).normalize();
      if (this.direction.lengthSq() === 0) this.direction.copy(UP);
      const pose = this.pose.setFromUnitVectors(UP, this.direction);
      let body = shell.caliberM;
      // Preserve physical shell size, with a restrained tip for tracking at range.
      // Projection scale follows binocular zoom without enlarging the glow.
      this.normal.copy(this.position).applyMatrix4(camera.matrixWorldInverse);
      const depth = camera.projectionMatrix.elements[11] === -1 ? Math.max(.1, -this.normal.z) : 1;
      const viewHeight = 2 * depth / camera.projectionMatrix.elements[5];
      // Spend the engraved geometry only when the projected round can show it,
      // including binoculars. Small pages avoid submitting hundreds of detailed
      // zero-scale shells while idle (WebGPU retains each page's draw count).
      if (shell.caliberM / viewHeight > .002) {
        this.detailedProjectiles.setScalarAttributeAt('shellHeat', detailCount, luminous ? 1 : 0);
        this.place(this.detailedProjectiles, detailCount++, this.position, pose, body, body, body);
        body = 0;
      }
      this.place(this.projectiles, i, this.position, pose, body, body, body);
      // The short exposure recedes in close views; the incandescent body and
      // warm halo remain visible, including in the T follow camera.
      const tracking = THREE.MathUtils.smoothstep(this.cameraPosition.distanceTo(this.position), 65, 150);
      // Caliber also scales the screen-space visibility floor. A shared floor
      // made 20 mm rounds look as large as main-battery shells at equal range.
      const caliberScale = Math.sqrt(shell.caliberM / .38);
      const glowSize = luminous ? Math.max(shell.caliberM * 1.8, Math.min(16, viewHeight * .003) * caliberScale) : 0;
      this.place(this.shellGlows, i, this.position, this.cameraRotation, glowSize, glowSize, 1);

      // Compact white-gold exposure at the head; pale recorded trails carry the
      // longer path. Neither head nor trail extends behind a fresh muzzle.
      const speed = Math.hypot(...shell.velocity);
      const exposure = .024 * THREE.MathUtils.clamp((shell.caliberM / .38) ** .35, .4, 1.2);
      const length = luminous ? Math.min(24, speed * Math.min(exposure, shell.age)) * (.04 + .96 * tracking) : 0;
      const streak = this.streak.copy(this.position).addScaledVector(this.direction, -length / 2);
      this.normal.subVectors(this.cameraPosition, streak).normalize();
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
      this.place(this.streaks, i, streak, this.pose.setFromRotationMatrix(this.tracerBasis),
        Math.max(shell.caliberM * .55, Math.min(18, viewHeight * .0045) * caliberScale) * (.2 + .8 * tracking), length, 1);
    }
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows]) {
      mesh.publish(count);
    }
    this.detailedProjectiles.publish(detailCount);
  }

  private emit(event: CombatEvent): void {
    if (event.kind === 'aircraft-fire') {
      if (event.aircraft?.airburst && event.aircraft.target) this.airbursts.set(event.sequence, event);
      return;
    }
    const random = randomFor(event.sequence * 7919 + (event.shell?.id ?? 0));
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
    } else if (event.kind === 'shot') this.blasts.queueShot(event);
    else if (event.kind === 'splash') this.splash(THREE.MathUtils.clamp((event.shell?.caliberM ?? .38) / .38, .035, 1.7), random, event.position[1]);
    else if (event.kind === 'burst' && event.detonation && event.waterBurstY !== undefined) {
      const attenuation = Math.exp(Math.min(0, event.position[1] - event.waterBurstY) / 12);
      this.position.y = event.waterBurstY;
      this.splash(Math.min(2, (event.blastRadiusM ?? 2) / 3) * attenuation, random, event.waterBurstY);
    } else if (event.kind === 'contact' && event.hullDamage !== undefined) {
      this.position.y = Math.max(0, event.position[1]); this.splash(.45, random);
    } else if (event.kind === 'burst' && event.detonation) this.blasts.heBurst(event, random);
    else if (event.detonation) this.blasts.magazine(event, random);
    else if (event.normal) this.blasts.impact(event, random);
    // Internal damage and sinking are state changes, not external fireballs.
  }

  /** A brief point light that decays over `duration`; `distance` bounds its reach so a hit lights
   * the plating around it rather than washing the whole hull white. */
  private illuminate(position: THREE.Vector3, power: number, duration = .2, distance = 145): void {
    const item = this.lights[this.lightCursor++ % this.lights.length];
    item.age = 0; item.power = power; item.duration = duration; item.light.position.copy(position);
    item.light.distance = distance; item.light.intensity = power;
  }

  private splash(scale: number, random: () => number, surfaceY = 0): void {
    const size = Math.pow(scale, .65);
    const rootSize = Math.sqrt(size);
    const lift = .8 + .2 * Math.sqrt(Math.min(1, Math.abs(this.direction.y)));
    const lean = (2 + 5 * (1 - Math.min(1, Math.abs(this.direction.y)))) * rootSize;
    this.position.y = surfaceY + .35;
    this.spouts.emit(this.position, size, this.direction, random);
    // Coherent jets carry most of the water; small fragments fringe the
    // column and low crown. Match their launch envelope so breakup is continuous.
    for (let i = 0; i < 144; i++) {
      const p = this.spray.emit(this.position), angle = random() * Math.PI * 2;
      const crown = i < 36;
      const speed = (crown ? 8 + random() * 13 : 1 + random() ** 2 * 7) * rootSize;
      // Column drops tear from the jets, so none outrun the tallest tips.
      p.velocity.set(Math.cos(angle) * speed + this.direction.x * lean,
        (crown ? 7 + random() * 10 : 13 + random() * 24) * rootSize * lift,
        Math.sin(angle) * speed + this.direction.z * lean);
      p.size = (.1 + random() ** 2 * .35) * size; p.growth = .015 * size;
      p.life = 2 * p.velocity.y / 9.81 + .4; p.age = -random() * .16;
      p.drag = .12; p.gravity = 9.81; p.waterline = true; p.surfaceY = surfaceY;
      p.wind = .04; p.opacity = .8; p.color.copy(WATER).multiplyScalar(.8 + random() * .2);
      // Fast drops smear along their flight like rain and round out at their apex.
      p.align = 'streak'; p.stretch = 3 + random() * 3;
    }
    this.splashBillows(size, rootSize, lift, lean, random, surfaceY);
    // A translucent veil separates from the rising water, then a second low
    // veil forms where it rains back. Wind catches mist more than heavy drops.
    for (let i = 0; i < 18; i++) {
      const p = this.mist.emit(this.position), angle = random() * Math.PI * 2;
      const falling = i >= 8, delay = falling ? (1.4 + random() * 1.3) * rootSize : .65 + random() * .45;
      const radius = (falling ? 5 + random() * 10 : 1 + random() * 3) * size;
      p.position.x += Math.cos(angle) * radius + this.direction.x * lean * delay;
      p.position.z += Math.sin(angle) * radius + this.direction.z * lean * delay;
      p.position.y += falling ? .5 : (24 + random() * 10) * rootSize * lift * delay - 4.905 * delay * delay;
      p.velocity.set(Math.cos(angle) * 2 * rootSize, falling ? 1.5 : 3, Math.sin(angle) * 2 * rootSize);
      p.size = ((falling ? 2 : 4) + random() * 3) * size; p.growth = 1.8 * size; p.growthDecay = .4;
      p.age = -delay; p.life = 3 + random(); p.drag = .6; p.wind = .8; p.gravity = falling ? .8 : 1.8;
      p.waterline = true; p.surfaceY = surfaceY;
      p.opacity = falling ? .15 : .11; p.fadeIn = .3; p.color.copy(WATER); p.angle = random() * Math.PI * 2;
    }
    // ShipWake stamps the remaining foam onto the ocean's own displaced surface.
  }

  /** The dense spray around the column's base: billows ride its slower water up into a lumpy lower mass that
   * hangs and settles once the jets fall, and a low wall of spray rolls outward across the sea. Spray is water
   * and air together, so it falls slowly under drag and ends up hovering above the sea as the column collapses. */
  private splashBillows(size: number, rootSize: number, lift: number, lean: number, random: () => number, surfaceY: number): void {
    const heavy = size >= .45, body = heavy ? 6 : 3, skirt = heavy ? 7 : 4;
    for (let i = 0; i < body; i++) {
      const p = this.billows.emit(this.position), angle = random() * Math.PI * 2, radius = random() * 4 * size;
      // Stacked from the sea up: each billow stalls at its own height.
      const stack = i / (body - 1), spread = (1 + random() * 2) * rootSize;
      p.position.x += Math.cos(angle) * radius; p.position.z += Math.sin(angle) * radius;
      p.position.y = surfaceY + (2 + random() * 3) * size;
      p.velocity.set(Math.cos(angle) * spread + this.direction.x * lean * .6, (6 + stack * 13 + random() * 4) * rootSize * lift,
        Math.sin(angle) * spread + this.direction.z * lean * .6);
      p.drag = 1.1; p.gravity = 2.4; p.wind = .5;
      // The jets lead: the billows gather a moment later from the water they shed.
      p.size = (4 + random() * 2.5) * size; p.growth = (8 + random() * 4) * size; p.growthDecay = .5;
      p.life = 7 + random() * 3; p.age = -(.12 + random() * .15); p.fadeIn = .35; p.opacity = .92;
      p.angle = random() * Math.PI * 2; p.spin = (random() - .5) * .25; p.color.setRGB(.94, .97, 1);
    }
    const turn = random() * Math.PI * 2;
    for (let i = 0; i < skirt; i++) {
      const angle = turn + (i + random() * .6) / skirt * Math.PI * 2, speed = (7 + random() * 5) * rootSize;
      const p = this.billows.emit(this.position);
      p.position.x += Math.cos(angle) * 4 * size; p.position.z += Math.sin(angle) * 4 * size;
      p.position.y = surfaceY + (2.5 + random() * 2) * size;
      p.velocity.set(Math.cos(angle) * speed, (1.5 + random() * 2) * rootSize, Math.sin(angle) * speed);
      p.drag = 1.1; p.gravity = .6; p.wind = .8;
      p.size = (5 + random() * 2.5) * size; p.growth = (8 + random() * 3) * size; p.growthDecay = .35;
      p.life = 9 + random() * 4; p.age = -(.05 + random() * .15); p.fadeIn = .3; p.opacity = .85;
      p.angle = random() * Math.PI * 2; p.spin = (random() - .5) * .2; p.color.setRGB(.94, .97, 1);
    }
    if (!heavy) return;
    // The column's collapse: the falling water gathers into a dense dome of spray that settles and spreads.
    const peak = 38 * rootSize * lift;
    for (let i = 0; i < 5; i++) {
      const angle = random() * Math.PI * 2, radius = (3 + random() * 5) * size, delay = (2.2 + random()) * rootSize;
      const p = this.billows.emit(this.position);
      p.position.x += Math.cos(angle) * radius + this.direction.x * lean * 1.5;
      p.position.z += Math.sin(angle) * radius + this.direction.z * lean * 1.5;
      p.position.y = surfaceY + (.15 + i * .06 + random() * .08) * peak;
      p.velocity.set(Math.cos(angle) * 2 * rootSize, -1.5, Math.sin(angle) * 2 * rootSize);
      p.drag = 1.2; p.gravity = 1.2; p.wind = .7;
      p.size = (10 + random() * 4) * size; p.growth = (8 + random() * 3) * size; p.growthDecay = .3;
      p.life = 8 + random() * 3; p.age = -delay; p.fadeIn = .7; p.opacity = .8;
      p.angle = random() * Math.PI * 2; p.spin = (random() - .5) * .15; p.color.setRGB(.94, .97, 1);
    }
  }

  reset(): void {
    this.pools.forEach(pool => pool.reset()); this.spouts.reset(); this.shellTrails.reset(); this.aircraftTrails.clear(); this.airbursts.clear(); this.shellCount = 0; this.torpedoCount = 0; this.depthChargeCount = 0; this.localFires.reset(); this.blasts.reset();
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.depthChargeBodies]) { mesh.publish(0); }
    this.detailedProjectiles.publish(0);
    this.lights.forEach((item, i) => { item.age = 1; item.light.intensity = 0; this.flashes[i].value.w = 0; }); this.sequence = 0;
  }
  /** Fraction of combat particles emitted; funnel smoke has its own rate. */
  setDensity(density: number): void {
    for (const pool of this.pools) pool.density = density;
    this.localFires.setDensity(density); this.blasts.setDensity(density);
  }
  diagnostics() {
    const blasts = this.blasts.diagnostics();
    return { shells: this.shellCount, torpedoes: this.torpedoCount, depthCharges: this.depthChargeCount, smoke: this.smoke.count + this.aircraftSmoke.count + this.flakSmoke.count + this.localFires.diagnostics().smoke, aircraftSmoke: this.aircraftSmoke.count, flakSmoke: this.flakSmoke.count, spray: this.spray.count + this.spouts.count + this.mist.count + this.billows.count,
      flashes: this.fire.count + this.localFires.diagnostics().flames, foam: this.foam.count, shellTrails: this.shellTrails.diagnostics(),
      /** Fragments, their smoke trails and smouldering holes. */
      blasts: { soot: blasts.soot, debris: blasts.debris, smoulders: blasts.smoulders, trails: blasts.trails },
      particleCapacity: this.localFires.diagnostics().capacity + this.spouts.capacity + blasts.capacity + this.pools.reduce((sum, pool) => sum + pool.capacity, 0) };
  }
  dispose(): void {
    this.root.removeFromParent(); this.localFires.dispose(); this.blasts.dispose(); this.shellTrails.dispose(); this.pools.forEach(pool => pool.dispose()); this.spouts.dispose();
    this.detailedProjectiles.dispose(); this.detailedProjectiles.geometry.dispose();
    for (const mesh of [this.projectiles, this.streaks, this.shellGlows, this.torpedoBodies, this.depthChargeBodies]) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
    Object.values(this.maps).forEach(map => map.dispose());
    this.gasAtlas.dispose();
    if (this.ownsLighting) this.lighting.dispose();
    this.lights.forEach(({ light }) => light.dispose());
  }
}

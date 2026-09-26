import type { BattleSession } from './session/BattleSession';
import * as THREE from 'three/webgpu';
import { mountFrame } from './mountFrames';
import type { Vec3 } from '../ships/blueprint';
import { localToWorld } from './geometry';
import { motionVelocity } from './session/motion';
import { EffectParticlePool, effectTexture } from './EffectParticles';
import { effectVolumeTexture } from './EffectVolume';
import { FireBatch } from './FireBatch';
import { fireBodyInputs, fireFlameMaterial, fireSmokeMaterial } from './FireMaterials';
import { GasAtlas, gasSpriteMaterial } from './GasAtlas';
import { vec3 } from 'three/tsl';
import type { Combatant, ShipState } from '../game/session/elements';
import { EffectLighting } from './EffectLighting';

export interface FireDisplayPose { actor: Combatant; motion: ShipState; }

const MAX_SOURCES = 32;
/** Fire lights, always in the scene so lit materials never recompile as fires start and go out. */
const LIGHTS = 2;
/** Seconds a put-out fire keeps smouldering wisps after its flames die. */
const COOLING_SECONDS = 45;
/** Seconds of white steam when flooding puts a fire out. */
const STEAM_SECONDS = 2.2;
const FLAME_CAPACITY = 640, SMOKE_CAPACITY = 1600, EMBER_CAPACITY = 384, BODY_CAPACITY = 512;

/** What the presentation remembers about one fire between frames. The sim sends heat and
 * intensity for every hull, trend and suppression only for the followed one, so the rise and fall
 * of heat stands in for the trend elsewhere. */
interface FireMemory {
  intensity: number;
  heat: number;
  heatRate: number;
  burned: number;
  out: number;
  steam: number;
  burning: boolean;
  flame: number;
  /** Credit toward the next rolling flame body. */
  roll: number;
  smoke: number;
  ember: number;
  wisp: number;
}
interface Source {
  actor: Combatant; memory: FireMemory; pose: ShipState; local: Vec3; world: THREE.Vector3;
  mount: boolean; heading: number; halfX: number; halfZ: number; scale: number;
  burning: boolean; intensity: number; fought: boolean; growing: boolean; score: number; distance: number; phase: number; inView: boolean;
}
const memory = (): FireMemory => ({ intensity: 0, heat: 0, heatRate: 0, burned: 0, out: 0, steam: 0, burning: false, flame: 0, roll: 0, smoke: 0, ember: 0, wisp: 0 });

/** Presentation of the simulation's finite fires; no new damage locations, fuel or state.
 *
 * Each burning gunhouse or vented compartment is a source: a stream of short-lived, upright flame
 * tongues spread over its roof or hatch, rolling bodies of burning gas that heave up off it and cool
 * into soot, rising embers, and a buoyant column of dark, oily smoke that widens, bends downwind and
 * merges with the ship's other fires into one pall. The two most relevant
 * fires light the ship with flickering lights (always present, so nothing recompiles); every fire
 * glows on the sea and on its smoke's underside. A fire being fought turns its smoke grey-white with steam, a
 * fire that goes out smoulders for ~45 s, and flooding puts one out in a burst of steam. A lost hull's fires burn on as the
 * battle left them while she settles, each until the sea closes over it.
 * Fleet-wide fixed batches; camera relevance picks the sources. */
export class LocalizedFireEffects {
  readonly root = new THREE.Group();
  private readonly noise = effectVolumeTexture();
  private readonly flames = new FireBatch(FLAME_CAPACITY, fireFlameMaterial(this.noise), 'flame');
  private readonly smoke: FireBatch;
  /** Rolling flame bodies: burning gas that heaves up off each fire and cools into its column. */
  private readonly bodies: FireBatch;
  private readonly emberMap = effectTexture('glow');
  private readonly embers = new EffectParticlePool(EMBER_CAPACITY, this.emberMap, true, undefined, false, true);
  private readonly halos = new EffectParticlePool(MAX_SOURCES, this.emberMap, true, undefined, false, true);
  /** A flickering glow laid on the sea and deck under each fire, which the lights do not reach. */
  private readonly pools = new EffectParticlePool(MAX_SOURCES, this.emberMap, true, undefined, false, true);
  private readonly lights = Array.from({ length: LIGHTS }, () => new THREE.PointLight('#ff8a3c', 0, 110, 2));
  private memories = new WeakMap<Combatant, { rooms: (FireMemory | undefined)[]; mounts: (FireMemory | undefined)[] }>();
  private readonly pool: Source[] = Array.from({ length: MAX_SOURCES }, () => ({ world: new THREE.Vector3() }) as Source);
  private readonly sources: Source[] = [];
  private used = 0;
  private readonly trains: number[] = [];
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private time = 0;
  private seed = 1;
  private sourceCount = 0;
  private litCount = 0;
  private lightCount = 0;

  private readonly ownsAtlas: boolean;

  /** Scene light, wind and depth, and the baked gas puffs the flame bodies relight, shared with the other effects; a standalone
   * instance owns its own (an unbaked atlas draws no flame bodies). */
  constructor(readonly lighting = new EffectLighting(), private readonly atlas?: GasAtlas) {
    this.ownsAtlas = !atlas;
    this.atlas ??= new GasAtlas();
    this.smoke = new FireBatch(SMOKE_CAPACITY, fireSmokeMaterial(this.noise, lighting), 'smoke');
    // Firelight on the bodies' soot is the colour of burning oil, deeper than a muzzle flash.
    this.bodies = new FireBatch(BODY_CAPACITY, gasSpriteMaterial(this.atlas, { lighting, flashColor: vec3(1, .42, .12), soft: false }, fireBodyInputs()), 'gas');
    this.root.name = 'Localized ship fires';
    this.flames.mesh.name = 'Ship fire flames'; this.smoke.mesh.name = 'Ship fire smoke'; this.bodies.mesh.name = 'Ship fire bodies';
    this.embers.mesh.name = 'Ship fire embers'; this.halos.mesh.name = 'Ship fire glow';
    // Low additive sparks over the sea survive the water's depth composite only with depth. The
    // broad glow must not write it: its soft disc would cut the smoke column behind it.
    this.embers.mesh.material.depthWrite = true; this.embers.mesh.material.alphaTest = .01;
    // Smoke first: flames and sparks write depth, and would punch holes in smoke drawn after them.
    // The flame bodies roll in front of the column they feed.
    this.smoke.mesh.renderOrder = 0; this.bodies.mesh.renderOrder = 1; this.pools.mesh.renderOrder = 1; this.halos.mesh.renderOrder = 1;
    this.flames.mesh.renderOrder = 2; this.embers.mesh.renderOrder = 3;
    this.pools.mesh.name = 'Ship fire glow on the water';
    this.lights.forEach((light, i) => { light.name = `Ship fire light ${i + 1}`; this.root.add(light); });
    this.root.add(this.smoke.mesh, this.bodies.mesh, this.pools.mesh, this.halos.mesh, this.flames.mesh, this.embers.mesh);
  }

  update(sim: BattleSession, dt: number, camera: THREE.Camera, wind: THREE.Vector3, hiddenSourceId?: string, poses?: readonly FireDisplayPose[]): void {
    this.time += dt;
    this.flames.advance(dt, wind); this.smoke.advance(dt, wind); this.bodies.advance(dt, wind); this.embers.advance(dt, wind);
    camera.getWorldPosition(this.cameraPosition);
    this.collect(sim, dt, camera, poses);
    if (dt > 0) this.emit(dt, wind);
    this.illuminate(hiddenSourceId);
    this.flames.publish(camera, hiddenSourceId); this.smoke.publish(camera, hiddenSourceId); this.bodies.publish(camera, hiddenSourceId);
    this.embers.publish(camera, hiddenSourceId); this.halos.publish(camera, hiddenSourceId); this.pools.publish(camera, hiddenSourceId);
  }

  /** Read every hull's fires into memories and keep the most relevant sources, bounded. */
  private collect(sim: BattleSession, dt: number, camera: THREE.Camera, poses?: readonly FireDisplayPose[]): void {
    this.sources.length = 0; this.used = 0;
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera, projection = camera.projectionMatrix.elements;
    for (const actor of sim.actors) {
      let memories = this.memories.get(actor);
      // A lost hull's fires stay as the battle left them and burn on while she settles, each until the sea reaches it.
      const control = actor.damage.control;
      if (!memories) {
        if (!control.rooms.some(f => f.intensity > 0) && !control.mounts.some(f => f.intensity > 0)) continue;
        memories = { rooms: [], mounts: [] }; this.memories.set(actor, memories);
      }
      let pose = actor.motion;
      if (poses) for (const p of poses) if (p.actor === actor) { pose = p.motion; break; }
      const def = actor.definition;
      // A distant hull whose best possible fire cannot outrank a full list only updates its memories.
      const reach = Math.max(30, Math.hypot(pose.x - this.cameraPosition.x, pose.z - this.cameraPosition.z) - def.hull.length * .5);
      const outranked = this.sources.length >= MAX_SOURCES && 2.1 / reach <= this.sources[MAX_SOURCES - 1].score;
      for (let i = 0; i < control.rooms.length; i++) {
        const fire = control.rooms[i];
        // Most rooms neither burn nor remember a fire: remember() would return nothing for them.
        if (!memories.rooms[i] && !(fire.intensity > 0)) continue;
        const vent = def.compartments[i]?.fire?.ventPosition;
        if (!vent) continue;
        const flooded = (actor.damage.compartments?.[i]?.waterM3 ?? 0) >= .25 * def.compartments[i].capacityM3;
        const m = this.remember(memories.rooms, i, fire, dt, flooded);
        if (!m || outranked) continue;
        const size = def.compartments[i].size;
        const half = THREE.MathUtils.clamp(Math.min(size[0], size[2]) * .3, 1.2, 4.5);
        this.consider(actor, m, fire, pose, vent, false, pose.heading, half, half,
          THREE.MathUtils.clamp(Math.sqrt(size[0] * size[2]) / 11, .6, 1.5), i * 2.4, perspective, projection, camera);
      }
      let trained = false;
      for (let i = 0; i < control.mounts.length; i++) {
        const fire = control.mounts[i];
        if (!memories.mounts[i] && !(fire.intensity > 0)) continue;
        const m = this.remember(memories.mounts, i, fire, dt, false);
        if (!m || outranked) continue;
        if (!trained) { this.trains.length = 0; for (const state of actor.mounts) this.trains.push(state.train); trained = true; }
        const mount = def.mounts[i], frame = mountFrame(def, i, this.trains), house = mount.weapon.gunhouseSize;
        this.consider(actor, m, fire, pose, [frame.x, frame.y + house[2], frame.z], true, pose.heading + frame.heading,
          house[1] * .4, house[0] * .4, THREE.MathUtils.clamp(Math.sqrt(house[0] * house[1]) / 9, .45, 1.5), 1.3 + i * 2.4, perspective, projection, camera);
      }
    }
    this.sourceCount = this.sources.length;
  }

  /** Update one fire's memory; undefined once nothing of it remains to draw. */
  private remember(list: (FireMemory | undefined)[], index: number, fire: { intensity: number; heat: number }, dt: number, flooded: boolean): FireMemory | undefined {
    let m = list[index];
    const burning = fire.intensity > 0;
    if (!m) { if (!burning) return undefined; m = list[index] = memory(); m.heat = fire.heat; }
    if (dt > 0) {
      m.heatRate += ((fire.heat - m.heat) / dt - m.heatRate) * Math.min(1, dt / 1.5);
      m.heat = fire.heat;
      // Ease the displayed intensity, so a fire grows into view and dies down instead of popping.
      m.intensity += (fire.intensity - m.intensity) * Math.min(1, dt / (fire.intensity > m.intensity ? 1.6 : .9));
      if (burning) { m.burned += dt; m.out = 0; } else if (m.burned > 0) m.out += dt;
      m.steam = burning ? 0 : Math.max(0, m.steam - dt);
      if (m.burning && !burning && flooded) m.steam = STEAM_SECONDS;
    }
    m.burning = burning;
    if (!burning && m.steam <= 0 && (m.burned <= 0 || m.out > COOLING_SECONDS)) { list[index] = undefined; return undefined; }
    return m;
  }

  private consider(actor: Combatant, m: FireMemory, fire: { intensity: number; trend?: string; suppressed?: boolean }, pose: ShipState, local: Vec3,
    mount: boolean, heading: number, halfX: number, halfZ: number, scale: number, phase: number,
    perspective: boolean, projection: number[], camera: THREE.Camera): void {
    const world = localToWorld(local, pose);
    if (world[1] <= 0) return;
    this.position.fromArray(world);
    const distance = this.position.distanceTo(this.cameraPosition);
    const burning = fire.intensity > 0, intensity = burning ? Math.max(.08, m.intensity) : 0;
    const weight = (burning ? .4 + intensity : .15 + (m.steam > 0 ? .3 : 0)) * scale / Math.max(30, distance);
    // A full list only takes a fire that can outrank its weakest source, even in plain sight.
    if (this.sources.length >= MAX_SOURCES && weight <= this.sources[MAX_SOURCES - 1].score) return;
    this.cameraSpace.copy(this.position).applyMatrix4(camera.matrixWorldInverse);
    const depth = -this.cameraSpace.z, margin = 40 + 20 * scale;
    const inView = !perspective || (depth + margin > 0 && Math.abs(this.cameraSpace.x) < Math.max(0, depth) / projection[0] + margin
      && Math.abs(this.cameraSpace.y) < Math.max(0, depth) / projection[5] + margin * 2);
    // A column above an off-screen fire can still be in view; relevance is distance, then sight.
    const score = weight * (inView ? 1 : .35);
    // Several compartments share one authored vent: one source, the strongest fire.
    for (const s of this.sources) if (s.actor === actor && s.world.distanceToSquared(this.position) < 4) {
      if (score > s.score) Object.assign(s, { memory: m, intensity, burning, score, fought: fire.suppressed ?? m.heatRate < -.004, growing: fire.trend ? fire.trend === 'growing' : m.heatRate > .004 });
      return;
    }
    let index = this.sources.findIndex(s => s.score < score);
    if (index < 0) { if (this.sources.length >= MAX_SOURCES) return; index = this.sources.length; }
    const s = this.sources.length >= MAX_SOURCES ? this.sources.pop()! : this.pool[this.used++];
    s.actor = actor; s.memory = m; s.pose = pose; s.local = local; s.world.copy(this.position); s.mount = mount; s.heading = heading;
    s.halfX = halfX; s.halfZ = halfZ; s.scale = scale; s.burning = burning; s.intensity = intensity; s.score = score; s.distance = distance;
    s.phase = phase; s.inView = inView;
    s.fought = burning && (fire.suppressed ?? m.heatRate < -.004);
    s.growing = burning && (fire.trend ? fire.trend === 'growing' : m.heatRate > .004);
    this.sources.splice(Math.min(index, this.sources.length), 0, s);
  }

  private random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** A point spread over the source's roof or hatch, in world space. */
  private spread(s: Source, reach = 1): THREE.Vector3 {
    const ax = (this.random() - .5) * 2 * s.halfX * reach, az = (this.random() - .5) * 2 * s.halfZ * reach;
    const relative = s.heading - s.pose.heading, c = Math.cos(relative), n = Math.sin(relative);
    return this.position.fromArray(localToWorld([s.local[0] + ax * c - az * n, s.local[1], s.local[2] + ax * n + az * c], s.pose));
  }

  private emit(dt: number, wind: THREE.Vector3): void {
    // Share the smoke batch: expected live puffs never exceed what it holds.
    let demand = 0;
    for (const s of this.sources) if (s.burning) demand += (1.1 + 1.6 * s.intensity) * (28 + 14 * s.intensity) / (1 + THREE.MathUtils.smoothstep(s.distance, 2500, 7000) * .8);
    const budget = Math.min(1, SMOKE_CAPACITY * .92 / Math.max(1, demand));
    // Fire lights its own smoke from below; after dark that glow is most of what shows.
    const dark = 1 - THREE.MathUtils.smoothstep(this.lighting.daylight.value, .3, .9);
    for (const s of this.sources) {
      const m = s.memory, I = s.intensity, id = s.actor.motion.id;
      const velocity = this.velocity.fromArray(motionVelocity(s.pose));
      const far = THREE.MathUtils.smoothstep(s.distance, 2500, 7000);
      if (s.burning && s.inView) {
        // Flame tongues: a steady stream spread over the whole roof or hatch. Hatches show flame
        // only once the fire below is fierce.
        const room = s.mount ? 1 : THREE.MathUtils.smoothstep(I, .3, .65);
        m.flame += dt * (14 + 30 * I) * s.scale * room * (s.fought ? .5 : 1) * (1 - far * .7);
        for (; m.flame >= 1; m.flame--) {
          const f = this.flames.emit(this.spread(s, s.mount ? .9 : .6), id);
          // Tall tongues over a low, broad body of flame that joins them at the roof.
          const body = this.random() < .35, variety = .55 + this.random() * .9;
          const height = (1.5 + 3.6 * I) * s.scale * (s.mount ? 1 : .75) * (s.fought ? .62 : s.growing ? 1.12 : 1) * variety * (body ? .6 : 1);
          f.size = height; f.aspect = body ? 1 + this.random() * .4 : .55 + this.random() * .3;
          f.life = (.45 + this.random() * .45) * Math.sqrt(Math.max(.4, height / 4));
          f.rise = 2.4 + 3 * I; f.riseTime = 1.5; f.shear = .25; f.shearHeight = 10;
          f.drift.copy(velocity).multiplyScalar(.94); f.glow = .82 + .22 * I; f.cool = f.life * 1.3;
          f.opacity = .96; f.fadeIn = .06;
          f.age = -this.random() * dt; // Spread births through the frame.
        }
        // Rolling flame: turbulent burning gas heaving up off the fire, white-yellow at the roof, cooling through orange and
        // deep red into the black column within a second or two of its climb.
        m.roll += dt * (1.8 + 4 * I) * s.scale * room * (s.fought ? .45 : 1) * (1 - far * .6);
        for (; m.roll >= 1; m.roll--) {
          this.position.copy(this.spread(s, s.mount ? .7 : .5)); this.position.y += .6 + this.random() * .8;
          const p = this.bodies.emit(this.position, id);
          p.size = (1.2 + 1.6 * I) * s.scale * (.7 + this.random() * .6); p.growth = (1.2 + 1 * I) * s.scale; p.growthDecay = .9; p.diffusion = .08;
          // Short-lived: once cooled it is the column's smoke, which the column's own puffs already draw.
          p.life = 1.3 + this.random() * .6; p.fadeIn = .08;
          p.rise = (6 + 6 * I) * (.8 + this.random() * .4); p.riseTime = 2.5; p.lift = 2.5 + I;
          p.drift.set((this.random() - .5) * 2, 0, (this.random() - .5) * 2).addScaledVector(velocity, .9); p.drag = .6;
          p.shear = 1; p.shearHeight = 20;
          p.heat = (1.6 + .4 * I) * (s.fought ? .7 : 1); p.cooling = (.6 + this.random() * .5) * (.8 + .4 * I);
          p.albedo.setRGB(.05, .045, .04); p.opacity = .95;
          p.age = -this.random() * dt;
        }
        m.ember += dt * (3 + 8 * I) * s.scale * (s.fought ? .4 : 1) * (1 - far);
        for (; m.ember >= 1; m.ember--) {
          const e = this.embers.emit(this.spread(s, .8), id);
          e.velocity.set((this.random() - .5) * 4, 5 + this.random() * 9 * (.5 + I), (this.random() - .5) * 4).add(velocity);
          e.size = .1 + this.random() * .14; e.stretch = 2.5; e.align = 'velocity';
          e.life = .8 + this.random() * 1.6; e.gravity = -1.5; e.drag = .7; e.wind = 1;
          e.opacity = .9; e.color.setRGB(1, .38 + this.random() * .2, .08).multiplyScalar(1.7);
        }
      }
      if (s.burning) {
        // The column: buoyant puffs that climb fast off the fire, slow with height, widen and bend
        // downwind into a pall. Distant columns use fewer, larger puffs; one ship's fires merge.
        const coarse = 1 + far * .8;
        m.smoke += dt * (1.1 + 1.6 * I) * (s.fought ? 1.2 : 1) * budget / coarse;
        for (; m.smoke >= 1; m.smoke--) {
          const steam = s.fought && this.random() < .55;
          this.position.copy(this.spread(s, .5)); this.position.y += 1 + (s.mount ? 2 * I : 0);
          const p = this.smoke.emit(this.position, id);
          p.size = (3 + 3 * I) * s.scale * (.8 + this.random() * .4) * Math.sqrt(coarse);
          p.growth = (1 + .6 * I) * Math.sqrt(coarse); p.growthDecay = .05; p.diffusion = .05; p.thin = .55;
          p.life = 26 + 14 * I + this.random() * 6;
          p.rise = (5 + 7 * I) * (.85 + this.random() * .3) * (steam ? .8 : 1); p.riseTime = 8; p.lift = 2.2 + I;
          p.drift.set((this.random() - .5) * 1.4, 0, (this.random() - .5) * 1.4).addScaledVector(velocity, .45); p.drag = .35;
          p.shear = 1; p.shearHeight = 70;
          // Fuel-oil smoke: near black with a warm brown cast where the sun catches it.
          const shade = steam ? .66 + this.random() * .12 : (s.growing ? .075 : .1) + (1 - I) * .12 + this.random() * .04;
          if (steam) p.albedo.setRGB(shade, shade * 1.01, shade * 1.03); else p.albedo.setRGB(shade * 1.1, shade, shade * .86);
          p.glow = steam ? .05 : (.14 + .22 * I) * (s.fought ? .5 : 1) * (1 + 3 * dark); p.cool = .45 + .7 * dark;
          p.opacity = steam ? .5 : .7 + .15 * I; p.fadeIn = .5;
          p.age = -this.random() * dt;
        }
      } else {
        // Put out: a flooded fire goes in a burst of steam; any other smoulders in thinning wisps.
        if (m.steam > 0) {
          m.wisp += dt * 7 * s.scale;
          for (; m.wisp >= 1; m.wisp--) {
            this.position.copy(this.spread(s, .5)); this.position.y += .5;
            const p = this.smoke.emit(this.position, id);
            p.size = (2 + this.random()) * s.scale; p.growth = 3.2; p.growthDecay = .2; p.diffusion = .15;
            p.life = 9 + this.random() * 4; p.rise = 10 + this.random() * 5; p.riseTime = 3; p.lift = .8;
            p.drift.copy(velocity).multiplyScalar(.4); p.drag = .5; p.shear = 1; p.shearHeight = 30;
            p.albedo.setRGB(.86, .88, .9); p.opacity = .62; p.fadeIn = .2;
          }
          continue;
        }
        const left = 1 - m.out / COOLING_SECONDS;
        m.wisp += dt * (.4 + 1.1 * left) * s.scale;
        for (; m.wisp >= 1; m.wisp--) {
          this.position.copy(this.spread(s, .4)); this.position.y += .5;
          const p = this.smoke.emit(this.position, id);
          p.size = (1.2 + this.random() * .8) * s.scale; p.growth = 1.3; p.growthDecay = .12; p.diffusion = .1;
          p.life = 12 + this.random() * 6; p.rise = 3 + 2 * left; p.riseTime = 5; p.lift = .6;
          p.drift.copy(velocity).multiplyScalar(.4); p.drag = .4; p.shear = 1; p.shearHeight = 40;
          const shade = .3 + .35 * (1 - left);
          p.albedo.setRGB(shade, shade, shade * 1.02); p.opacity = .18 + .3 * left; p.fadeIn = .6;
        }
      }
    }
  }

  /** Each burning fire in view glows: a soft halo around its flames and a flickering pool of light
   * on the sea beneath it; the two most relevant also light the ship. Faint in sunlight, most of the
   * scene after dark. */
  private illuminate(hiddenSourceId?: string): void {
    this.halos.reset(); this.pools.reset();
    const dark = 1 - THREE.MathUtils.smoothstep(this.lighting.daylight.value, .3, .9);
    let lit = 0, lights = 0;
    for (const s of this.sources) {
      if (!s.burning || !s.inView) continue;
      const t = this.time + s.phase, id = s.actor.motion.id, fought = s.fought ? .6 : 1;
      const flicker = .8 + .1 * Math.sin(t * 9.1) + .06 * Math.sin(t * 23.7 + 1.3) + .04 * Math.sin(t * 41.9 + 2.1);
      this.position.copy(s.world); this.position.y += 1.5 + s.scale * 2 * s.intensity;
      const halo = this.halos.emit(this.position, id);
      halo.size = (7 + 9 * s.intensity) * s.scale * fought; halo.life = 1;
      halo.opacity = (.14 + .18 * s.intensity) * (1 + .6 * dark) * flicker; halo.color.setRGB(1, .42, .14);
      this.position.copy(s.world); this.position.y += .25;
      const pool = this.pools.emit(this.position, id);
      pool.align = 'water'; pool.life = 1; pool.size = (22 + 26 * s.intensity) * s.scale * fought;
      pool.opacity = (.02 + .22 * dark) * s.intensity * flicker; pool.color.setRGB(1, .45, .15);
      lit++;
      if (lights < LIGHTS && id !== hiddenSourceId && s.distance < 1500) {
        const light = this.lights[lights++];
        light.position.copy(s.world); light.position.y += 2.5 + 2.5 * s.scale * s.intensity;
        light.intensity = 1700 * (.2 + .8 * dark) * s.scale * s.intensity * flicker * fought;
        light.distance = 70 + 60 * s.scale * s.intensity;
      }
    }
    this.litCount = lit; this.lightCount = lights;
    for (let i = lights; i < LIGHTS; i++) this.lights[i].intensity = 0;
  }

  setDensity(density: number): void { this.flames.density = density; this.smoke.density = density; this.bodies.density = density; this.embers.density = density; }
  diagnostics() {
    return { sources: this.sourceCount, flames: this.flames.count, smoke: this.smoke.count, bodies: this.bodies.count, embers: this.embers.count,
      glows: this.litCount, lights: this.lightCount,
      fill: { smoke: +this.smoke.fill.toFixed(2), bodies: +this.bodies.fill.toFixed(2), flames: +this.flames.fill.toFixed(2) },
      capacity: FLAME_CAPACITY + SMOKE_CAPACITY + BODY_CAPACITY + EMBER_CAPACITY + 2 * MAX_SOURCES };
  }
  reset(): void {
    this.flames.reset(); this.smoke.reset(); this.bodies.reset(); this.embers.reset(); this.halos.reset(); this.pools.reset();
    this.memories = new WeakMap();
    this.sources.length = 0; this.time = 0; this.seed = 1; this.sourceCount = 0; this.litCount = 0; this.lightCount = 0;
    this.lights.forEach(light => light.intensity = 0);
  }
  dispose(): void {
    this.root.removeFromParent(); this.flames.dispose(); this.smoke.dispose(); this.bodies.dispose(); this.embers.dispose(); this.halos.dispose(); this.pools.dispose();
    this.emberMap.dispose(); this.noise.dispose(); this.lights.forEach(light => light.dispose());
    if (this.ownsAtlas) this.atlas!.dispose();
  }
}

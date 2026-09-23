import * as THREE from 'three/webgpu';
import { attribute, float, texture, vec3, vec4 } from 'three/tsl';
import { EffectParticlePool, effectTexture, type EffectParticle } from './EffectParticles';
import type { EffectLighting } from './EffectLighting';
import type { WaterPlumes } from './WaterPlumes';
import type { CombatEvent, ShipState } from './session/elements';
import { localToWorld, rotate, worldToLocal } from './geometry';

const UP = new THREE.Vector3(0, 1, 0);
const WATER = new THREE.Color('#e7f2f1');
const CORDITE = new THREE.Color('#bab4a6');
const SOOT = new THREE.Color('#3a3734');
const BLACK_SMOKE = new THREE.Color('#2b2927');
type Vec3 = [number, number, number];

/** Pools and lights that CombatEffects shares with the blasts, so every gas and
 * flash still renders in the same few instanced draws. */
export interface BlastContext {
  /** Raymarched gas: propellant, fireballs and explosion columns. */
  volumes: EffectParticlePool;
  /** Additive flash, flame-jet and spark sprites. */
  fire: EffectParticlePool;
  foam: EffectParticlePool;
  mist: EffectParticlePool;
  spray: EffectParticlePool;
  spouts: WaterPlumes;
  illuminate(position: THREE.Vector3, power: number, duration: number, distance: number): void;
}

/** A hull's current display pose and length, for effects that stay attached to it. */
export type HullLookup = (shipId: string) => { pose: ShipState; lengthM: number } | undefined;

/** Visual randomness is local and seeded by the event; combat never consumes it. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

const clamp = THREE.MathUtils.clamp;
const hash = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };

/** Original jagged plate-fragment silhouettes: four faceted variants in a 2×2 atlas-free
 * single tile (the particle's spin and stretch vary them further). No downloads. */
export function debrisTexture(): THREE.DataTexture {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1, angle = Math.atan2(v, u), radius = Math.hypot(u, v);
    // A torn polygon: a few long straight edges plus fine notches.
    const facet = Math.floor((angle + Math.PI) / (Math.PI * 2) * 7);
    const edge = .52 + hash(facet, 3) * .34 - Math.abs(Math.sin(angle * 3.5 + facet)) * .08 + (hash(Math.floor(angle * 30), 9) - .5) * .05;
    const alpha = clamp((edge - radius) * 22, 0, 1);
    const light = .55 + hash(facet, 11) * .45 - radius * .2;
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(clamp(light, 0, 1) * 255);
    pixels[i + 3] = Math.round(alpha * 255);
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
  return map;
}

/** Sprite smoke lit by the scene's sun, sky and moon (the texture's baked light gives each
 * lobe its relief) and softened where it meets decks, hulls and the sea. */
function litSmokeMaterial(map: THREE.Texture, lighting: EffectLighting): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const sample = texture(map);
  const light = lighting.ambient.mul(1.35).add(lighting.direct.mul(.62));
  material.colorNode = vec4(sample.rgb.mul(light), sample.a);
  material.opacityNode = attribute<'float'>('effectOpacity', 'float').mul(lighting.softEdge(2.5));
  material.forceSinglePass = true;
  return material;
}

/** Dark cut-out fragments, lit like the smoke they trail. */
function debrisMaterial(map: THREE.Texture, lighting: EffectLighting): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: false, alphaTest: .4, depthWrite: true, side: THREE.DoubleSide });
  const sample = texture(map);
  const light = lighting.ambient.mul(1.2).add(lighting.direct.mul(.7));
  material.colorNode = vec4(sample.rgb.mul(light).mul(vec3(.2, .19, .18)), sample.a);
  material.opacityNode = float(1);
  return material;
}

/** A pool whose sprite material is replaced by `material`; the pool keeps its buffers and sorting. */
function spritePool(capacity: number, map: THREE.DataTexture, material: THREE.MeshBasicNodeMaterial, cullOffscreen = true): EffectParticlePool {
  const pool = new EffectParticlePool(capacity, map, false, undefined, false, cullOffscreen);
  pool.mesh.material.dispose();
  pool.mesh.material = material;
  return pool;
}

interface Trail {
  position: THREE.Vector3; velocity: THREE.Vector3; drag: number; gravity: number;
  age: number; life: number; interval: number; credit: number; size: number; opacity: number; seed: number;
  /** Seconds over which the trail thins out, even while the fragment still flies. */
  fade: number;
}
interface Smoulder {
  shipId: string; local: Vec3; normal: Vec3; age: number; life: number; credit: number; strength: number; seed: number;
}

const TRAILS = 40, SMOULDERS = 24;

/** Muzzle blasts, shell strikes, HE bursts and magazine detonations: flash, flame, hot gas that
 * cools into smoke, fragments with smoke trails and smouldering holes. Presentation only. */
export class BlastEffects {
  readonly root = new THREE.Group();
  private readonly smokeMap = effectTexture('smoke');
  private readonly debrisMap = debrisTexture();
  /** Smouldering holes and fragment trails: small lit sprites. */
  readonly soot: EffectParticlePool;
  readonly debris: EffectParticlePool;
  private readonly trails: Trail[] = Array.from({ length: TRAILS }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    drag: 0, gravity: 0, age: 1, life: 0, interval: .05, credit: 0, size: 1, opacity: 1, seed: 0, fade: 2 }));
  private readonly smoulders: Smoulder[] = [];
  private readonly pending: CombatEvent[] = [];
  private trailCursor = 0;
  private density = 1;
  private hulls: HullLookup = () => undefined;
  private readonly position = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly vertical = new THREE.Vector3();
  private readonly lateral = new THREE.Vector3();

  constructor(private readonly context: BlastContext, lighting: EffectLighting) {
    this.root.name = 'Shell blasts';
    this.soot = spritePool(2048, this.smokeMap, litSmokeMaterial(this.smokeMap, lighting));
    this.debris = spritePool(384, this.debrisMap, debrisMaterial(this.debrisMap, lighting));
    this.soot.mesh.name = 'Smouldering and fragment smoke';
    this.debris.mesh.name = 'Blast fragments';
    this.root.add(this.soot.mesh, this.debris.mesh);
  }

  /** Current hull poses for strikes that stay attached to a moving ship. */
  setHulls(lookup: HullLookup): void { this.hulls = lookup; }
  setDensity(density: number): void { this.density = density; this.soot.density = density; this.debris.density = density; }

  /** Barrels of one salvo arrive as separate events; they become one turret blast in `flushShots`. */
  queueShot(event: CombatEvent): void { this.pending.push(event); }

  /** Group this frame's shots by ship, tick and mount (adjacent parallel muzzles) and fire each group once. */
  flushShots(): void {
    while (this.pending.length) {
      const first = this.pending.shift()!, group = [first];
      const calibre = first.shell?.caliberM ?? .38, reach = 3 + calibre * 18;
      this.direction.fromArray(first.shell?.velocity ?? [0, 0, -1]).normalize();
      for (let i = 0; i < this.pending.length;) {
        const other = this.pending[i];
        this.point.fromArray(other.shell?.velocity ?? [0, 0, -1]).normalize();
        const near = Math.hypot(other.position[0] - first.position[0], other.position[1] - first.position[1], other.position[2] - first.position[2]) < reach;
        if (other.shipId === first.shipId && other.tick === first.tick && (other.shell?.caliberM ?? .38) === calibre && near && this.point.dot(this.direction) > .995) {
          group.push(other); this.pending.splice(i, 1);
        } else i++;
      }
      this.turret(group, seeded(first.sequence * 7919 + (first.shell?.id ?? 0)));
    }
  }

  private frame(forward: THREE.Vector3): void {
    this.across.crossVectors(forward, UP);
    if (this.across.lengthSq() < 1e-4) this.across.set(1, 0, 0);
    this.across.normalize();
    this.vertical.crossVectors(this.across, forward).normalize();
  }
  /** A random unit direction in the plane across `forward`. */
  private sideways(random: () => number): THREE.Vector3 {
    const angle = random() * Math.PI * 2;
    return this.lateral.copy(this.across).multiplyScalar(Math.cos(angle)).addScaledVector(this.vertical, Math.sin(angle));
  }
  private volumeAxis(p: EffectParticle, axis: THREE.Vector3, aspect: number): void {
    p.volumeAspect = aspect; p.volumeYaw = Math.atan2(axis.z, axis.x); p.volumeAxisY = clamp(axis.y, -1, 1);
  }

  /** One turret: core flashes, flame jets along each bore, side lobes, a hot fireball per barrel and a
   * large cordite cloud that erupts forward, rolls outward and hangs downwind. */
  private turret(group: CombatEvent[], random: () => number): void {
    const { volumes, fire, foam, mist, illuminate } = this.context;
    const shell = group[0].shell, calibre = shell?.caliberM ?? .38;
    const scale = clamp(calibre / .38, .1, 1.7), size = scale ** .8, big = scale > .45;
    const forward = this.direction.fromArray(shell?.velocity ?? [0, 0, -1]).normalize();
    if (forward.lengthSq() === 0) forward.set(0, 0, -1);
    this.frame(forward);
    const center = this.position.set(0, 0, 0);
    for (const event of group) center.x += event.position[0] / group.length, center.y += event.position[1] / group.length, center.z += event.position[2] / group.length;
    const source = group[0].shipId, barrels = group.length;
    this.point.copy(center).addScaledVector(forward, 8 * size);
    illuminate(this.point, 2600 * size * size * Math.sqrt(barrels), big ? .2 : .12, 110 * size);
    for (const event of group) {
      this.point.fromArray(event.position);
      // A white-hot core for a frame or two, then a flame jet driven along the bore.
      const core = fire.emit(this.point.clone().addScaledVector(forward, 1.5 * size));
      core.size = 3.5 * size; core.growth = 70 * size; core.growthDecay = 22; core.life = .075;
      core.color.setRGB(5, 4.6, 3.8); core.opacity = 1;
      for (let j = 0; j < 3; j++) {
        const jet = fire.emit(this.point.clone().addScaledVector(forward, (3 + j * 4) * size));
        jet.velocity.copy(forward).multiplyScalar((140 + j * 55 + random() * 30) * size);
        jet.drag = 7.5; jet.align = 'velocity'; jet.size = (6.5 - j * .8) * size; jet.growth = 20 * size; jet.growthDecay = 10;
        jet.stretch = 3.2 + j; jet.life = .12 + j * .045 + random() * .03; jet.opacity = .95;
        jet.color.setRGB(3.4, 1.9 - j * .35, .7 - j * .2);
      }
      // Each barrel's own fireball: hot, stretched along the bore, cooling to propellant smoke.
      const ball = volumes.emit(this.point.clone().addScaledVector(forward, 5 * size), source);
      ball.velocity.copy(forward).multiplyScalar((95 + random() * 30) * size).addScaledVector(this.sideways(random), (4 + random() * 8) * size);
      ball.velocity.y += 3;
      ball.drag = 3.4; this.volumeAxis(ball, forward, 2.4);
      ball.size = 7 * size; ball.growth = 34 * size; ball.growthDecay = 3.4; ball.diffusion = .8 * size;
      ball.heat = 1.15; ball.cooling = .22 + .16 * Math.sqrt(size); ball.life = big ? 5 : 2.2; ball.dissipationTime = big ? 2.4 : 1;
      ball.density = 3.4; ball.gravity = -1; ball.wind = .6; ball.opacity = .95;
      ball.color.copy(CORDITE).multiplyScalar(.85);
    }
    // The daylight fireball: a short orange bloom ahead of the turret that the gas then swallows.
    const bloom = fire.emit(center.clone().addScaledVector(forward, 11 * size));
    bloom.size = 10 * size * Math.sqrt(barrels); bloom.growth = 95 * size; bloom.growthDecay = 11; bloom.life = .14;
    bloom.color.setRGB(3, 1.4, .42); bloom.opacity = .85;
    if (big) for (const side of [-1, 1]) {
      // Blast-bag flash escaping sideways at the muzzle face: the characteristic petals.
      const lobe = fire.emit(center.clone().addScaledVector(forward, 4 * size));
      lobe.velocity.copy(this.across).multiplyScalar(side * 60 * size).addScaledVector(this.vertical, 12 * size).addScaledVector(forward, 25 * size);
      lobe.drag = 8; lobe.align = 'velocity'; lobe.size = 4.5 * size; lobe.growth = 22 * size; lobe.growthDecay = 9;
      lobe.stretch = 1.7; lobe.life = .11; lobe.color.setRGB(3, 1.7, .6); lobe.opacity = .9;
    }
    // The cordite cloud: few, large billows so neighbouring turrets merge into one bank.
    const billows = big ? 3 + barrels : 1 + Math.ceil(barrels / 2);
    for (let i = 0; i < billows; i++) {
      const t = billows > 1 ? i / (billows - 1) : .5;
      const p = volumes.emit(center.clone().addScaledVector(forward, (4 + t * 10) * size), source);
      const out = this.sideways(random).clone();
      p.position.addScaledVector(out, (1 + random() * 3) * size);
      p.velocity.copy(forward).multiplyScalar((38 + t * 42 + random() * 16) * size)
        .addScaledVector(out, (7 + random() * 11) * size);
      p.velocity.y += 2 + random() * 3;
      p.drag = 1.9 + random() * .5; this.volumeAxis(p, forward, Math.max(1, 1.6 - t * .5));
      p.size = (11 + random() * 6) * size; p.growth = (30 + random() * 14) * size; p.growthDecay = 1.6; p.diffusion = (1.1 + random() * .6) * size;
      // Leading billows start as flame and cool fast; trailing ones only glow.
      p.heat = (1 - t * .5) * (.85 + random() * .25); p.cooling = (.2 + t * .15 + random() * .1) * Math.sqrt(size);
      p.life = big ? 11 + random() * 4 : 3.5 + random() * 2; p.dissipationTime = big ? 4.5 + random() * 1.5 : 1.6;
      p.density = 2.3 + random() * .6; p.gravity = -.5 - random() * .6; p.wind = .75 + random() * .25; p.opacity = .92;
      p.color.copy(CORDITE).multiplyScalar(.86 + random() * .18);
    }
    // Burning propellant grains.
    for (let i = 0; i < Math.round((big ? 10 : 3) * size * Math.sqrt(barrels)); i++) {
      const ember = fire.emit(center.clone().addScaledVector(forward, 6 * size));
      ember.velocity.copy(forward).multiplyScalar((70 + random() * 90) * size).addScaledVector(this.sideways(random), (10 + random() * 30) * size);
      ember.gravity = 9.81; ember.drag = .7; ember.align = 'velocity'; ember.size = (.22 + random() * .25) * size; ember.stretch = 5;
      ember.life = .5 + random() * .8; ember.color.setRGB(2.6, 1.3, .4); ember.opacity = .9; ember.waterline = true;
    }
    // Blast overpressure strikes the sea below heavy guns: a racing ring and a low spray sheet.
    if (big && center.y < 26) {
      this.point.copy(center).addScaledVector(forward, 14 * size); this.point.y = .45;
      const ring = foam.emit(this.point);
      ring.align = 'water'; ring.size = 10 * size; ring.growth = 150 * size; ring.growthDecay = 3.4; ring.life = 1.1; ring.opacity = .3;
      ring.color.copy(WATER);
      for (let i = 0; i < 9; i++) {
        const angle = random() * Math.PI * 2;
        const sheet = mist.emit(this.point.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar((3 + random() * 6) * size)));
        sheet.position.y = 1.2;
        sheet.velocity.set(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar((18 + random() * 20) * size).addScaledVector(forward, 12 * size);
        sheet.velocity.y = 1 + random() * 2;
        sheet.drag = 1.5; sheet.size = (4 + random() * 4) * size; sheet.growth = 6 * size; sheet.growthDecay = .8;
        sheet.life = 1.6 + random() * .8; sheet.fadeIn = .04; sheet.opacity = .2; sheet.wind = .8; sheet.color.copy(WATER);
      }
    }
  }

  /** Solid strikes (`penetration`, `stopped`, `contact`) and glancing ricochets. */
  impact(event: CombatEvent, random: () => number): void {
    const { volumes, fire, illuminate } = this.context;
    const ricochet = event.kind === 'ricochet', solid = event.kind === 'penetration';
    const scale = clamp((event.shell?.caliberM ?? .38) / .38, .25, 1.7), size = Math.sqrt(scale);
    const incoming = this.direction.fromArray(event.shell?.velocity ?? [0, -1, 0]).normalize();
    const normal = this.normal.fromArray(event.normal!).normalize();
    // Polygon winding may face either side; debris leaves the incoming side.
    if (normal.dot(incoming) > 0) normal.negate();
    const at = this.position.fromArray(event.position).addScaledVector(normal, .25);
    const out = ricochet ? incoming.clone().reflect(normal) : normal.clone();
    this.frame(out);
    this.point.copy(at).addScaledVector(normal, 2);
    illuminate(this.point, (ricochet ? 220 : solid ? 600 : 400) * scale, ricochet ? .1 : .12, (ricochet ? 22 : 36) * size);
    const flash = fire.emit(at);
    flash.size = (ricochet ? 2.5 : 4) * size; flash.growth = (ricochet ? 30 : 60) * size; flash.growthDecay = 18; flash.life = .08;
    flash.color.setRGB(5, 4.7, 4.2); flash.opacity = 1;
    if (!ricochet) {
      const glow = fire.emit(at);
      glow.size = 6 * size; glow.growth = 24 * size; glow.growthDecay = 6; glow.life = .2; glow.color.setRGB(2.8, 1.3, .45); glow.opacity = .8;
    }
    for (let i = 0; i < (ricochet ? 22 : 26); i++) {
      const p = fire.emit(at);
      p.velocity.copy(out).multiplyScalar((12 + random() * (ricochet ? 75 : 50)) * size)
        .add(new THREE.Vector3(random() - .5, random() - .3, random() - .5).multiplyScalar(24 * size));
      p.size = (.1 + random() * .22) * size; p.stretch = 6 + random() * 9;
      p.align = 'velocity'; p.life = .3 + random() * .7; p.gravity = 9.81; p.drag = .6;
      p.color.setRGB(2.4, 1.6, .75); p.waterline = true;
    }
    if (ricochet) {
      for (let i = 0; i < 2; i++) {
        const p = volumes.emit(at, event.shipId);
        p.velocity.copy(normal).multiplyScalar((3 + random() * 6) * size); p.velocity.y += 1 + random() * 2;
        p.size = (2 + random() * 2) * size; p.growth = 5 * size; p.growthDecay = 1.2; p.diffusion = .3 * size;
        p.life = 2.5 + random(); p.dissipationTime = 1; p.cooling = .01; p.drag = 1; p.wind = .55; p.density = 2.2;
        p.color.set('#77766f'); p.opacity = .7;
      }
      return;
    }
    this.fragments(at, normal, solid ? 7 : 4, solid ? 2 : 0, 1.4 * size, random);
    // Hot gas blooms out of the hole and cools in place into soot.
    for (let i = 0; i < (solid ? 4 : 2); i++) {
      const p = volumes.emit(at, event.shipId), side = this.sideways(random).clone();
      p.position.addScaledVector(normal, (.5 + random() * .6) * size).addScaledVector(side, (.3 + random() * .7) * size);
      p.velocity.copy(normal).multiplyScalar((9 + random() * 12) * size).addScaledVector(side, (2 + random() * 5) * size);
      p.velocity.y += 2 * size;
      p.size = (3.5 + random() * 3) * size; p.growth = (solid ? 24 + random() * 10 : 14) * size; p.growthDecay = 3; p.diffusion = .6 * size;
      p.heat = solid ? 1.25 + random() * .15 : .85; p.cooling = (.5 + random() * .25) * Math.sqrt(size);
      p.life = solid ? 5.5 + random() * 2 : 3 + random(); p.dissipationTime = solid ? 2.2 : 1.2;
      p.drag = 2.6; p.gravity = -1.5; p.wind = .6; p.density = 3 + random() * .8; p.opacity = .95;
      p.color.copy(SOOT).multiplyScalar(.9 + random() * .2);
    }
    if (solid) this.smoulder(event.shipId, at, normal, (12 + random() * 14) * Math.sqrt(scale), scale, random);
  }

  /** High-explosive and fuzed detonations: a larger, sootier fireball, black smoke and fragments. */
  heBurst(event: CombatEvent, random: () => number): void {
    const { volumes, fire, illuminate } = this.context;
    const s = clamp((event.blastRadiusM ?? 2) / 4.5, .25, 2.2);
    const at = this.position.fromArray(event.position);
    const normal = event.normal ? this.normal.fromArray(event.normal).normalize() : this.normal.set(0, 1, 0);
    if (event.shell && normal.dot(this.direction.fromArray(event.shell.velocity)) > 0) normal.negate();
    this.frame(normal);
    illuminate(this.point.copy(at).addScaledVector(normal, 2 * s), 3400 * s * s, .16, 70 * s);
    const flash = fire.emit(at);
    flash.size = 5 * s; flash.growth = 90 * s; flash.growthDecay = 14; flash.life = .1; flash.color.setRGB(5, 4.3, 3.3);
    const glow = fire.emit(at);
    glow.size = 8 * s; glow.growth = 34 * s; glow.growthDecay = 5; glow.life = .28; glow.color.setRGB(3.2, 1.45, .45); glow.opacity = .85;
    for (let i = 0; i < 20; i++) {
      const p = fire.emit(at), y = random() * 1.6 - .6, yaw = random() * Math.PI * 2, r = Math.sqrt(1 - Math.min(1, y * y));
      p.velocity.set(Math.cos(yaw) * r, y, Math.sin(yaw) * r).addScaledVector(normal, .6).normalize().multiplyScalar((30 + random() * 60) * s);
      p.size = (.12 + random() * .2) * s; p.stretch = 7 + random() * 8; p.align = 'velocity'; p.life = .25 + random() * .5;
      p.gravity = 9.81; p.drag = .8; p.color.setRGB(2.6, 1.5, .6); p.waterline = true;
    }
    this.fragments(at, normal, 6, 2, 1.5 * s, random);
    for (let i = 0; i < 5; i++) {
      const p = volumes.emit(at, event.shipId), yaw = random() * Math.PI * 2, y = random() * 1.4 - .4, r = Math.sqrt(1 - Math.min(1, y * y));
      this.point.set(Math.cos(yaw) * r, y, Math.sin(yaw) * r).addScaledVector(normal, .7).normalize();
      p.position.addScaledVector(this.point, (1.5 + random() * 2.5) * s);
      p.velocity.copy(this.point).multiplyScalar((12 + random() * 18) * s); p.velocity.y += 3 * s;
      p.size = (3 + random() * 3.5) * s; p.growth = (20 + random() * 12) * s; p.growthDecay = 2.8; p.diffusion = .8 * s;
      p.heat = 1.35 + random() * .15; p.cooling = (.55 + random() * .3) * Math.sqrt(s);
      p.life = 6.5 + random() * 2; p.dissipationTime = 2.6; p.drag = 2.6; p.gravity = -1.8; p.wind = .6;
      p.density = 3.6; p.opacity = .96; p.color.copy(BLACK_SMOKE).multiplyScalar(.9 + random() * .2);
    }
    for (let i = 0; i < 3; i++) {
      const p = volumes.emit(at, event.shipId);
      p.position.addScaledVector(normal, 2 * s).add(new THREE.Vector3(random() - .5, random() * .6, random() - .5).multiplyScalar(6 * s));
      p.velocity.set((random() - .5) * 6, 4 + random() * 5, (random() - .5) * 6).multiplyScalar(s);
      p.size = (4.5 + random() * 3) * s; p.growth = (12 + random() * 8) * s; p.growthDecay = 1.2; p.diffusion = 1.2 * s; p.heat = .3; p.cooling = .6;
      p.life = 9 + random() * 3; p.dissipationTime = 3.5; p.drag = 1.2; p.gravity = -1; p.wind = .8; p.density = 2.6; p.opacity = .9;
      p.color.copy(BLACK_SMOKE).multiplyScalar(1.1);
    }
    if (event.shipId) this.smoulder(event.shipId, at, normal, (8 + random() * 8) * Math.sqrt(s), s, random);
  }

  /** Magazine ignition: flash, fireball, a rising column capped by a spreading mushroom, flaming
   * debris arcs, secondary explosions and a shock ring on the sea. */
  magazine(event: CombatEvent, random: () => number): void {
    const { volumes, fire, foam, mist, spray, spouts, illuminate } = this.context;
    const hull = this.hulls(event.shipId), s = clamp((hull?.lengthM ?? 240) / 240, .35, 1.2);
    const base = this.position.fromArray(event.position); base.y = Math.max(base.y, 3);
    const source = event.shipId;
    illuminate(this.point.copy(base).addScaledVector(UP, 40 * s), 900000 * s * s, 1.6, 2200 * s);
    for (let i = 0; i < 3; i++) {
      const flash = fire.emit(this.point.copy(base).addScaledVector(UP, (8 + i * 16) * s));
      flash.size = (40 + i * 10) * s; flash.growth = (420 - i * 90) * s; flash.growthDecay = 5 + i; flash.life = .4 + i * .12; flash.age = -i * .05;
      flash.color.setRGB(5, 4, 2.8 - i * .6); flash.opacity = 1;
    }
    // Fireball.
    for (let i = 0; i < 10; i++) {
      const yaw = random() * Math.PI * 2, y = .15 + random() * .85, r = Math.sqrt(1 - y * y);
      const p = volumes.emit(base, source);
      this.point.set(Math.cos(yaw) * r, y, Math.sin(yaw) * r);
      p.position.addScaledVector(this.point, (4 + random() * 8) * s);
      p.velocity.copy(this.point).multiplyScalar((25 + random() * 45) * s); p.velocity.y += 22 * s;
      p.drag = 1.3; p.size = (18 + random() * 10) * s; p.growth = 50 * s; p.growthDecay = 1.1; p.diffusion = 1.2 * s;
      p.heat = 1.4 + random() * .15; p.cooling = 1.6 + random() * 1.2; p.life = 50 + random() * 14; p.dissipationTime = 26;
      p.density = 2.7; p.gravity = -2.4; p.wind = .6; p.opacity = .97; p.color.copy(BLACK_SMOKE).multiplyScalar(.8 + random() * .3);
    }
    // Column: each billow decelerates at its own height under drag, stacking into a stem.
    for (let i = 0; i < 9; i++) {
      const p = volumes.emit(base, source), rise = (18 + i * 13 + random() * 6) * s;
      p.position.x += (random() - .5) * 12 * s; p.position.z += (random() - .5) * 12 * s;
      p.velocity.set((random() - .5) * 6, rise, (random() - .5) * 6);
      p.drag = .36; p.size = (20 + random() * 8) * s; p.growth = (12 + i * 1.5) * s; p.growthDecay = .2; p.diffusion = .8 * s;
      p.heat = .7 - i * .06; p.cooling = 3 + random() * 2; p.life = 70 + random() * 15; p.dissipationTime = 45;
      p.density = 2.3; p.gravity = -.7; p.wind = .5 + i * .05; p.opacity = .95;
      p.color.copy(SOOT).multiplyScalar(.95 + i * .07);
      this.volumeAxis(p, UP, 1.35);
    }
    // Mushroom cap: billows that reach the top and roll outward.
    for (let i = 0; i < 7; i++) {
      const angle = (i + random() * .5) / 7 * Math.PI * 2, radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const p = volumes.emit(base, source);
      p.velocity.set(0, (125 + random() * 15) * s, 0).addScaledVector(radial, (20 + random() * 12) * s);
      p.drag = .34; p.size = (34 + random() * 8) * s; p.growth = (26 + random() * 8) * s; p.growthDecay = .2; p.diffusion = 1 * s;
      p.heat = .45; p.cooling = 4.5; p.life = 75 + random() * 15; p.dissipationTime = 50;
      p.density = 2; p.gravity = -.9; p.wind = .8; p.opacity = .94;
      p.color.set('#6a645c').multiplyScalar(.9 + random() * .15);
      this.volumeAxis(p, radial, 1.6);
    }
    // Secondary explosions ripple along the hull.
    for (let i = 0; i < 5; i++) {
      const delay = .35 + random() * 2.6;
      this.point.set((random() - .5) * 120 * s, 4 + random() * 20 * s, (random() - .5) * 120 * s).add(base);
      if (hull) this.point.copy(base).add(new THREE.Vector3(...rotate([(random() - .5) * 14 * s, 0, (random() - .5) * (hull.lengthM * .7)], hull.pose))).setY(base.y + 4 + random() * 10);
      const flash = fire.emit(this.point);
      flash.age = -delay; flash.size = 14 * s; flash.growth = 120 * s; flash.growthDecay = 8; flash.life = .3; flash.color.setRGB(4.5, 3, 1.5);
      for (let j = 0; j < 2; j++) {
        const p = volumes.emit(this.point, source);
        p.age = -delay; p.velocity.set((random() - .5) * 20, 18 + random() * 20, (random() - .5) * 20).multiplyScalar(s);
        p.drag = 1.4; p.size = (9 + random() * 5) * s; p.growth = 32 * s; p.growthDecay = 1.4; p.diffusion = 1.2 * s;
        p.heat = 1.3; p.cooling = 1.2 + random() * .6; p.life = 26 + random() * 8; p.dissipationTime = 10;
        p.density = 2.6; p.gravity = -1.6; p.wind = .7; p.opacity = .95; p.color.copy(BLACK_SMOKE);
      }
    }
    // Flaming debris arcs with smoke trails, plus burning grains.
    this.fragments(base, UP, 20, 12, 6 * s, random, [45, 125], s, 1.6);
    for (let i = 0; i < 40; i++) {
      const p = fire.emit(base), yaw = random() * Math.PI * 2, y = .2 + random() * .8, r = Math.sqrt(1 - y * y);
      p.velocity.set(Math.cos(yaw) * r, y, Math.sin(yaw) * r).multiplyScalar((40 + random() * 90) * s);
      p.size = (.5 + random() * .8) * s; p.stretch = 6; p.align = 'velocity'; p.life = 1.2 + random() * 1.6;
      p.gravity = 9.81; p.drag = .35; p.color.setRGB(2.8, 1.4, .45); p.waterline = true;
    }
    // Shock ring, base surge and the sea thrown up around the hull.
    this.point.copy(base); this.point.y = .45;
    const ring = foam.emit(this.point);
    ring.align = 'water'; ring.size = 30 * s; ring.growth = 520 * s; ring.growthDecay = 2.1; ring.life = 1.8; ring.opacity = .42; ring.color.copy(WATER);
    for (let i = 0; i < 18; i++) {
      const angle = random() * Math.PI * 2;
      const p = mist.emit(this.point.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(25 * s)));
      p.position.y = 3; p.velocity.set(Math.cos(angle), .05, Math.sin(angle)).multiplyScalar((40 + random() * 40) * s);
      p.drag = 1.1; p.size = (14 + random() * 8) * s; p.growth = 16 * s; p.growthDecay = .5; p.life = 4 + random() * 2;
      p.fadeIn = .08; p.opacity = .28; p.wind = .9; p.color.copy(WATER).multiplyScalar(.9);
    }
    for (let i = 0; i < 4; i++) {
      const angle = random() * Math.PI * 2;
      this.point.set(base.x + Math.cos(angle) * 30 * s, .35, base.z + Math.sin(angle) * 30 * s);
      spouts.emit(this.point, 1.4 * s, UP, random);
    }
    for (let i = 0; i < 40; i++) {
      const p = spray.emit(this.point.set(base.x, .4, base.z)), angle = random() * Math.PI * 2;
      p.velocity.set(Math.cos(angle) * (15 + random() * 30), 20 + random() * 40, Math.sin(angle) * (15 + random() * 30)).multiplyScalar(s);
      p.size = (.4 + random() * .8) * s; p.life = 6; p.gravity = 9.81; p.drag = .15; p.waterline = true; p.opacity = .8; p.color.copy(WATER);
    }
  }

  /** Dark fragments thrown from `at`; the first `trailing` of them lay smoke behind them. */
  private fragments(at: THREE.Vector3, normal: THREE.Vector3, count: number, trailing: number, size: number, random: () => number,
    speed: [number, number] = [10, 34], scale = 1, trailScale = 1): void {
    for (let i = 0; i < count; i++) {
      const yaw = random() * Math.PI * 2, y = random() * 1.2 - .2, r = Math.sqrt(1 - Math.min(1, y * y));
      this.point.set(Math.cos(yaw) * r, y, Math.sin(yaw) * r).addScaledVector(normal, 1.1).normalize();
      if (this.point.y < .15) this.point.y = .15 + random() * .3;
      const velocity = this.point.normalize().multiplyScalar((speed[0] + random() * (speed[1] - speed[0])) * scale);
      velocity.y += (4 + random() * 10) * Math.sqrt(scale);
      const chunk = this.debris.emit(at);
      chunk.velocity.copy(velocity); chunk.gravity = 9.81; chunk.drag = .12; chunk.life = 14; chunk.waterline = true;
      chunk.size = (.35 + random() * .8) * size * (i < trailing ? 1.2 : 1); chunk.stretch = .6 + random() * .8;
      chunk.angle = random() * 6.3; chunk.spin = (random() - .5) * 16; chunk.color.setRGB(1, 1, 1);
      if (i < trailing) this.trail(at, velocity, chunk.drag, chunk.gravity, .5 * size * trailScale * (.8 + random() * .4), trailScale > 1 ? 5 : 1.8, random);
    }
  }

  private trail(at: THREE.Vector3, velocity: THREE.Vector3, drag: number, gravity: number, size: number, fade: number, random: () => number): void {
    const trail = this.trails[this.trailCursor++ % TRAILS];
    trail.position.copy(at); trail.velocity.copy(velocity); trail.drag = drag; trail.gravity = gravity;
    trail.age = 0; trail.life = 12; trail.interval = .03; trail.credit = 0; trail.size = size; trail.opacity = .5; trail.seed = random() * 100;
    trail.fade = fade;
  }

  private smoulder(shipId: string, at: THREE.Vector3, normal: THREE.Vector3, life: number, strength: number, random: () => number): void {
    const hull = shipId ? this.hulls(shipId) : undefined;
    if (!hull) return;
    const local = worldToLocal(at.toArray() as Vec3, hull.pose);
    const tip = worldToLocal(this.point.copy(at).add(normal).toArray() as Vec3, hull.pose);
    if (this.smoulders.length >= SMOULDERS) this.smoulders.shift();
    this.smoulders.push({ shipId, local, normal: [tip[0] - local[0], tip[1] - local[1], tip[2] - local[2]], age: 0, life, credit: 0,
      strength: clamp(strength, .3, 1.7), seed: random() * 1000 });
  }

  /** Age smoke and fragments; emit trail and smoulder puffs for this frame. Call before `publish`. */
  update(dt: number, wind: THREE.Vector3): void {
    this.soot.advance(dt, wind); this.debris.advance(dt, wind);
    if (dt <= 0) return;
    for (const trail of this.trails) {
      if (trail.age >= trail.life) continue;
      const step = dt, decay = Math.exp(-trail.drag * step);
      const travel = trail.drag > .0001 ? (1 - decay) / trail.drag : step;
      const terminal = trail.drag > .0001 ? trail.gravity / trail.drag : 0;
      const from = this.point.copy(trail.position);
      trail.position.x += trail.velocity.x * travel; trail.position.z += trail.velocity.z * travel;
      trail.position.y += trail.drag > .0001 ? (trail.velocity.y + terminal) * travel - terminal * step : trail.velocity.y * step - .5 * trail.gravity * step * step;
      trail.velocity.x *= decay; trail.velocity.z *= decay;
      trail.velocity.y = trail.drag > .0001 ? (trail.velocity.y + terminal) * decay - terminal : trail.velocity.y - trail.gravity * step;
      trail.age += dt; trail.credit += dt;
      const fade = 1 - trail.age / trail.fade;
      if (trail.position.y < .3 || fade <= 0) { trail.age = trail.life; continue; }
      const random = seeded(Math.floor(trail.seed * 997 + trail.age * 60));
      while (trail.credit >= trail.interval) {
        trail.credit -= trail.interval;
        const p = this.soot.emit(this.position.lerpVectors(from, trail.position, 1 - trail.credit / dt));
        p.size = trail.size * (.7 + random() * .4); p.growth = trail.size * 1.1; p.growthDecay = .45; p.diffusion = .2;
        p.life = 2.4 + random() * 1.6; p.velocity.set((random() - .5) * 1.5, 1 + random(), (random() - .5) * 1.5);
        p.drag = .8; p.wind = .7; p.opacity = trail.opacity * fade; p.angle = random() * 6.3; p.spin = (random() - .5) * .4;
        p.color.copy(SOOT).multiplyScalar(1.1 + random() * .3);
      }
    }
    for (let i = this.smoulders.length - 1; i >= 0; i--) {
      const s = this.smoulders[i];
      s.age += dt;
      const hull = this.hulls(s.shipId);
      if (s.age >= s.life || !hull) { this.smoulders.splice(i, 1); continue; }
      const world = localToWorld(s.local, hull.pose);
      if (world[1] < .3) continue;
      const vigour = 1 - s.age / s.life, rate = (2.2 + 2.5 * vigour) * this.density;
      s.credit += dt * rate;
      const random = seeded(Math.floor(s.seed + s.age * 40));
      const normal = rotate(s.normal, hull.pose);
      while (s.credit >= 1) {
        s.credit -= 1;
        const p = this.soot.emit(this.position.set(world[0] + normal[0] * .6, world[1] + normal[1] * .6 + .4, world[2] + normal[2] * .6), s.shipId);
        p.size = (1.4 + random()) * s.strength; p.growth = (2.6 + random() * 1.4) * s.strength; p.growthDecay = .28; p.diffusion = .25;
        p.life = 6 + random() * 3; p.fadeIn = .4;
        p.velocity.set(normal[0] * 2.5 + (random() - .5), 2.5 + random() * 1.5 + normal[1] * 2, normal[2] * 2.5 + (random() - .5));
        p.drag = .35; p.gravity = -.25; p.wind = .9; p.opacity = (.34 + .3 * vigour) * Math.min(1, s.strength);
        p.angle = random() * 6.3; p.spin = (random() - .5) * .3;
        p.color.copy(SOOT).multiplyScalar(.8 + random() * .4 + (1 - vigour) * .5);
      }
    }
  }

  publish(camera: THREE.Camera, opticsShipId?: string): void {
    this.soot.publish(camera, opticsShipId); this.debris.publish(camera);
  }

  reset(): void {
    this.soot.reset(); this.debris.reset(); this.pending.length = 0; this.smoulders.length = 0; this.trailCursor = 0;
    for (const trail of this.trails) { trail.age = 1; trail.life = 0; }
  }
  diagnostics() {
    return { soot: this.soot.count, debris: this.debris.count, smoulders: this.smoulders.length,
      trails: this.trails.filter(t => t.age < t.life).length, capacity: this.soot.capacity + this.debris.capacity };
  }
  dispose(): void {
    this.root.removeFromParent(); this.soot.dispose(); this.debris.dispose(); this.smokeMap.dispose(); this.debrisMap.dispose();
  }
}

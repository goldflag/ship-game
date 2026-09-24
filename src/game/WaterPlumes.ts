import * as THREE from 'three/webgpu';
import { EffectLighting } from './EffectLighting';
import { sprayJetMaterial, sprayStreakTexture } from './SprayMaterial';

const SEGMENTS = 14;
const ROWS = SEGMENTS + 1;
const VERTICES = ROWS * 2;
const GRAVITY = 9.81;
const DRAG = .12;
const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);
const lerp = ([low, high]: readonly [number, number], t: number) => low + (high - low) * t;
/** Each row is the water launched at that share of the jet's tip speed. */
const ALONG = Array.from({ length: ROWS }, (_, row) => row / SEGMENTS);
/** Outward travel against the share of tip speed: the fast upper water flares the jets into a fan. */
const REACH = ALONG.map(along => .12 + .88 * along * along);
/** The finest water at the tip thins to nothing. */
const TIP = ALONG.map(along => 1 - smooth(.86, 1, along));
/** The column's body thins toward the tips, where the sun gets through. */
const DENSE = ALONG.map(along => (1 - along) ** .8);
/** Tear threshold by row before ageing: the tip breaks into separate streaks first. */
const TEAR = ALONG.map(along => .12 + along * .05 + smooth(.7, 1, along) * .2);
const MIDDLE = SEGMENTS >> 1;

interface JetRecipe {
  /** Launch speeds of the tip water at unit scale (m/s), up and out from the column. */
  up: readonly [number, number];
  out: readonly [number, number];
  /** Radius of the ring the jet leaves from, and its width there, at unit scale (m). */
  base: readonly [number, number];
  width: readonly [number, number];
  /** Latest start after the impact (s). */
  delay: number;
  /** Share of its base width the tip keeps: small for a spike, larger for the skirt's ragged lip. */
  tip: number;
  /** How much of the column's body the jet carries: dense water hides the sun from the far side. */
  body: number;
}

/** The dense core, the fan of outer jets that opens the column into a V, and the low skirt thrown out around
 * its base. Speeds and sizes are authored against photographs and footage of heavy shell splashes (a 38 cm
 * column stands about 60 m high and as wide at its crown); they are not a hydrodynamic solve. */
const CORE: JetRecipe = { up: [38, 46], out: [.5, 3], base: [.8, 2.6], width: [8, 11], delay: .04, tip: .14, body: 1 };
const FAN: JetRecipe = { up: [24, 38], out: [4, 10], base: [2.5, 4.5], width: [6, 9], delay: .1, tip: .1, body: .75 };
const SKIRT: JetRecipe = { up: [11, 17], out: [9, 18], base: [3.5, 6], width: [7, 10], delay: .03, tip: .4, body: .4 };
/** Jets per splash. Secondary and lighter guns (below about 11 cm at scale .45) throw fewer. */
const HEAVY: readonly (readonly [JetRecipe, number])[] = [[CORE, 8], [FAN, 20], [SKIRT, 10]];
const LIGHT: readonly (readonly [JetRecipe, number])[] = [[CORE, 4], [FAN, 9], [SKIRT, 5]];
const LIGHT_BELOW = .45;
export const JETS_PER_SPLASH = HEAVY.reduce((sum, [, count]) => sum + count, 0);

interface WaterJet {
  origin: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
  cosine: number;
  sine: number;
  up: number;
  out: number;
  base: number;
  leanX: number;
  leanZ: number;
  seed: number;
  body: number;
  /** Jets differ a little in how much light their water scatters back. */
  shade: number;
  /** The splash's own fan (mean outward speed and base radius), which sets the column's girth for self-shadow. */
  spread: number;
  girth: number;
  bends: Float64Array;
  widths: Float64Array;
  distance: number;
}

/** A bounded batch of water jets, each spanning a range of launch speeds from its slow root to its fast tip.
 * Gravity pulls the lower water back first, then the tips. Each jet's spine is fixed in the world and never
 * turns with the camera or flips at its apex; only its width turns to face the viewer, so the column keeps its
 * body from every side, the air above it included. One draw; visual launch speeds and widths are authored. */
export class WaterPlumes {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly jets: WaterJet[];
  private readonly active: WaterJet[] = [];
  private readonly position: THREE.BufferAttribute;
  private readonly side: THREE.BufferAttribute;
  private readonly state: THREE.BufferAttribute;
  private readonly spine = new Float64Array(ROWS * 3);
  private readonly eye = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  /** The scene light the spray is shaded with: the combat effects' own, or one made here for a standalone batch. */
  readonly lighting: EffectLighting;
  private readonly ownedLighting?: EffectLighting;
  private readonly ownedMap?: THREE.Texture;
  private cursor = 0;

  constructor(readonly capacity: number, lighting?: EffectLighting, map?: THREE.Texture) {
    this.lighting = lighting ?? (this.ownedLighting = new EffectLighting());
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.side = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.state = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const coords = new Float32Array(capacity * VERTICES * 2), indices: number[] = [];
    for (let jet = 0; jet < capacity; jet++) {
      for (let row = 0; row < ROWS; row++) for (let side = 0; side < 2; side++) {
        const index = jet * VERTICES + row * 2 + side;
        coords[index * 2] = side; coords[index * 2 + 1] = ALONG[row];
      }
      for (let row = 0; row < SEGMENTS; row++) {
        const index = jet * VERTICES + row * 2;
        indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
      }
    }
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('jetSide', this.side);
    geometry.setAttribute('jetState', this.state);
    geometry.setAttribute('uv', new THREE.BufferAttribute(coords, 2));
    geometry.setIndex(indices); geometry.setDrawRange(0, 0);
    if (!map) map = this.ownedMap = sprayStreakTexture();
    this.mesh = new THREE.Mesh(geometry, sprayJetMaterial(this.lighting, map));
    this.mesh.name = 'Splash water jets';
    this.mesh.frustumCulled = false;
    this.jets = Array.from({ length: capacity }, () => ({ origin: new THREE.Vector3(), age: 0, life: 0, scale: 1, cosine: 1, sine: 0,
      up: 0, out: 0, base: 0, leanX: 0, leanZ: 0, seed: 0, body: 0, shade: 1, spread: 0, girth: 0,
      bends: new Float64Array(ROWS), widths: new Float64Array(ROWS), distance: 0 }));
  }

  emit(origin: THREE.Vector3, scale: number, direction: THREE.Vector3, random: () => number): void {
    const rootScale = Math.sqrt(scale);
    const steepness = Math.min(1, Math.abs(direction.y));
    const lift = .8 + .2 * Math.sqrt(steepness);
    const lean = (2 + 5 * (1 - steepness)) * rootScale;
    const rotation = random() * Math.PI * 2;
    const spread = (FAN.out[0] + FAN.out[1]) / 2 * rootScale, girth = (FAN.base[0] + FAN.base[1]) / 2 * scale;
    (scale < LIGHT_BELOW ? LIGHT : HEAVY).forEach(([recipe, count], ring) => {
      for (let i = 0; i < count; i++) {
        const jet = this.claim();
        jet.origin.copy(origin); jet.scale = scale; jet.body = recipe.body;
        jet.spread = spread; jet.girth = girth;
        jet.age = -random() * recipe.delay;
        // Rings are staggered, so the jets of one ring fill the gaps of the last.
        const angle = rotation + ring * .37 + (i + random() * .7) / count * Math.PI * 2;
        jet.cosine = Math.cos(angle); jet.sine = Math.sin(angle);
        jet.up = lerp(recipe.up, random()) * rootScale * lift;
        jet.out = lerp(recipe.out, random()) * rootScale;
        jet.base = lerp(recipe.base, random()) * scale;
        const width = lerp(recipe.width, random()) * scale;
        jet.leanX = direction.x * lean; jet.leanZ = direction.z * lean;
        jet.seed = random() * Math.PI * 2; jet.shade = .86 + random() * .14;
        // Launch-specific folds, cached once: lateral wander, and the strands bunching and thinning along the jet.
        for (let row = 0; row < ROWS; row++) {
          const along = ALONG[row];
          jet.bends[row] = Math.sin(along * 19 + jet.seed) * Math.sin(along * 7 + jet.seed);
          const folds = .78 + .32 * Math.sin(along * 12 + jet.seed) ** 2;
          jet.widths[row] = width * folds * (1 - (1 - recipe.tip) * along * along);
        }
        // Bound the full return to sea; drag makes the real flight shorter.
        jet.life = jet.up * 2 / GRAVITY + .15;
      }
    });
  }

  /** The next jet in ring order that has finished, or else the one nearest the end of its flight: a burst of
   * small splashes never cuts a heavy column short while older water is still falling. */
  private claim(): WaterJet {
    let chosen = this.cursor % this.capacity, spent = -Infinity;
    for (let probe = 0; probe < this.capacity; probe++) {
      const index = (this.cursor + probe) % this.capacity, jet = this.jets[index];
      if (jet.age >= jet.life) { chosen = index; break; }
      const fraction = jet.age / jet.life;
      if (fraction > spent) { spent = fraction; chosen = index; }
    }
    this.cursor = chosen + 1;
    return this.jets[chosen];
  }

  /** Towards the sun; shared with the combat effects' lighting, which also shades the spray. */
  setSun(direction: THREE.Vector3, daylight = 1): void { this.lighting.setSun(direction, daylight); }

  advance(dt: number): void {
    for (const jet of this.jets) if (jet.age < jet.life) jet.age += dt;
  }

  publish(camera: THREE.Camera): void {
    this.active.length = 0;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    for (const jet of this.jets) {
      if (jet.age < 0 || jet.age >= jet.life) continue;
      if (perspective) {
        // Cull only when the entire launch envelope is outside the view.
        // Visible jets retain their full silhouette at every zoom level.
        this.center.copy(jet.origin); this.center.y += 24 * jet.scale;
        this.center.applyMatrix4(camera.matrixWorldInverse);
        const radius = 65 * Math.max(jet.scale, Math.sqrt(jet.scale)), depth = -this.center.z;
        const projection = camera.projectionMatrix.elements;
        if (depth + radius < .1 || Math.abs(this.center.x) > Math.max(depth, 0) / projection[0] + radius * 2
          || Math.abs(this.center.y) > Math.max(depth, 0) / projection[5] + radius * 2) continue;
      }
      const travel = -Math.expm1(-DRAG * jet.age) / DRAG;
      const fall = GRAVITY / DRAG * (jet.age - travel);
      if (jet.up * travel - fall <= 0) continue;
      // Sort on each jet's middle: the far side of a column draws first and shows through gaps in the near side.
      const reach = jet.base + jet.out * travel * REACH[MIDDLE], along = ALONG[MIDDLE];
      const dx = jet.origin.x + jet.cosine * reach + jet.leanX * travel * along - this.eye.x;
      const dy = jet.origin.y + jet.up * along * travel - fall - this.eye.y;
      const dz = jet.origin.z + jet.sine * reach + jet.leanZ * travel * along - this.eye.z;
      jet.distance = dx * dx + dy * dy + dz * dz;
      this.active.push(jet);
    }
    this.active.sort((a, b) => b.distance - a.distance);
    const sun = this.lighting.sunDirection.value, horizontal = Math.hypot(sun.x, sun.z);
    const towardX = horizontal > 1e-4 ? sun.x / horizontal : 0, towardZ = horizontal > 1e-4 ? sun.z / horizontal : 0;
    // A column shades its own far side from a low sun; a high sun lights every side alike.
    const shading = Math.min(1, horizontal * 1.6);
    const spine = this.spine, eyeX = this.eye.x, eyeY = this.eye.y, eyeZ = this.eye.z;
    const positions = this.position.array as Float32Array, sides = this.side.array as Float32Array, states = this.state.array as Float32Array;
    for (let index = 0; index < this.active.length; index++) {
      const jet = this.active[index], age = jet.age;
      const travel = -Math.expm1(-DRAG * age) / DRAG;
      const fall = GRAVITY / DRAG * (age - travel);
      const opening = 1 - Math.exp(-age * 38);
      const breakup = smooth(.65, 4.2 * Math.sqrt(jet.scale), age);
      const fade = (1 - smooth(jet.life * .55, jet.life, age)) * opening;
      const bending = (.2 + .2 * Math.min(age, 2)) * jet.scale * opening;
      const spreading = opening * (1 + age * .13);
      // The spine depends on the water alone, never on the camera.
      for (let row = 0; row < ROWS; row++) {
        const along = ALONG[row], radius = jet.base + jet.out * travel * REACH[row], bend = jet.bends[row] * bending;
        spine[row * 3] = jet.origin.x + jet.cosine * radius + jet.leanX * travel * along - jet.sine * bend;
        spine[row * 3 + 1] = jet.origin.y + Math.max(-.5, jet.up * along * travel - fall);
        spine[row * 3 + 2] = jet.origin.z + jet.sine * radius + jet.leanZ * travel * along + jet.cosine * bend;
      }
      const rise = .65 * jet.scale, tearing = breakup * .42, dense = jet.body * shading * .75;
      for (let row = 0; row < ROWS; row++) {
        const along = ALONG[row], at = row * 3;
        const before = row > 0 ? at - 3 : at, after = row < SEGMENTS ? at + 3 : at;
        const tx = spine[after] - spine[before], ty = spine[after + 1] - spine[before + 1], tz = spine[after + 2] - spine[before + 2];
        const cx = spine[at], cy = spine[at + 1], cz = spine[at + 2];
        const ex = eyeX - cx, ey = eyeY - cy, ez = eyeZ - cz;
        // The strip's width lies across both its flight and the line of sight.
        let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex;
        const squared = sx * sx + sy * sy + sz * sz;
        if (squared > 1e-12 * (tx * tx + ty * ty + tz * tz) * (ex * ex + ey * ey + ez * ez)) {
          const inverse = 1 / Math.sqrt(squared); sx *= inverse; sy *= inverse; sz *= inverse;
        } else { sx = -jet.sine; sy = 0; sz = jet.cosine; }
        const width = jet.widths[row] * spreading, height = cy - jet.origin.y;
        const alpha = fade * smooth(0, rise, height) * TIP[row] * .95;
        // Strands tear as the jet ages; the tip breaks into separate streaks first.
        const tear = TEAR[row] + tearing;
        const axisX = jet.origin.x + jet.leanX * travel * along, axisZ = jet.origin.z + jet.leanZ * travel * along;
        const girth = Math.max(1, jet.girth + jet.spread * travel * REACH[row] + width * .5);
        // The dense lower column hides the sun from its far side; the thin tips let it through.
        const body = dense * DENSE[row], sky = (.8 + .2 * along) * jet.shade;
        for (let side = 0; side < 2; side++) {
          const vertex = (index * ROWS + row) * 2 + side, offset = (side - .5) * width;
          const x = cx + sx * offset, y = cy + sy * offset, z = cz + sz * offset;
          // Across the column toward the sun, −1 on its far side to +1 on its sunward face, eased from −0.9 to 0.7.
          const t = Math.min(1, Math.max(0, (((x - axisX) * towardX + (z - axisZ) * towardZ) / girth + .9) / 1.6));
          const three = vertex * 3, four = vertex * 4;
          positions[three] = x; positions[three + 1] = y; positions[three + 2] = z;
          sides[four] = sx; sides[four + 1] = sy; sides[four + 2] = sz; sides[four + 3] = jet.seed;
          states[four] = alpha; states[four + 1] = tear; states[four + 2] = (1 - body * (1 - t * t * (3 - 2 * t))) * jet.shade; states[four + 3] = sky;
        }
      }
    }
    this.mesh.geometry.setDrawRange(0, this.active.length * SEGMENTS * 6);
    for (const buffer of [this.position, this.side, this.state]) {
      buffer.clearUpdateRanges();
      if (this.active.length) {
        buffer.addUpdateRange(0, this.active.length * VERTICES * buffer.itemSize);
        buffer.needsUpdate = true;
      }
    }
  }

  get count(): number { return this.active.length; }
  reset(): void {
    for (const jet of this.jets) { jet.age = 0; jet.life = 0; }
    this.cursor = 0; this.active.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.ownedMap?.dispose(); this.ownedLighting?.dispose(); }
}

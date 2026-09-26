import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, attribute, positionGeometry, cameraPosition, cameraProjectionMatrix, cos, cross, dot, exp, float, floor, fract, hash, instanceIndex, int, ivec2, length, max, screenSize,
  min, mix, mod, normalize, pow, select, sin, smoothstep, sqrt, texture, texture3D, textureStore, uniform, uniformArray, uvec2, uvec3, varying,
  vec2, vec3, vec4,
} from 'three/tsl';
import type { EffectLighting } from './EffectLighting';

type Float = THREE.Node<'float'>;
type Int = THREE.Node<'int'>;
type Vec2 = THREE.Node<'vec2'>;
type Vec3 = THREE.Node<'vec3'>;
type Vec4 = THREE.Node<'vec4'>;

/** Texels across one baked puff, puffs across the atlas, and so the atlas edge. */
export const GAS_TILE = 256, GAS_GRID = 4, GAS_VARIANTS = GAS_GRID * GAS_GRID, GAS_ATLAS = GAS_TILE * GAS_GRID;
/** Round lobes each puff is built from before the billows erode it. */
const LOBES = 12;
/** Texels per edge of the tiling detail map: small billows the sprites add at close range. */
const DETAIL = 256;
/** Texels per edge of the tiling noise volume the bake reads. */
const NOISE = 64;
/** Steps through a puff along the view, and extinction per unit of density and puff radius. */
const VIEW_STEPS = 48, SIGMA = 7;
/** Optical depth that fills the atlas's depth channel: thinning a puff scales its depth, so the channel keeps depth rather than
 * opacity (which saturates in a dense core, where no amount of thinning would then show). */
export const GAS_DEPTH = 12;
/** Distances toward each light (in puff radii) at which the bake samples the shadowing gas. */
const LIGHT_STEPS = [.03, .05, .08, .12, .17, .24, .36, .5];

/** Visual randomness for the bake: a fixed stream, so every load draws the same puffs. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Each puff's lobes as (centre, radius) in its unit sphere: a large body with smaller lobes swelling out of it, all inside
 * radius 0.92 so the billows that grow on them never reach the tile's edge. A few puffs are lopsided or twin-bodied. */
export function gasLobes(): THREE.Vector4[] {
  const random = seeded(1941), lobes: THREE.Vector4[] = [];
  for (let v = 0; v < GAS_VARIANTS; v++) {
    const twin = v % 5 === 3, lean = v % 4 === 1 ? .16 : 0;
    const body = twin ? .4 : .47 + random() * .08;
    const heading = random() * Math.PI * 2;
    if (twin) {
      lobes.push(new THREE.Vector4(Math.cos(heading) * .22, -.05, Math.sin(heading) * .22, body));
      lobes.push(new THREE.Vector4(-Math.cos(heading) * .24, .04, -Math.sin(heading) * .24, body * .92));
    } else lobes.push(new THREE.Vector4(Math.cos(heading) * lean, -.04, Math.sin(heading) * lean, body));
    while (lobes.length < (v + 1) * LOBES) {
      // Lobes swell mostly outward and up, as a rising, rolling cloud's do: a few large ones, then smaller ones crowding the rim.
      const k = lobes.length - v * LOBES, small = k > 6;
      const yaw = random() * Math.PI * 2, y = -.55 + random() * 1.4, flat = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y)));
      const reach = (small ? .42 : .26) + random() * .2, radius = Math.min(.92 - reach, (small ? .12 : .2) + random() * (small ? .12 : .17));
      lobes.push(new THREE.Vector4(Math.cos(yaw) * flat * reach, y * reach, Math.sin(yaw) * flat * reach, radius));
    }
  }
  return lobes;
}

/** Three hashes in [0, 1) of an integer lattice point (float coordinates, well below 2²⁴ in total). */
function hash3(cell: Vec3, period: number, seed: number): Vec3 {
  const n = cell.x.add(cell.y.mul(period)).add(cell.z.mul(period * period)).mul(3).add(seed * 7919);
  return vec3(hash(n), hash(n.add(1)), hash(n.add(2)));
}

/** Tiling Worley F1 "billow" at `p` in [0, 1)³: 1 at a feature point, 0 a cell or more away. */
function billow(p: Vec3, cells: number, seed: number): Float {
  return Fn(() => {
    const q = p.mul(cells), cell = floor(q), f = fract(q);
    const nearest = float(9).toVar();
    Loop({ start: int(0), end: int(27), type: 'int' }, ({ i }) => {
      const offset = vec3(float(i.mod(3)), float(i.div(3).mod(3)), float(i.div(9))).sub(1);
      const point = offset.add(hash3(mod(cell.add(offset).add(cells), cells), cells, seed)).sub(f);
      nearest.assign(min(nearest, dot(point, point)));
    });
    return max(float(1).sub(sqrt(nearest)), 0);
  })();
}

/** Tiling 2D Worley F1 "billow" at `p` in [0, 1)²: 1 at a feature point, 0 a cell or more away. */
function billow2(p: Vec2, cells: number, seed: number): Float {
  return Fn(() => {
    const q = p.mul(cells), cell = floor(q), f = fract(q);
    const nearest = float(9).toVar();
    Loop({ start: int(0), end: int(9), type: 'int' }, ({ i }) => {
      const offset = vec2(float(i.mod(3)), float(i.div(3))).sub(1);
      const wrapped = mod(cell.add(offset).add(cells), cells);
      const n = wrapped.x.add(wrapped.y.mul(cells)).mul(2).add(seed * 7919);
      const point = offset.add(vec2(hash(n), hash(n.add(1)))).sub(f);
      nearest.assign(min(nearest, dot(point, point)));
    });
    return max(float(1).sub(sqrt(nearest)), 0);
  })();
}

/** Tiling gradient noise, about −1 … 1, at `p` in [0, 1)³ with `period` cells per repeat. */
function gradient(p: Vec3, period: number, seed: number): Float {
  const q = p.mul(period), cell = floor(q), f = fract(q);
  const corner = (x: number, y: number, z: number) => {
    const g = normalize(hash3(mod(cell.add(vec3(x, y, z)), period), period, seed).mul(2).sub(1));
    return dot(g, f.sub(vec3(x, y, z)));
  };
  const s = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
  const x00 = mix(corner(0, 0, 0), corner(1, 0, 0), s.x), x10 = mix(corner(0, 1, 0), corner(1, 1, 0), s.x);
  const x01 = mix(corner(0, 0, 1), corner(1, 0, 1), s.x), x11 = mix(corner(0, 1, 1), corner(1, 1, 1), s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z).mul(1.6);
}

/** Puffs of smoke and fire, lit six ways and baked once on the GPU.
 *
 * Each tile of the atlas is one puff: round lobes swollen into billows by tiling Worley noise, seen along −Z and
 * raymarched finely enough to keep every fold. For each texel the bake stores how much light the puff sends toward the
 * viewer when lit from the right, left, top, bottom (`sides`), from the viewer's side and from behind it, its opacity
 * and the temperature of the gas the eye sees (`body`). A sprite then relights the puff for any sun, moon, sky or flash
 * with two texture reads (the "six-way" lighting of film and game effects), instead of marching the gas per pixel, and a
 * burning puff glows where its hottest gas shows through, cooling from its rim inward.
 *
 * A small tiling `detail` map of billows lets sprites seen close up erode their thin rims into cauliflower and shade the
 * small folds, finer than one tile of the atlas can hold.
 *
 * The textures exist from construction (empty, so an unbaked atlas draws nothing) and are filled by `bake`. */
export class GasAtlas {
  /** Light from +X, −X, +Y and −Y of the tile (sprite right, left, top, bottom), per unit of opacity. */
  readonly sides: THREE.StorageTexture;
  /** Light from the viewer's side, light from behind the puff (halved), optical depth ÷ `GAS_DEPTH`, and the temperature seen. */
  readonly body: THREE.StorageTexture;
  /** Tiling small billows: surface normal (xy), height, and a coarse variation. */
  readonly detail: THREE.StorageTexture;
  private baked = false;

  constructor() {
    this.sides = GasAtlas.storage('Gas puffs, sides');
    this.body = GasAtlas.storage('Gas puffs, body');
    this.detail = GasAtlas.storage('Gas puff detail', DETAIL);
    this.detail.wrapS = this.detail.wrapT = THREE.RepeatWrapping;
  }

  private static storage(name: string, size = GAS_ATLAS): THREE.StorageTexture {
    const map = new THREE.StorageTexture(size, size);
    map.name = name;
    map.type = THREE.UnsignedByteType; map.format = THREE.RGBAFormat;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    // Mip levels follow each store, the first time a material samples the atlas after it.
    map.generateMipmaps = true;
    return map;
  }

  get ready(): boolean { return this.baked; }

  /** Fill the atlas: a few milliseconds of GPU once. Later calls do nothing. */
  bake(renderer: THREE.WebGPURenderer): void {
    if (this.baked) return;
    this.baked = true;
    const noise = new THREE.Storage3DTexture(NOISE, NOISE, NOISE);
    noise.name = 'Gas puff noise';
    noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
    noise.minFilter = noise.magFilter = THREE.LinearFilter;
    noise.generateMipmaps = false;
    const fill = Fn(() => {
      const i = instanceIndex, x = i.mod(NOISE), y = i.div(NOISE).mod(NOISE), z = i.div(NOISE * NOISE);
      const p = vec3(float(x), float(y), float(z)).add(.5).div(NOISE);
      // R: cumulus-like billows dilated by gradient noise (connected, swelling lobes); G, B: finer billows; A: gradient noise.
      const cells = billow(p, 4, 1).mul(.625).add(billow(p, 8, 2).mul(.25)).add(billow(p, 16, 3).mul(.125));
      const perlin = gradient(p, 4, 4).add(gradient(p, 8, 5).mul(.5)).mul(.5).add(.5).clamp(0, 1);
      const shape = cells.add(perlin.mul(cells.oneMinus())).sub(.45).div(.5).clamp(0, 1);
      textureStore(noise, uvec3(x, y, z), vec4(shape, billow(p, 8, 6), billow(p, 16, 7), gradient(p, 4, 8).mul(.5).add(.5).clamp(0, 1)));
    })().compute(NOISE * NOISE * NOISE, [64]);
    renderer.compute(fill);

    const lobes = uniformArray<'vec4'>(gasLobes(), 'vec4');
    const volume = texture3D(noise);
    const read = (q: Vec3) => volume.sample(q).level(float(0));
    /** (density, temperature) at `p` in the unit sphere of puff `variant`; `fine` adds the smallest billows. */
    const gas = Fn(([p, variant, fine]: [Vec3, Int, Float]) => {
      // Signed distance to the smoothly joined lobes: negative inside.
      const surface = float(4).toVar();
      Loop(LOBES, ({ i }) => {
        const lobe = lobes.element(variant.mul(LOBES).add(i));
        const d = length(p.sub(lobe.xyz)).sub(lobe.w);
        const h = max(float(.14).sub(d.sub(surface).abs()), 0).div(.14);
        surface.assign(min(surface, d).sub(h.mul(h).mul(.035)));
      });
      const offset = vec3(float(variant).mul(.3719), float(variant).mul(.6173), float(variant).mul(.1301)).fract();
      const q = p.mul(.42).add(offset).toVar();
      const n = read(q).toVar();
      // Billows swell the lobes into cauliflower; finer ones crowd their rims.
      const shape = surface.negate().add(n.r.sub(.5).mul(.34)).add(n.g.sub(.47).mul(.17)).add(n.b.sub(.47).mul(.1)).toVar();
      If(fine.greaterThan(.5), () => {
        const small = read(q.mul(2.1).add(.37));
        shape.addAssign(small.b.sub(.47).mul(.08).add(small.g.sub(.47).mul(.05)));
      });
      const density = smoothstep(0, .06, shape).mul(mix(float(.5), float(1), n.b)).mul(float(1).sub(smoothstep(.93, 1, length(p))));
      // Hottest deep inside and in cells that burn on while the gas around them has cooled to smoke.
      const temperature = surface.negate().mul(1.3).add(n.g.sub(.45).mul(.9)).add(n.a.sub(.5).mul(.4)).add(.25).clamp(0, 1);
      return vec2(density, temperature);
    }).setLayout({ name: 'gasPuff', type: 'vec2', inputs: [{ name: 'p', type: 'vec3' }, { name: 'variant', type: 'int' }, { name: 'fine', type: 'float' }] }) as unknown as (p: Vec3, variant: Int, fine: Float) => Vec2;

    /** Light reaching `p` from along `toward`: single scattering plus a softer share for light scattered on the way. */
    const lit = Fn(([p, toward, variant]: [Vec3, Vec3, Int]) => {
      const depth = float(0).toVar();
      let travelled = 0;
      for (const step of LIGHT_STEPS) {
        const at = p.add(toward.mul(travelled + step / 2));
        depth.addAssign(gas(at, variant, float(0)).x.mul(step));
        travelled += step;
      }
      const tau = depth.mul(SIGMA);
      return exp(tau.negate()).mul(.8).add(exp(tau.mul(-.25)).mul(.2));
    }).setLayout({ name: 'gasLight', type: 'float', inputs: [{ name: 'p', type: 'vec3' }, { name: 'toward', type: 'vec3' }, { name: 'variant', type: 'int' }] }) as unknown as (p: Vec3, toward: Vec3, variant: Int) => Float;

    // One row of puffs per submission: the whole atlas in one dispatch would hold a slow GPU for too long.
    const row = uniform(0, 'int');
    const bake = Fn(() => {
      const i = int(instanceIndex).add(row.mul(GAS_ATLAS * GAS_TILE));
      const texel = ivec2(i.mod(GAS_ATLAS), i.div(GAS_ATLAS));
      const tile = texel.div(GAS_TILE);
      const variant = tile.y.mul(GAS_GRID).add(tile.x);
      // Tile texels to the puff's unit disc, +Y up; the eye looks along −Z.
      const xy = vec2(texel.sub(tile.mul(GAS_TILE))).add(.5).div(GAS_TILE).mul(2).sub(1).toVar();
      const r2 = dot(xy, xy);
      const sides = vec4(0).toVar(), body = vec4(0).toVar();
      If(r2.lessThan(.999), () => {
        const half = sqrt(float(1).sub(r2)), stride = half.mul(2).div(VIEW_STEPS).toVar();
        const transmittance = float(1).toVar(), light = vec4(0).toVar(), frontBack = vec2(0).toVar();
        const heat = float(0).toVar(), heatWeight = float(0).toVar();
        const depth = float(0).toVar();
        Loop(VIEW_STEPS, ({ i: step }) => {
          const p = vec3(xy, half.sub(stride.mul(float(step).add(.5)))).toVar();
          const sample = gas(p, variant, float(1)).toVar();
          If(sample.x.greaterThan(.002), () => {
            const tau = sample.x.mul(SIGMA).mul(stride).toVar();
            // Light matters only while the eye still sees this deep; the optical depth adds up through the whole puff.
            If(transmittance.greaterThan(.003), () => {
              const alpha = float(1).sub(exp(tau.negate())).toVar();
              const weight = alpha.mul(transmittance).toVar();
              light.addAssign(vec4(lit(p, vec3(1, 0, 0), variant), lit(p, vec3(-1, 0, 0), variant), lit(p, vec3(0, 1, 0), variant),
                lit(p, vec3(0, -1, 0), variant)).mul(weight));
              // Light from the viewer's side reaches this gas through what the eye looks through.
              frontBack.addAssign(vec2(transmittance, lit(p, vec3(0, 0, -1), variant)).mul(weight));
              // Hot gas shows through thin soot: weigh what lies deeper a little more than its light.
              const seen = alpha.mul(pow(transmittance, .4));
              heat.addAssign(sample.y.mul(seen)); heatWeight.addAssign(seen);
            });
            depth.addAssign(tau);
            transmittance.mulAssign(exp(tau.negate()));
          });
        });
        const opacity = transmittance.oneMinus(), inverse = float(1).div(opacity.max(1e-4));
        sides.assign(light.mul(inverse).clamp(0, 1));
        body.assign(vec4(frontBack.x.mul(inverse), frontBack.y.mul(inverse).mul(.5), depth.div(GAS_DEPTH), heat.div(heatWeight.max(1e-4))).clamp(0, 1));
      });
      textureStore(this.sides, uvec2(texel), sides);
      textureStore(this.body, uvec2(texel), body);
    })().compute(GAS_ATLAS * GAS_TILE, [64]);
    for (let r = 0; r < GAS_GRID; r++) { row.value = r; renderer.compute(bake); }

    // Small billows at three octaves, with their surface normal from central differences.
    const height = (p: Vec2) => billow2(p, 6, 21).mul(.5).add(billow2(p, 12, 22).mul(.32)).add(billow2(p, 24, 23).mul(.18));
    const detail = Fn(() => {
      const x = instanceIndex.mod(DETAIL), y = instanceIndex.div(DETAIL);
      const p = vec2(float(x), float(y)).add(.5).div(DETAIL).toVar();
      const e = 1 / DETAIL;
      const dx = height(p.add(vec2(e, 0))).sub(height(p.sub(vec2(e, 0))));
      const dy = height(p.add(vec2(0, e))).sub(height(p.sub(vec2(0, e))));
      const normal = normalize(vec3(dx.mul(-8), dy.mul(-8), 1));
      textureStore(this.detail, uvec2(x, y), vec4(normal.xy.mul(.5).add(.5), height(p), billow2(p, 3, 24)).clamp(0, 1));
    })().compute(DETAIL * DETAIL, [64]);
    renderer.compute(detail);
    // The noise volume and kernels only served the bake.
    fill.dispose(); bake.dispose(); detail.dispose(); noise.dispose();
  }

  dispose(): void { this.sides.dispose(); this.body.dispose(); this.detail.dispose(); }
}

/** Per-puff inputs of the gas sprite material, as `EffectParticlePool` publishes them for its volume batches. */
export interface GasPuffAttributes {
  /** Centre and radius (m). */
  sphere: Vec4;
  /** Age (s), seed, heat (0 cold … above 1 white-hot), density (extinction multiple). */
  state: Vec4;
  /** Albedo and the major-to-minor ratio of an elongated puff. */
  tint: Vec4;
  /** Life fraction, dispersal (0 fresh … 1 gone), yaw and height of the elongation axis. */
  evolution: Vec4;
  opacity: Float;
  /** Firelight from below (a burning deck under its own smoke), in the flash colour; none by default. */
  glow?: Float;
}

const volumeAttributes = (): GasPuffAttributes => ({
  sphere: attribute<'vec4'>('effectSphere', 'vec4'), state: attribute<'vec4'>('effectVolume', 'vec4'), tint: attribute<'vec4'>('effectTint', 'vec4'),
  evolution: attribute<'vec4'>('effectProgress', 'vec4'), opacity: attribute<'float'>('effectOpacity', 'float'),
});

/** Squared components of a unit direction on its six axes: the six-way weights, summing to one. */
function sixWay(direction: Vec3): { positive: Vec3; negative: Vec3 } {
  const positive = max(direction, vec3(0)), negative = max(direction.negate(), vec3(0));
  return { positive: positive.mul(positive), negative: negative.mul(negative) };
}

/** Scene light for gas sprites: the sun or moon and sky from `EffectLighting`, and up to four transient point sources
 * (xyz position, w power) that light nearby puffs from inside, such as a muzzle flash glowing through its own cloud. */
export interface GasIllumination {
  lighting: EffectLighting;
  flashes?: readonly THREE.Node<'vec4'>[];
  /** Colour of flash and fire light on the gas. */
  flashColor?: THREE.Node<'vec3'>;
  /** Fade puffs into the decks, hulls and sea they meet (a read of the scene's depth per pixel). On by default. */
  soft?: boolean;
}

/** Gas puffs for `EffectParticlePool` volume batches: camera-facing sprites that relight a baked puff of the atlas.
 *
 * Every puff draws its own tile (picked by its seed), turned by a seeded angle that drifts as it ages, and squeezed across
 * the projected axis of an elongated puff. The sun and flashes light it through the six baked directions; the sky lights
 * it mostly from above. Hot gas is sooty and glows where the bake saw the hottest gas: as a fireball cools, the gas that
 * still burns shrinks to its hottest cells, so fire breaks up into patches deep in its own smoke before it goes out.
 * Thinning with dispersal lowers the puff's optical depth, and its thinnest rim goes first.
 *
 * Close up, the tiling detail map erodes the thin rim into small billows and shades their folds; it fades out as the puff
 * shrinks on screen, where it would only shimmer. */
export function gasSpriteMaterial(atlas: GasAtlas, { lighting, flashes = [], flashColor = vec3(1, .62, .3), soft = true }: GasIllumination,
  inputs: GasPuffAttributes = volumeAttributes()): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  material.name = 'Gas puffs';
  // Everything per puff is worked out per vertex and handed on in a few packed varyings: WebGPU passes at most sixteen,
  // and an instance attribute read in the fragment stage would take one each.
  const { sphere, state, tint, evolution, opacity } = inputs;
  const center = sphere.xyz, radius = sphere.w.max(.01);
  // The pool's quad frame: turned toward the camera about the world's up, as Matrix4.lookAt builds it.
  const toCamera = normalize(cameraPosition.sub(center));
  const across = cross(vec3(0, 1, 0), toCamera), right = select(length(across).lessThan(1e-4), vec3(1, 0, 0), normalize(across));
  const up = cross(toCamera, right);
  // A seeded turn that keeps rolling slowly with age, so neighbouring puffs never repeat.
  const seed = state.y, turn = seed.mul(2.39996).add(state.x.mul(fract(seed.mul(.7137)).sub(.5).mul(.36)));
  const cosine = cos(turn), sine = sin(turn);
  const rotateBy = (c: Float, s: Float, v: Vec2) => vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)));
  // The elongation axis on screen; seen end-on the puff is round.
  const flat = float(1).sub(evolution.w.mul(evolution.w)).max(0).sqrt();
  const axis = vec3(cos(evolution.z).mul(flat), evolution.w, sin(evolution.z).mul(flat));
  const projected = vec2(dot(axis, right), dot(axis, up)), reach = length(projected);
  const along = select(reach.lessThan(1e-3), vec2(1, 0), projected.div(reach.max(1e-3)));
  const squeeze = mix(float(1), tint.w.max(1), reach.clamp(0, 1));
  // Sun and flash light in the tile's frame: its x and y turn with the puff, z faces the viewer.
  const inTile = (direction: Vec3) => vec3(rotateBy(cosine, sine, vec2(dot(direction, right), dot(direction, up))), dot(direction, toCamera));
  const sun = sixWay(normalize(inTile(lighting.sunDirection)));
  let flashPositive: Vec3 = vec3(0), flashNegative: Vec3 = vec3(0);
  for (const flash of flashes) {
    const offset = flash.xyz.sub(center), power = flash.w.div(dot(offset, offset).add(radius.mul(radius)).add(16));
    const weights = sixWay(normalize(inTile(offset.add(vec3(0, 1e-3, 0)))));
    flashPositive = flashPositive.add(weights.positive.mul(power)); flashNegative = flashNegative.add(weights.negative.mul(power));
  }
  if (inputs.glow) {
    const below = sixWay(normalize(inTile(vec3(0, -1, 0))));
    flashPositive = flashPositive.add(below.positive.mul(inputs.glow)); flashNegative = flashNegative.add(below.negative.mul(inputs.glow));
  }
  flashPositive = flashPositive.min(vec3(2.5)); flashNegative = flashNegative.min(vec3(2.5));
  const variant = fract(seed.mul(.61803)).mul(GAS_VARIANTS).floor();
  // A puff around the camera would fill the view with one flat layer: clear it as the lens enters.
  const distance = length(cameraPosition.sub(center));
  const near = smoothstep(radius.mul(.8), radius.mul(1.9), distance);
  // Small billows only where the puff is large enough on screen to show them (radius in pixels, binoculars included).
  const pixels = screenSize.y.mul(.5).mul(cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y).mul(radius).div(distance.max(radius));
  const sunInTile = inTile(lighting.sunDirection);
  const detailed = varying(vec4(normalize(sunInTile.xy.add(vec2(0, 1e-4))).mul(length(sunInTile.xy).min(1)), smoothstep(28, 120, pixels),
    fract(seed.mul(.3779))), 'gasDetail');
  const frame = varying(vec4(cosine, sine, along), 'gasFrame');
  const place = varying(vec4(variant.mod(GAS_GRID), variant.div(GAS_GRID).floor(), squeeze, radius.mul(.35).max(.6)), 'gasPlace');
  const look = varying(vec4(tint.rgb, opacity.mul(near)), 'gasLook');
  // Heat, extinction multiple as it thins, dispersal, age.
  const gasState = varying(vec4(state.z, state.w.div(3).mul(float(1).sub(evolution.y.mul(.8))), evolution.y, state.x), 'gasState');
  const quad = varying(positionGeometry.xy.mul(2), 'gasQuad');
  const sunLight = varying(vec4(sun.positive, sun.negative.x), 'gasSun');
  const mixed = varying(vec4(sun.negative.yz, flashPositive.xy), 'gasSunFlash');
  const flashLight = varying(vec4(flashPositive.z, flashNegative), 'gasFlash');

  const shade = Fn(() => {
    // The plane's own corners (±½) give the quad coordinate: no texture-coordinate buffer, one vertex buffer fewer.
    const q = quad, axisOnScreen = frame.zw, squeezed = place.z;
    // Squeeze across the axis, then turn into the tile.
    const onAxis = dot(q, axisOnScreen), off = q.x.mul(axisOnScreen.y.negate()).add(q.y.mul(axisOnScreen.x)).mul(squeezed);
    const s = rotateBy(frame.x, frame.y, vec2(axisOnScreen.x.mul(onAxis).sub(axisOnScreen.y.mul(off)), axisOnScreen.y.mul(onAxis).add(axisOnScreen.x.mul(off)))).toVar();
    const inside = float(1).sub(smoothstep(.96, 1, length(s)));
    const coord = place.xy.add(s.mul(.5).add(.5)).div(GAS_GRID);
    const sides = texture(atlas.sides, coord), body = texture(atlas.body, coord);
    // Small billows in the tile's frame, a seeded patch of the tiling map that rolls slowly as the puff ages.
    const strength = detailed.z, age = gasState.w;
    const small = texture(atlas.detail, s.mul(.55).add(vec2(detailed.w, fract(detailed.w.mul(7.3)))).add(vec2(age.mul(.008), age.mul(-.014))));
    const bump = small.rg.mul(2).sub(1), height = small.b.sub(.5).mul(strength);
    // Thinner as it disperses: optical depth falls everywhere, and the thin rim tears away first.
    const heatScale = gasState.x, thickness = gasState.y, dispersal = gasState.z, depth = body.b.mul(GAS_DEPTH);
    const torn = mix(float(1), smoothstep(dispersal.mul(1.6), dispersal.mul(1.6).add(.9), depth), smoothstep(0, .3, dispersal));
    const solid = float(1).sub(exp(depth.mul(thickness).negate()));
    // The thin rim breaks into the small billows: where the gas is thin, only their crowns remain.
    const crowns = smoothstep(float(.5).sub(small.b.mul(.45)), float(.8).sub(small.b.mul(.45)), solid);
    const coverage = solid.mul(mix(float(1), crowns, strength.mul(.85))).mul(torn).mul(inside);
    const sunPositive = sunLight.xyz, sunNegative = vec3(sunLight.w, mixed.xy);
    const flashPositive = vec3(mixed.zw, flashLight.x), flashNegative = flashLight.yzw;
    // Their faces toward the light catch more of it, and the folds between them hold shadow and less sky.
    const relief = float(1).add(dot(bump, detailed.xy).mul(.8).add(height.mul(.8)).mul(strength));
    const direct = sides.r.mul(sunPositive.x).add(sides.g.mul(sunNegative.x)).add(sides.b.mul(sunPositive.y)).add(sides.a.mul(sunNegative.y))
      .add(body.r.mul(sunPositive.z).mul(.85)).add(body.g.mul(sunNegative.z).mul(2 * 1.6)).mul(relief);
    const flashLit = sides.r.mul(flashPositive.x).add(sides.g.mul(flashNegative.x)).add(sides.b.mul(flashPositive.y)).add(sides.a.mul(flashNegative.y))
      .add(body.r.mul(flashPositive.z)).add(body.g.mul(flashNegative.z).mul(2));
    // Sky light arrives mostly from above; the sea returns a little from below.
    const sky = sides.b.mul(.5).add(sides.r.add(sides.g).add(body.r).add(body.g.mul(2)).mul(.11)).add(sides.a.mul(.06))
      .mul(float(1).add(height.mul(.7)));
    // Burning gas is dark soot lit by its own fire. While the puff is fresh all of it burns, white-hot; as it cools, only gas
    // hotter than a rising threshold still does, so the fire shrinks into its hottest cells and breaks up inside the smoke.
    const temperature = body.a.add(height.mul(.5)).toVar();
    // Even at its hottest the coolest gas at the rim is already smoke, so a fresh fireball is torn by dark patches.
    const threshold = float(1).sub(heatScale.mul(.38)).clamp(.1, .96);
    const burning = smoothstep(threshold.sub(.05), threshold.add(.2), temperature);
    // White where the burning gas is thick and hot, yellow, then orange where it thins at the rim.
    const heat = burning.mul(heatScale.min(1.7)).mul(solid.mul(.45).add(temperature.mul(.5)).add(.25)).toVar();
    // Saturated orange through most of the flame: only the hottest gas runs to white, which the display would otherwise
    // wash every bright orange toward.
    const ember = mix(vec3(.45, .03, .004), vec3(2.4, .45, .04), smoothstep(.12, .55, heat));
    const flame = mix(ember, vec3(4.2, 1.55, .3), smoothstep(.55, 1, heat));
    const emission = flame.mul(heat.mul(heat)).add(vec3(3.5, 2.8, 1.5).mul(smoothstep(1.25, 1.6, heat)));
    const albedo = look.rgb.mul(float(1).sub(burning.mul(heatScale.min(1)).mul(.85)));
    const radiance = albedo.mul(lighting.direct.mul(direct).add(lighting.ambient.mul(sky).mul(1.7)).add(flashColor.mul(flashLit))).add(emission);
    return vec4(radiance, coverage);
  })();
  material.colorNode = vec4(shade.rgb, 1);
  material.opacityNode = soft ? shade.a.mul(look.a).mul(lighting.softEdge(place.w)) : shade.a.mul(look.a);
  return material;
}

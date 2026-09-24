import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, clamp, cross, dot, float, max, normalize, positionWorld, pow, select, smoothstep, sqrt, texture, uv, vec2, vec4 } from 'three/tsl';
import type { EffectLighting } from './EffectLighting';
import { quadAxes, smokeBillowTexture } from './SmokeSpriteMaterial';

/** Lit white water: the streaked jets of a shell splash (`WaterPlumes`) and the billowing spray around its base.
 *
 * Spray is a cloud of drops and entrained air, so it scatters far more light than smoke: the sunlit face goes
 * white, the shaded side stays a light blue-grey from the sky, and thin spray seen toward the sun glows. Both
 * read the shared `EffectLighting`, so splashes follow the time of day, weather and moonlight like the smoke. */

/** Sky light reaching spray, relative to smoke: multiple scattering between drops fills the shade. */
const SKY_GAIN = 2.2;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp01(n); return t * t * (3 - 2 * t); };
/** Integer lattice hash (sine hashes correlate along rows and band the noise). */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Value noise with its own number of cells across (`cellsU`) and along (`cellsV`) the unit square, so it tiles. */
function noise(u: number, v: number, cellsU: number, cellsV: number, seed: number): number {
  const x = u * cellsU, y = v * cellsV, ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const at = (cx: number, cy: number) => hash(((cx % cellsU) + cellsU) % cellsU, ((cy % cellsV) + cellsV) % cellsV, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
}

/** Original tileable streak field for spray jets; u runs across a jet and v along its flight.
 * R: fine streaks drawn out along the flight, many times longer than wide. G: coarse clumps that rag the
 * jet's edges and decide where it tears first. B: drops, which the tip breaks into. Deterministic, no downloads. */
export function sprayStreakTexture(width = 128, height = 128): THREE.DataTexture {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    const fine = noise(u, v, 18, 2, 1) * .5 + noise(u, v, 36, 4, 2) * .32 + noise(u, v, 72, 6, 3) * .18;
    const coarse = noise(u, v, 5, 2, 4) * .62 + noise(u, v, 11, 3, 5) * .38;
    const i = (y * width + x) * 4;
    // Averaged octaves crowd around one half; stretch them back out to clear gaps and dense strands.
    pixels[i] = Math.round(smooth((fine - .28) / .44) * 255);
    pixels[i + 1] = Math.round(smooth((coarse - .25) / .5) * 255);
    pixels[i + 2] = Math.round(smooth((noise(u, v, 20, 28, 6) - .2) / .6) * 255);
    pixels[i + 3] = 255;
  }
  const map = new THREE.DataTexture(pixels, width, height);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // Jets are long and narrow on screen; anisotropic sampling keeps their streaks from blurring into a wash.
  map.anisotropy = 8;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  return map;
}

/** Radiance scattered by white spray with unit albedo, for world normal `n` seen along `toCamera`.
 * `sunlit` (0–1) is the share of sunlight the rest of the column lets through, `sky` (0–1) the share of sky
 * light, and `thin` (0–1) how sparse the spray is: sparse spray seen toward the sun glows. */
export function sprayRadiance(lighting: EffectLighting, n: THREE.Node<'vec3'>, toCamera: THREE.Node<'vec3'>,
  sunlit: THREE.Node<'float'>, sky: THREE.Node<'float'>, thin: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const sun = normalize(lighting.sunDirection);
  // Drops scatter light well past the terminator: wrap the sunlit face around the side.
  const diffuse = clamp(dot(n, sun).add(.5).div(1.5), 0, 1);
  const toward = clamp(dot(toCamera.negate(), sun), 0, 1);
  const glow = pow(toward, float(4)).mul(thin.mul(thin).mul(1.6).add(.08)).mul(sunlit.mul(.6).add(.4));
  // Thick water keeps less of the sky than a thin veil: a column seen against the sun stays grey at its core.
  const fill = lighting.ambient.mul(SKY_GAIN).mul(sky).mul(thin.mul(.4).add(.6)).mul(float(.82).add(n.y.mul(.18)));
  return fill.add(lighting.direct.mul(diffuse.mul(sunlit).add(glow)));
}

/** Material for `WaterPlumes` jets: camera-facing strips shaded as round, streaked columns of spray.
 * Per vertex, `jetSide` holds the strip's unit side vector and a texture seed; `jetState` its opacity, the
 * tear threshold that rises as the jet breaks up, the sunlight the column lets through and the sky light. */
export function sprayJetMaterial(lighting: EffectLighting, map: THREE.Texture = sprayStreakTexture()): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  const frame = attribute<'vec4'>('jetSide', 'vec4'), state = attribute<'vec4'>('jetState', 'vec4');
  const coord = uv(), across = coord.x.mul(2).sub(1);
  // Streaks are anchored to the water: v is the share of the launch speed, so they travel with the jet.
  const streaks = texture(map, vec2(coord.x.mul(.8).add(frame.w), coord.y.mul(2.4).add(frame.w.mul(1.618))));
  const rag = streaks.g.sub(.5).mul(.6);
  const edge = float(1).sub(smoothstep(float(.42).add(rag), float(1).add(rag.mul(.2)), across.abs()));
  const bulge = sqrt(max(float(0), float(1).sub(across.mul(across))));
  // Toward its tip the jet breaks into separate drops.
  const drops = smoothstep(.35, .75, streaks.b).mul(smoothstep(.5, 1, coord.y)).mul(.85);
  const density = edge.mul(streaks.r.mul(.38).add(.62)).mul(float(1).sub(smoothstep(.45, .95, coord.y).mul(.85)).add(drops).min(1));
  // Aerated water tears where its strands are thinnest, and the coarse clumps go last.
  const tear = smoothstep(state.y.sub(.13), state.y.add(.13), streaks.r.mul(.62).add(streaks.g.mul(.38)).add(bulge.mul(.14)));
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  // Round the flat strip into a column: its normal turns from the side vector toward the camera.
  const normal = normalize(frame.xyz.mul(across).add(toCamera.mul(bulge.max(.2))));
  const albedo = vec4(.93, .96, 1, 1);
  // Dense strands scatter a little more light than the thin water between them.
  material.colorNode = vec4(sprayRadiance(lighting, normal, toCamera, state.z, state.w, float(1).sub(density)).mul(streaks.r.mul(.24).add(.8)), 1).mul(albedo);
  material.opacityNode = density.mul(tear).mul(state.x);
  return material;
}

/** Turn a sprite batch's material (an `EffectParticlePool` mesh) into lit billows of white spray: the dense,
 * lumpy mass around a splash's base and the wall of spray it rolls out across the sea. Albedo comes from the
 * particle colour; spray meets the sea softly instead of cutting it with a line. */
export function applySpraySprite(material: THREE.MeshBasicNodeMaterial, lighting: EffectLighting,
  map: THREE.Texture = smokeBillowTexture()): THREE.MeshBasicNodeMaterial {
  const sample = texture(map, uv());
  const qx = sample.r.mul(2).sub(1), qy = sample.g.mul(2).sub(1);
  const qz = sqrt(max(float(0), float(1).sub(qx.mul(qx)).sub(qy.mul(qy))));
  const { across, up } = quadAxes();
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const facing = normalize(cross(across, up));
  const front = select(dot(facing, toCamera).lessThan(0), facing.negate(), facing);
  const normal = normalize(normalize(across).mul(qx).add(normalize(up).mul(qy)).add(front.mul(qz)));
  const density = sample.a;
  // The billow's thick core keeps less sky light than its thin rim.
  const sky = float(1).sub(sample.b.mul(.22));
  material.colorNode = vec4(sprayRadiance(lighting, normal, toCamera, float(1), sky, float(1).sub(density)), 1);
  material.opacityNode = attribute<'float'>('effectOpacity', 'float').mul(density).mul(smoothstep(-1, 2.5, positionWorld.y));
  material.map = null;
  material.needsUpdate = true;
  return material;
}

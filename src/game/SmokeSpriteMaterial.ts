import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, clamp, cross, dFdx, dFdy, dot, exp, float, length, max, mix, normalize, positionWorld, pow, select, smoothstep, sqrt, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { EffectLighting } from './EffectLighting';

/** Lit, soft-edged smoke for camera-facing sprites and plume ribbons.
 *
 * Shading reads the shared `EffectLighting`: a wrapped sun term on a billow normal, sky fill that
 * is stronger on upward faces, and forward scattering that brightens thin edges when looking toward
 * the sun. Opacity fades where the smoke meets opaque geometry (soft particles). Albedo comes from
 * the instance or vertex colour, so one material serves light haze, working exhaust and soot.
 *
 * Reusable: `applySmokeSprite(pool.mesh.material, lighting)` turns any `EffectParticlePool` batch into
 * lit billows (the pool's per-particle opacity, spin, stretch and colour still apply). */

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp01(n); return t * t * (3 - 2 * t); };
/** Integer lattice hash (no sine: sine hashes correlate along rows and band the noise). */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Periodic value noise: `period` cells across the unit square, so textures tile. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const px = x * period, py = y * period, ix = Math.floor(px), iy = Math.floor(py);
  const fx = smooth(px - ix), fy = smooth(py - iy);
  const at = (cx: number, cy: number) => hash(((cx % period) + period) % period, ((cy % period) + period) % period, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
}
const fbm = (x: number, y: number, seed: number, base = 4) =>
  periodicNoise(x, y, base, seed) * .52 + periodicNoise(x, y, base * 2, seed + 1) * .29 + periodicNoise(x, y, base * 4, seed + 2) * .14 + periodicNoise(x, y, base * 8, seed + 3) * .05;

/** One original cauliflower billow: a union of domed lobes with fine erosion. RGB holds the billow's
 * surface normal in quad space (xy) and its thickness; alpha holds density. Deterministic, no downloads. */
export function smokeBillowTexture(size = 128): THREE.DataTexture {
  // Soft-union lobes of mixed sizes make a lumpy mound; turbulence erodes its rim into wisps.
  const lobes = [[0, -.04, .46], [-.3, .1, .3], [.29, .12, .32], [-.08, .36, .27], [.2, .34, .22], [-.32, -.26, .24], [.33, -.22, .26], [.04, .12, .38], [-.02, -.38, .2]];
  const heights = new Float32Array(size * size), alphas = new Float32Array(size * size), pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    let sum = 0;
    for (const [cx, cy, r] of lobes) sum += Math.exp(-((u - cx) ** 2 + (v - cy) ** 2) / (r * r) * 2.2) * r;
    const coarse = fbm((x + .5) / size, (y + .5) / size, 5, 3) - .5, fine = fbm((x + .5) / size, (y + .5) / size, 17, 8) - .5;
    const edge = 1 - Math.min(1, Math.hypot(u, v));
    const h = Math.max(0, sum + coarse * .16 + fine * .06) * smooth(edge * 3.5);
    heights[y * size + x] = h;
    alphas[y * size + x] = smooth((h - .04) / .26) * (.82 + fine * .5);
  }
  const at = (x: number, y: number) => heights[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  // Gentle relief: billows read as soft, rounded masses rather than hard spheres.
  const scale = size / 2 * .55;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = at(x, y);
    const dx = (at(x + 1, y) - at(x - 1, y)) * scale / 2, dy = (at(x, y + 1) - at(x, y - 1)) * scale / 2;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    pixels[i] = Math.round((-dx * inv * .5 + .5) * 255);
    pixels[i + 1] = Math.round((-dy * inv * .5 + .5) * 255);
    pixels[i + 2] = Math.round(clamp01(h / .55) * 255);
    pixels[i + 3] = Math.round(clamp01(alphas[y * size + x]) * 255);
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  return map;
}

/** Tileable turbulence for ribbons: R and G are two independent fbm fields. */
export function smokeNoiseTexture(size = 128): THREE.DataTexture {
  const field = new Float32Array(size * size), pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) field[y * size + x] = fbm(x / size, y / size, 11);
  const at = (x: number, y: number) => field[y * size + x];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    pixels[i] = Math.round(clamp01(at(x, y)) * 255);
    pixels[i + 1] = Math.round(clamp01(fbm(x / size, y / size, 29, 2)) * 255);
    pixels[i + 2] = pixels[i]; pixels[i + 3] = 255;
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // Ribbons are often seen obliquely; anisotropic sampling keeps the turbulence from smearing.
  map.anisotropy = 8;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  return map;
}

/** Radiance scattered by smoke with unit albedo, for a world normal `n` and view vector `toCamera`.
 * `density` (0–1) thins the forward-scattered rim; `thickness` (0–1) darkens the sky fill in the core. */
export function smokeRadiance(lighting: EffectLighting, n: THREE.Node<'vec3'>, toCamera: THREE.Node<'vec3'>,
  density: THREE.Node<'float'>, thickness: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const sun = normalize(lighting.sunDirection);
  // Smoke scatters broadly: wrap the terminator well past 90°, and keep the shaded side lifted.
  const diffuse = clamp(dot(n, sun).add(.6).div(1.6), 0, 1);
  const lit = diffuse.mul(.8).add(.2);
  // Looking toward the light: thin edges glow (silver lining), dense cores stay dark.
  const toward = clamp(dot(toCamera.negate(), sun), 0, 1);
  const rim = pow(toward, float(6)).mul(float(1).sub(density)).mul(1.4).add(pow(toward, float(2)).mul(.18));
  const sky = lighting.ambient.mul(float(.72).add(n.y.mul(.28))).mul(mix(float(1), float(.72), thickness));
  return sky.add(lighting.direct.mul(lit.add(rim)));
}

/** Quad frame from screen derivatives: exact for any planar, affinely mapped quad (spin and stretch
 * included), so billboards need no extra per-instance attributes. Returns the world axes of +u, +v. */
export function quadAxes() {
  const p = positionWorld, t = uv();
  const dpx = dFdx(p), dpy = dFdy(p), dtx = dFdx(t), dty = dFdy(t);
  const raw = dtx.x.mul(dty.y).sub(dtx.y.mul(dty.x));
  const det = select(raw.abs().lessThan(1e-12), float(1e-12), raw);
  const across = dpx.mul(dty.y).sub(dpy.mul(dtx.y)).div(det);
  const up = dpy.mul(dtx.x).sub(dpx.mul(dty.x)).div(det);
  return { across, up };
}

/** Turn a sprite batch's material (e.g. an `EffectParticlePool` mesh) into lit billows.
 * `softness` (a fraction of the billow radius) fades billows into opaque surfaces by reading the
 * shared scene depth. Off by default: every pass that draws a depth-reading material copies the
 * depth buffer, which splits the render pass. Worth it for smoke that meets decks and hulls; not
 * for always-present exhaust above the funnels. */
export function applySmokeSprite(material: THREE.MeshBasicNodeMaterial, lighting: EffectLighting,
  map = smokeBillowTexture(), softness = 0): THREE.MeshBasicNodeMaterial {
  const sample = texture(map, uv());
  const qx = sample.r.mul(2).sub(1), qy = sample.g.mul(2).sub(1);
  const qz = sqrt(max(float(0), float(1).sub(qx.mul(qx)).sub(qy.mul(qy))));
  const { across, up } = quadAxes();
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const facing = normalize(cross(across, up));
  const front = select(dot(facing, toCamera).lessThan(0), facing.negate(), facing);
  const normal = normalize(normalize(across).mul(qx).add(normalize(up).mul(qy)).add(front.mul(qz)));
  const density = sample.a;
  const radius = length(across).mul(.5);
  material.colorNode = vec4(smokeRadiance(lighting, normal, toCamera, density, sample.b), 1);
  const opacity = attribute<'float'>('effectOpacity', 'float').mul(density).mul(smoothstep(0, 4, positionWorld.y));
  material.opacityNode = softness > 0 ? opacity.mul(lighting.softEdge(radius.mul(softness).max(.5))) : opacity;
  material.map = null;
  material.needsUpdate = true;
  return material;
}

/** Metres of plume per turn of the ribbon turbulence along its length: about the scale across a
 * plume half a minute old. */
const ALONG_SCALE_M = 45;

/** Material for plume ribbons written by `SmokeRibbons`: a lit, turbulent tube cross-section.
 * `soft` fades the ribbon into opaque surfaces through the scene depth (see `applySmokeSprite`). */
export function smokeRibbonMaterial(lighting: EffectLighting, noise = smokeNoiseTexture(), soft = false): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  const sideVector = attribute<'vec3'>('plumeSide', 'vec3'), facing = length(sideVector);
  const side = sideVector.div(facing.max(.05));
  // A receding plume integrates its turbulence over depth: flatten the 2D noise there, or it
  // streaks across the strip as foreshortened bands.
  const contrast = smoothstep(.2, .85, facing);
  const data = attribute<'vec4'>('plumeData', 'vec4'); // across −1…1, along (m), age (s), width (m)
  const tint = attribute<'vec4'>('plumeTint', 'vec4'); // albedo, opacity
  const spent = attribute<'float'>('plumeSpent', 'float'); // fraction of the sample's life
  const across = data.x, width = data.w.max(.5);
  // Coordinates are anchored to the released smoke. Across, feature size follows the plume's width.
  // Along, it is fixed: the release distance grows for as long as the funnel smokes, and dividing it
  // by a width that changes along the strip squeezed the turbulence into ever finer stripes.
  const scale = width.mul(1.1).add(10);
  const coarse = vec2(across.mul(width).mul(.5).div(scale), data.y.div(ALONG_SCALE_M));
  const first = texture(noise, coarse.add(vec2(0, data.z.mul(-.004))));
  const fine = texture(noise, coarse.mul(2.7).add(vec2(data.z.mul(.011), data.z.mul(.007))));
  const turbulence = mix(float(.55), first.r.mul(.65).add(fine.g.mul(.35)), contrast);
  const profile = exp(across.mul(across).mul(-2.4));
  // Erode the rim more than the core, so edges break into wisps rather than fading as a band.
  // Old smoke dissolves into patches from the rim inward rather than fading as a sheet.
  const dissolve = smoothstep(.45, 1, spent).mul(.55);
  // Strong contrast: a plume is patchy, thicker in its billows and thin between them, never a tube.
  const density = clamp(profile.mul(turbulence.mul(1.6).add(.08)).sub(float(1).sub(profile).mul(.3)).sub(dissolve.mul(float(1.2).sub(turbulence))), 0, 1);
  const toCamera = normalize(cameraPosition.sub(positionWorld));
  const bulge = sqrt(max(float(0), float(1).sub(across.mul(across))));
  // Tube normal, tipped up where the turbulence is dense so billowed crowns catch the sun.
  const normal = normalize(side.mul(across).add(toCamera.mul(bulge)).add(vec3(0, turbulence.sub(.5).mul(contrast).mul(.8), 0)));
  material.colorNode = vec4(smokeRadiance(lighting, normal, toCamera, density, profile.mul(.8)).mul(tint.rgb), 1);
  // Smoke never hangs below the sea: the water does not occlude transparent effects under it.
  const aboveSea = smoothstep(0, 10, positionWorld.y);
  const opacity = density.mul(tint.a).mul(aboveSea);
  material.opacityNode = soft ? opacity.mul(lighting.softEdge(width.mul(.35).max(1))) : opacity;
  return material;
}

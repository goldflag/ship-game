import * as THREE from 'three/webgpu';
import { abs, attribute, cross, dFdx, dFdy, dot, faceDirection, float, materialRoughness, max, mix, normalGeometry, normalView, positionGeometry, positionView, pow, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Physically scaled surface detail for ship paint and teak, evaluated in each mesh's own
 * (pre-batching) geometry space, so it follows turrets and every other articulated owner.
 *
 * Nothing here is baked into the ship assets. Two small repeating textures are generated
 * once and read through shared nodes:
 * - plating: 2 m strakes, 8 m butts with staggered offsets, welded seams and slight
 *   dishing between frames as a height gradient, plus a low-frequency roughness field;
 * - teak: 16 cm planks with staggered 5 m butts, caulking, grain and relief.
 * Relief is applied as a surface gradient (Mikkelsen) from the per-pixel derivatives of
 * the geometry and view positions, so it needs no tangents and holds for batched,
 * instanced and mirrored meshes alike. Mipmaps average the gradients towards zero, so
 * the detail recedes with distance and the approved scheme reads unchanged. */

/** Paint classes that get plating. Canvas, glass, rope, dark recesses and metals do not. */
const PLATED_FINISHES = new Set(['painted-steel', 'painted-deck', 'underwater-coating']);
const PLATED_ROLES = new Set(['naval', 'hullgray', 'roof', 'underwater']);
/** Fittings share painted-steel with the hull but are single castings or small welded parts. */
const FITTING_PAINT = /-(edge|fittings|raft|light)$/;

export type ShipSurfaceMode = 'surface' | 'teak';

/** Whether a source material's paint is welded steel plate (per vertex, so materials that
 * share one palette entry keep their own class). */
export function isPlatedPaint(material: THREE.MeshStandardMaterial): boolean {
  if (material.metalness > .1 || material.userData.deckSubstrate === 'timber') return false;
  const { surfaceFinish, componentMaterialRole } = material.userData;
  if (typeof surfaceFinish === 'string') return PLATED_FINISHES.has(surfaceFinish) && !FITTING_PAINT.test(String(material.userData.paintId ?? ''));
  if (typeof componentMaterialRole === 'string') return PLATED_ROLES.has(componentMaterialRole);
  return material.name.startsWith('construction.');
}

const scale = new THREE.Vector3(), extent = new THREE.Vector3();
/** A mesh broad enough to be built from plates: at least two sides of two metres. Doors,
 * vents, barrels, masts and other small fittings stay plain. */
export function isPlateSized(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  geometry.boundingBox!.getSize(extent).multiply(mesh.getWorldScale(scale));
  return [extent.x, extent.y, extent.z].filter(side => Math.abs(side) >= 2).length >= 2;
}

/** Planked teak whose repeating texture carries no relief of its own: the exporter's baked
 * procedural teak and the construction timber finish. Declared decking with its own plank
 * relief and whole-deck images (recognition markings) keep their authored planks. */
export function shipSurfaceMode(material: THREE.MeshStandardMaterial): ShipSurfaceMode {
  const map = material.map;
  const timber = material.name.startsWith('Teak decking') || material.userData.deckSubstrate === 'timber';
  return timber && map && !material.normalMap && map.wrapS === THREE.RepeatWrapping && map.wrapT === THREE.RepeatWrapping ? 'teak' : 'surface';
}

// Plating tile: 16 m square, eight 2 m strakes, two 8 m plates per strake.
export const PLATE = { tile: 16, size: 1024, strake: 2, butt: 8, frame: 1, gradientScale: .25 } as const;
// Teak tile: 16 planks of 16 cm across, 20.48 m along with four 5.12 m butts per plank.
export const TEAK = { across: 2.56, along: 20.48, width: 512, length: 2048, plank: .16, butt: 5.12, gradientScale: .5 } as const;

const fract = (x: number) => x - Math.floor(x);
const hash = (a: number, b = 0, c = 0) => fract(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Periodic value noise on a square tile: `cells` lattice cells across the period. */
function tileNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const at = (i: number, j: number) => hash(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Pitch caulking darkens the board colour by this fraction at full coverage. */
const CAULK_DARKENING = .62;
/** Mean board colour without caulking over mean with it: the pattern's mean while caulking fades. */
let teakAlbedoRatio = 1.03;
const encode = (value: number, scale: number) => Math.max(0, Math.min(255, Math.round(127.5 + value / scale * 127.5)));

/** RGBA plating texels: R,G height gradient along u (length or beam) and v (height), per
 * metre of surface; B roughness field (0.5 neutral). Rows, columns and plates are tabulated
 * so the per-texel work stays small. */
export function plateTexels(size: number = PLATE.size): Uint8Array {
  const { tile, strake, butt, frame } = PLATE, texel = tile / size, plates = tile / butt;
  const height = new Float32Array(size * size), weld = .018, depth = .0045, reach = 3 * weld;
  const bay = new Float32Array(size);
  for (let x = 0; x < size; x++) bay[x] = Math.sin(Math.PI * (((x + .5) * texel) % frame) / frame);
  // Low-frequency roughness on a quarter-resolution lattice; it varies over metres.
  const low = size >> 2, field = new Float32Array(low * low);
  for (let y = 0; y < low; y++) for (let x = 0; x < low; x++) field[y * low + x] = .6 * tileNoise((x + .5) / low, (y + .5) / low, 4, 11) + .4 * tileNoise((x + .5) / low, (y + .5) / low, 12, 13);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y + .5) * texel, row = Math.floor(v / strake), across = v - row * strake, rowSin = Math.sin(Math.PI * across / strake);
    const offset = Math.round(hash(row, 3) * butt / frame) * frame, rim = Math.min(across, strake - across);
    const dish = Array.from({ length: plates }, (_, plate) => .002 + .003 * hash(row, plate, 7));
    const tint = Array.from({ length: plates }, (_, plate) => .22 * (hash(row, plate, 5) - .5));
    for (let x = 0; x < size; x++) {
      const run = (x + .5) * texel + offset, plate = Math.floor(run / butt) % plates, along = run % butt;
      const seam = Math.min(rim, along, butt - along);
      // Welded butts and seams: a shallow groove about two centimetres either side;
      // plates dish slightly between transverse frames and strake edges.
      height[y * size + x] = (seam < reach ? -depth * Math.exp(-((seam / weld) ** 2)) : 0) - dish[plate] * bay[x] * rowSin;
      pixels[(y * size + x) * 4 + 2] = Math.max(0, Math.min(255, Math.round((.5 + .7 * (field[(y >> 2) * low + (x >> 2)] - .5) + tint[plate]) * 255)));
    }
  }
  for (let y = 0; y < size; y++) {
    const up = ((y + 1) % size) * size, down = ((y + size - 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const right = (x + 1) % size, left = (x + size - 1) % size, i = (y * size + x) * 4;
      pixels[i] = encode((height[y * size + right] - height[y * size + left]) / (2 * texel), PLATE.gradientScale);
      pixels[i + 1] = encode((height[up + x] - height[down + x]) / (2 * texel), PLATE.gradientScale);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** RGBA teak texels, `width` across the beam by `length` along the ship: R albedo factor
 * (plank tone and grain, 0.5 = ×1), G caulking coverage, B,A height gradient across/along. */
export function teakTexels(width: number = TEAK.width, length: number = TEAK.length): Uint8Array {
  const { across: tileAcross, along: tileAlong, plank, butt } = TEAK, sx = tileAcross / width, sz = tileAlong / length;
  const planks = Math.round(tileAcross / plank), caulk = .004, groove = .0035, n = width * length;
  const height = new Float32Array(n), albedo = new Float32Array(n), seams = new Float32Array(n);
  const rowOf = new Int32Array(width), inPlankOf = new Float32Array(width), edgeOf = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const across = (x + .5) * sx, index = Math.floor(across / plank);
    rowOf[x] = index % planks; inPlankOf[x] = across - index * plank; edgeOf[x] = Math.min(inPlankOf[x], plank - inPlankOf[x]);
  }
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  // Per plank and position along it: butt joints, board tone and the grain's slow wander.
  const end = new Float32Array(planks * length), tone = new Float32Array(planks * length), phase = new Float32Array(planks * length), warp = new Float32Array(planks * length);
  for (let row = 0; row < planks; row++) {
    // Butts shift by three quarters of a board on each successive plank, with a little jitter.
    const shift = ((row * 3) % 4) / 4 * butt + (hash(row, 1) - .5) * .8;
    for (let z = 0; z < length; z++) {
      const along = (z + .5) * sz, run = along + shift, board = Math.floor(run / butt), inBoard = run - board * butt, id = ((board % 4) + 4) % 4, k = row * length + z;
      end[k] = Math.min(inBoard, butt - inBoard);
      tone[k] = (hash(row, id, 3) - .5) * .16 + (tileNoise((row + .5) / planks, along / tileAlong, 8, row + 17) - .5) * .06;
      phase[k] = hash(row, id, 9) * 40;
      warp[k] = Math.sin(along * 1.3 + phase[k]) * .006 + Math.sin(along * 4.1 + phase[k] * 2) * .002;
    }
  }
  // Grain: two sinusoids across the board whose phase wanders along it, split by the angle-sum
  // identity so the texel loop only multiplies tabulated terms.
  const coarse = 2 * Math.PI / .019, fine = 2 * Math.PI / .013;
  const across = (table: Float32Array, f: (x: number) => number) => { for (let x = 0; x < width; x++) table[x] = f(inPlankOf[x]); return table; };
  const sc = across(new Float32Array(width), p => Math.sin(p * coarse)), cc = across(new Float32Array(width), p => Math.cos(p * coarse));
  const sf = across(new Float32Array(width), p => Math.sin(p * fine)), cf = across(new Float32Array(width), p => Math.cos(p * fine));
  const along = (f: (k: number) => number) => Float32Array.from({ length: planks * length }, (_, k) => f(k));
  const sca = along(k => Math.sin(warp[k] * coarse + phase[k])), cca = along(k => Math.cos(warp[k] * coarse + phase[k]));
  const sfa = along(k => Math.sin(warp[k] * 1.7 * fine + phase[k] * 3)), cfa = along(k => Math.cos(warp[k] * 1.7 * fine + phase[k] * 3));
  // The groove at the nearest seam is the deeper of the side and end grooves.
  const profile = (d: number) => d < 3 * groove ? Math.exp(-((d / groove) ** 2)) : 0;
  const sideGroove = edgeOf.map(profile), endGroove = end.map(profile);
  const sideCaulk = edgeOf.map(edge => clamp01((caulk / 2 + sx / 2 - edge) / sx)), endCaulk = end.map(e => clamp01((caulk / 2 + sz / 2 - e) / sz));
  let mean = 0, bare = 0;
  for (let z = 0; z < length; z++) for (let x = 0; x < width; x++) {
    const k = rowOf[x] * length + z, i = z * width + x;
    const grain = .6 * (sc[x] * cca[k] + cc[x] * sca[k]) + .4 * (sf[x] * cfa[k] + cf[x] * sfa[k]);
    // Pitch caulking with an antialiased edge at this texel's footprint.
    const coverage = Math.max(sideCaulk[x], endCaulk[k]);
    albedo[i] = 1 + tone[k] + .045 * grain; seams[i] = coverage;
    height[i] = -.0012 * Math.max(sideGroove[x], endGroove[k]) + .00003 * grain;
    mean += albedo[i] * (1 - CAULK_DARKENING * coverage); bare += albedo[i];
  }
  // Normalise so the tile's mean colour, caulking included, is exactly the map's mean tone.
  teakAlbedoRatio = bare / mean; mean /= n;
  const pixels = new Uint8Array(n * 4);
  for (let z = 0; z < length; z++) {
    const up = ((z + 1) % length) * width, down = ((z + length - 1) % length) * width;
    for (let x = 0; x < width; x++) {
      const i = z * width + x, o = i * 4, right = (x + 1) % width, left = (x + width - 1) % width;
      pixels[o] = Math.max(0, Math.min(255, Math.round(albedo[i] / mean * 127.5)));
      pixels[o + 1] = Math.round(seams[i] * 255);
      pixels[o + 2] = encode((height[z * width + right] - height[z * width + left]) / (2 * sx), TEAK.gradientScale);
      pixels[o + 3] = encode((height[up + x] - height[down + x]) / (2 * sz), TEAK.gradientScale);
    }
  }
  return pixels;
}

function dataTexture(pixels: Uint8Array, width: number, height: number, name: string): THREE.DataTexture {
  const map = new THREE.DataTexture(pixels, width, height);
  map.name = name; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.anisotropy = 8; map.needsUpdate = true;
  return map;
}

/** Relief strength, for review. */
export const surfaceRelief = uniform(1);

type Nodes = { plateNormal: Node<'vec3'>; paintRoughness: Node<'float'>; plainRoughness: Node<'float'>; teakNormal: Node<'vec3'>; teakRoughness: Node<'float'>; teakPattern: Node<'float'> };
let nodes: Nodes | undefined;

/** Surface relief from an object-space height gradient `gradient` (height per metre in
 * geometry space) through the screen derivatives of geometry and view positions. */
function perturbed(gradient: Node<'vec3'>): Node<'vec3'> {
  const fx = dot(gradient, dFdx(positionGeometry)), fy = dot(gradient, dFdy(positionGeometry));
  const a = dFdx(positionView), b = dFdy(positionView), n = normalView;
  const r1 = cross(b, n), r2 = cross(n, a), det = dot(a, r1);
  const surfaceGradient = r1.mul(fx).add(r2.mul(fy)).mul(det.sign());
  return n.mul(max(abs(det), 1e-24)).sub(surfaceGradient.mul(faceDirection)).normalize();
}

/** Created once; every palette material shares these nodes. */
function shipSurfaceNodes(): Nodes {
  if (nodes) return nodes;
  const plate = dataTexture(plateTexels(), PLATE.size, PLATE.size, 'Ship plating detail');
  const teak = dataTexture(teakTexels(), TEAK.width, TEAK.length, 'Ship teak detail');
  // Roughness, metalness, plated-paint flag; `w` is the wet band's rest height (HullWetBand).
  const surface = attribute<'vec4'>('shipSurface', 'vec4');
  const p = positionGeometry, n = normalGeometry.normalize();
  // Triplanar weights in geometry space: beam-facing sides, end bulkheads and decks.
  const w0 = pow(abs(n), vec3(4)), w = w0.div(w0.x.add(w0.y).add(w0.z));
  const side = texture(plate, p.zy.div(PLATE.tile)), end = texture(plate, p.xy.div(PLATE.tile)), top = texture(plate, p.zx.div(PLATE.tile));
  const gradient = (s: Node<'vec4'>) => s.xy.mul(2).sub(1).mul(PLATE.gradientScale);
  const gs = gradient(side), ge = gradient(end);
  // Decks carry their own coverings, so plating relief stays on vertical faces.
  const plating = vec3(ge.x.mul(w.z), gs.y.mul(w.x).add(ge.y.mul(w.z)), gs.x.mul(w.x)).mul(surface.z).mul(surfaceRelief);
  const roughness = side.z.mul(w.x).add(end.z.mul(w.z)).add(top.z.mul(w.y));
  const plainRoughness = materialRoughness.mul(surface.x);
  // ±8 % about the authored roughness; paint stays matte.
  const paintRoughness = plainRoughness.mul(roughness.sub(.5).mul(surface.z.mul(.16)).add(1));

  // Teak in ship plan: x across the beam, z along the length; planks run fore and aft.
  const t = texture(teak, vec2(p.x.div(TEAK.across), p.z.div(TEAK.along)));
  const up = smoothstep(.55, .8, n.y);
  // Caulking contrast recedes once a texel of pitch is well under a pixel.
  const footprint = dFdx(p).length().max(dFdy(p).length());
  const seamFade = mix(float(1), float(.35), smoothstep(.012, .06, footprint));
  // Renormalised so the mean stays the map's mean tone at every fade.
  const caulk = t.y.mul(CAULK_DARKENING).mul(seamFade), mean = seamFade.mul(1 - teakAlbedoRatio).add(teakAlbedoRatio);
  const teakPattern = mix(float(1), t.x.mul(2).mul(caulk.oneMinus()).div(mean), up);
  const teakGradient = vec3(t.z.mul(2).sub(1), 0, t.w.mul(2).sub(1)).mul(TEAK.gradientScale).mul(up);
  const teakRoughness = plainRoughness.mul(t.y.mul(.1).add(t.x.sub(.5).mul(-.12)).mul(up).add(1));
  return nodes = { plateNormal: perturbed(plating), paintRoughness, plainRoughness, teakNormal: perturbed(teakGradient), teakRoughness, teakPattern };
}

let enabled = true;

/** Assign (or remove) the detail nodes for a palette material. The mode lives in userData so
 * per-ship clones can be switched too. */
export function applyShipSurfaceDetail(material: THREE.MeshStandardNodeMaterial, mode: ShipSurfaceMode, on = enabled): void {
  material.userData.shipSurfaceMode = mode;
  const shared = shipSurfaceNodes();
  if (mode === 'teak') {
    const map = material.map!;
    // Keep the authored stain: the map's mean tone carries it; the planks come from the shared teak.
    material.colorNode = on ? vec4(texture(map).level(float(16)).rgb.mul(shared.teakPattern), float(1)) : null;
    material.normalNode = on ? shared.teakNormal : null;
    material.roughnessNode = on ? shared.teakRoughness : shared.plainRoughness;
  } else {
    material.normalNode = on && !material.normalMap ? shared.plateNormal : null;
    material.roughnessNode = on ? shared.paintRoughness : shared.plainRoughness;
  }
  material.needsUpdate = true;
}

/** Switch surface detail on every palette material under `root` (review and measurement). `refinish`
 * re-applies what the palette layers over the detail, such as the wet band. */
export function setShipSurfaceDetail(root: THREE.Object3D, on: boolean, refinish?: (material: THREE.MeshStandardNodeMaterial) => void): void {
  enabled = on;
  const seen = new Set<THREE.Material>();
  root.traverse(object => {
    const material = (object as THREE.Mesh).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (seen.has(m) || !(m instanceof THREE.MeshStandardNodeMaterial) || !m.userData.shipSurfaceMode) continue;
      seen.add(m); applyShipSurfaceDetail(m, m.userData.shipSurfaceMode, on); refinish?.(m);
    }
  });
}

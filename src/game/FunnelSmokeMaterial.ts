import { Camera, Color, DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshBasicNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import { attribute, cos, exp, float, floor, Fn, mix, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';

const saturate = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = saturate(v); return t * t * (3 - 2 * t); };
const hash = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  return a * (1 - fy) + (hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx) * fy;
}

/** Four original billows: projected rounded lobes, soft density and their surface
 * gradients. Pack a hemisphere normal and density into one texture fetch.
 * Transparent margins keep filtering/flow away from neighbouring atlas tiles. */
export function funnelSmokeTexture(): DataTexture {
  const tile = 128, size = tile * 2, pixels = new Uint8Array(size * size * 4);
  for (let variant = 0; variant < 4; variant++) {
    const height = new Float32Array(tile * tile), density = new Float32Array(tile * tile);
    const lobes = Array.from({ length: 9 }, (_, i) => {
      const angle = i * 2.39996 + variant;
      const spread = i === 0 ? 0 : .2 + hash(i, variant + 9) * .25;
      return { x: Math.cos(angle) * spread, y: Math.sin(angle) * spread,
        rx: .3 + hash(i, variant + 31) * .24, ry: .3 + hash(i, variant + 51) * .24 };
    });
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const u = (x + .5) / tile * 2 - 1, v = (y + .5) / tile * 2 - 1;
      const wx = u + (noise(u * 5 + variant * 7, v * 5 + 19) - .5) * .12;
      const wy = v + (noise(u * 5 + 31, v * 5 + variant * 11) - .5) * .12;
      let thickness = 0;
      for (const lobe of lobes) {
        const r2 = ((wx - lobe.x) / lobe.rx) ** 2 + ((wy - lobe.y) / lobe.ry) ** 2;
        const column = Math.exp(-r2 * 2) * smooth((1 - r2) * 3);
        thickness += column * 1.7;
      }
      const detail = noise(u * 15 + 47, v * 15 + variant * 19);
      const edge = smooth((.94 - Math.max(Math.abs(u), Math.abs(v))) * 12);
      const d = (1 - Math.exp(-thickness)) * (.88 + detail * .12) * edge;
      const i = y * tile + x;
      density[i] = d;
      // A smooth optical surface avoids drawing a hard circular shading seam
      // wherever one overlapping lobe ends. Small eddies remain in the density.
      height[i] = d * .65;
    }
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const at = (dx: number, dy: number) => height[Math.max(0, Math.min(tile - 1, y + dy)) * tile + Math.max(0, Math.min(tile - 1, x + dx))];
      const nx = (at(-1, 0) - at(1, 0)) * tile * .13, ny = (at(0, -1) - at(0, 1)) * tile * .13;
      const length = Math.hypot(nx, ny, 1), d = density[y * tile + x];
      const i = ((y + Math.floor(variant / 2) * tile) * size + x + variant % 2 * tile) * 4;
      pixels[i] = Math.round((nx / length * .5 + .5) * 255);
      pixels[i + 1] = Math.round((ny / length * .5 + .5) * 255);
      pixels[i + 2] = Math.round(255 / length);
      pixels[i + 3] = Math.round(d * 255);
    }
  }
  const map = new DataTexture(pixels, size, size);
  map.minFilter = LinearMipmapLinearFilter; map.magFilter = LinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  return map;
}

/** Lit, slowly deforming exhaust impostors. One sampled atlas, one fleet draw;
 * persistent funnel exhaust does not pay the cannon volume's raymarch cost. */
export class FunnelSmokeMaterial {
  readonly map = funnelSmokeTexture();
  readonly material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  private readonly sun = new Vector3(-.55, .74, -.39).normalize();
  private readonly cameraInverse = new Quaternion();
  private readonly lightView = uniform(this.sun.clone());
  private readonly direct = uniform(new Vector3(1.25, 1.19, 1.08));
  private readonly ambient = uniform(new Vector3(.3, .35, .4));

  constructor() {
    this.material.colorNode = Fn(() => {
      const state = attribute<'vec4'>('effectSprite', 'vec4'), age = state.x, seed = state.y, life = state.z;
      // These values are constant across each puff. Evaluate them per vertex,
      // particularly the light rotation and age exponential in close overlaps.
      const clock = varying(vec3(age.mul(.48).add(seed), float(1).sub(exp(age.mul(-.5))).mul(.024), life.mul(.46)));
      const local = uv(), phase = clock.x;
      const flow = vec2(sin(local.y.mul(9).add(phase)), cos(local.x.mul(8).sub(phase.mul(.83))));
      const coordinate = local.add(flow.mul(clock.y));
      const index = floor(seed).mod(4), tile = varying(vec2(index.mod(2), floor(index.div(2))));
      const sample = texture(this.map, coordinate.clamp(.002, .998).add(tile).mul(.5));
      const normal = vec3(sample.rg.mul(2).sub(1), sample.b);
      // Rotate the light into each billboard, so spinning a puff cannot rotate
      // its sunlit side away from the actual world-space sun.
      const c = cos(state.w), s = sin(state.w), light = this.lightView;
      const localLight = varying(vec3(light.x.mul(c).add(light.y.mul(s)), light.y.mul(c).sub(light.x.mul(s)), light.z));
      const wrapped = normal.dot(localLight).mul(.6).add(.4).clamp();
      const scatter = float(.22).add(wrapped.mul(.78)).mul(mix(.75, 1, sample.a.oneMinus()));
      const lighting = this.ambient.add(this.direct.mul(scatter));
      // Thin unevenly into wisps, then the pool's smooth lifetime envelope takes
      // the remaining opacity to zero. Both clocks freeze with simulation time.
      const erosion = smoothstep(clock.z, clock.z.add(.36), sample.a);
      return vec4(lighting, sample.a.mul(erosion));
    })();
  }

  setSun(direction: Vector3): void {
    this.sun.copy(direction).normalize();
    this.lightView.value.copy(this.sun).applyQuaternion(this.cameraInverse);
  }
  setIllumination(color: Color, intensity: number, ambient: number): void {
    this.direct.value.set(color.r, color.g, color.b).multiplyScalar(Math.max(0, intensity) * 1.25 / 5.8);
    this.ambient.value.set(.3, .35, .4).multiplyScalar(Math.max(0, ambient) / 1.75);
  }
  updateCamera(camera: Camera): void {
    this.lightView.value.copy(this.sun).applyQuaternion(this.cameraInverse.copy(camera.quaternion).invert());
  }
}

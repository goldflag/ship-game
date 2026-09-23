import { Vector2, type Node, type Texture, type UniformNode } from 'three/webgpu';
import { Fn, If, dot, float, min, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { AtmospherePart, SkyUniforms } from '../contracts';
import { crossings } from './field';
import { cloudLightAt, henyeyGreenstein, type CloudLight } from './march';
import { CIRRUS_ALTITUDE, CIRRUS_TILE, numbers } from './model';

type Vec3 = Node<'vec3'>;

/** High winds carry the cirrus this many times farther than the low clouds' drift. */
const CIRRUS_DRIFT = 2.5;
/** Ice crystals: a forward lobe and an isotropic share. Their thin sheet scatters this much of the light
 * falling on it, and takes this much of the sky's fill. */
const ICE_FORWARD = .7, CIRRUS_SCATTER = 1, CIRRUS_FILL = .35;
/** Most opacity a fibre reaches, and the veil's. */
const FIBRE_OPACITY = .22, VEIL_OPACITY = .12;
/** The cirrus fade into the horizon haze over these heights of the view ray (its upward component). */
const HORIZON = [.015, .22] as const;

/** How much cirrus a scene carries, 0–1: more as the sky fills, and on about half of clear days a few
 * streaks for interest. `seed` picks which days (any number the scene keeps, such as its wind heading). */
export function cirrusAmount(coverage: number, seed: number): number {
  const chance = ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const fair = chance > .45 ? .45 + chance * .35 : .08;
  return Math.min(1, Math.max(numbers.smoothstep(.12, .7, coverage) * .9, fair));
}

/** High, thin cirrus and cirrostratus over the dome: a 2D layer at `CIRRUS_ALTITUDE` whose fibres run with
 * the wind and drift with it, lit by the sun's (or moon's) colour at that height. `strength` is the scene's
 * `cirrusAmount`; `axis` the wind's heading as a unit XZ vector. */
export function createCirrus(sky: SkyUniforms, atmosphere: AtmospherePart, light: CloudLight, map: Texture,
  strength: UniformNode<'float', number>, axis: UniformNode<'vec2', Vector2> = uniform(new Vector2(1, 0))) {
  const pattern = texture(map);
  return (direction: Vec3, behind: Vec3): Vec3 => Fn(() => {
    const result = vec3(behind).toVar();
    If(direction.y.greaterThan(HORIZON[0]).and(strength.greaterThan(0)), () => {
      // Seen from near the sea under the camera: the chart's camera stands above the layer, and the
      // environment bake looks from the sea.
      const eye = min(sky.cameraPosition.y, 3000);
      const hit = vec3(sky.cameraPosition.x, eye, sky.cameraPosition.z).add(direction.mul(crossings(eye, direction.y, CIRRUS_ALTITUDE).far));
      const drifted = hit.xz.sub(sky.windOffset.xz.mul(CIRRUS_DRIFT));
      const uv = vec2(dot(drifted, axis), dot(drifted, vec2(axis.y.negate(), axis.x))).div(CIRRUS_TILE);
      const read = pattern.sample(uv);
      read.updateMatrix = false;
      const texel = read as unknown as Node<'vec4'>;
      const veil = smoothstep(.5, 1, texel.y).mul(smoothstep(.3, .8, strength));
      const opacity = texel.x.mul(FIBRE_OPACITY).add(veil.mul(VEIL_OPACITY)).mul(strength).mul(smoothstep(HORIZON[0], HORIZON[1], direction.y)).toVar();
      const cosine = dot(direction, light.direction);
      const phase = henyeyGreenstein(cosine, ICE_FORWARD).mul(.6).add(float(.4 / (4 * Math.PI)));
      const lit = cloudLightAt(sky, atmosphere, light, hit).mul(phase.mul(CIRRUS_SCATTER)).add(atmosphere.ambient(float(CIRRUS_ALTITUDE)).above.mul(CIRRUS_FILL));
      result.assign(vec3(behind).mul(opacity.oneMinus()).add(lit.mul(opacity)));
    });
    return result;
  })();
}

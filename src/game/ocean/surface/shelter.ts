/** The sea beside a hull (`WakeSampler.shelter`). A hull's side stands over the water beside it: it hides part of the
 * sky that lights the water and its foam, and where the mirrored ray meets it the water reflects the side instead of
 * the sky. The side is lit by half the sky and by the sun where it faces it, and grey paint returns a fraction of that,
 * so the water hugging a hull is darker than open water, most in her lee, where the side is in her own shade.
 * Screen-space reflections, where they find the side on screen, replace the estimate with its image. */
import type { Node } from 'three/webgpu';
import { dot, float, min, mix, smoothstep, vec3 } from 'three/tsl';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;

/** Diffuse reflectance of a warship's grey side in linear light. */
const HULL_ALBEDO = .3;
/** Share of the sky's irradiance on the horizontal that reaches a vertical side: half the dome. */
const SIDE_SKY = .5;
/** Share of the sun's irradiance the game's lit meshes take by day: all of it (VisualEnvironment's `meshLightShares`). */
const SIDE_SUN = 1;

/** The water's light beside hulls. */
export interface HullShelter {
  /** The sky's irradiance on the water with what the sides hide replaced by the light they scatter. */
  readonly irradiance: Vec3;
  /** The share of the sky's light that still reaches the water, for shading that takes the sky as a share. */
  readonly skyShare: Float;
  /** `sky`, mirrored by the water, where the mirrored lobe meets a side: never brighter than the sky it hides. */
  reflect(sky: Vec3): Vec3;
}

/** `shelter` is the wake sampler's (hidden sky, mirrored share, outward normal); `irradiance` the sky's on the
 * horizontal; `sunIrradiance` the sun's (or moon's) on a surface facing it, from `sun`. A side facing the sun is taken
 * as sunlit: the water's own shadow would carry the clouds' onto it, which ship paint does not take on devices at 16
 * samplers, and a hull drawn sunlit would then mirror dark. Erring bright only darkens the water less. */
export function hullShelter(shelter: Node<'vec4'>, irradiance: Vec3, sunIrradiance: Vec3, sun: Vec3): HullShelter {
  const hidden = shelter.x, mirrored = shelter.y, outward = vec3(shelter.z, 0, shelter.w);
  const sunlit = sunIrradiance.mul(dot(outward, sun).max(0).mul(smoothstep(-.1, .05, sun.y)).mul(SIDE_SUN));
  // The side's exitance (π × its radiance): what it scatters of the sky and sun that reach it.
  const side = irradiance.mul(SIDE_SKY).add(sunlit).mul(HULL_ALBEDO);
  return {
    irradiance: mix(irradiance, side, hidden),
    skyShare: float(1).sub(hidden.mul(1 - HULL_ALBEDO * SIDE_SKY)),
    reflect: sky => mix(sky, min(sky, side.div(Math.PI)), mirrored),
  };
}

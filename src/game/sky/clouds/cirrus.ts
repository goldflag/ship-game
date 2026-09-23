import { Vector2, type Node, type Texture, type TextureNode, type UniformNode } from 'three/webgpu';
import { Fn, If, dot, float, min, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { AtmospherePart, SkyUniforms } from '../contracts';
import { crossings } from './field';
import { afterglow, cloudLightAt, henyeyGreenstein, type CloudLight } from './march';
import { CIRRUS_ALTITUDE, CIRRUS_TILE, numbers } from './model';

type Vec2 = Node<'vec2'>;
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
/** Texels per edge of the cirrus lighting table the clouds fill each frame (`cirrusLight`). */
export const CIRRUS_TABLE = 64;

/** How much cirrus a scene carries, 0–1: more as the sky fills, and on about half of clear days a few
 * streaks for interest. `seed` picks which days (any number the scene keeps, such as its wind heading). */
export function cirrusAmount(coverage: number, seed: number): number {
  const chance = ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const fair = chance > .45 ? .45 + chance * .35 : .08;
  return Math.min(1, Math.max(numbers.smoothstep(.12, .7, coverage) * .9, fair));
}

/** Where a direction meets the sheet, seen from near the sea under the camera: the chart's camera stands above
 * the layer, and the environment bake looks from the sea. */
function sheetPoint(sky: SkyUniforms, direction: Vec3): Vec3 {
  const eye = min(sky.cameraPosition.y, 3000);
  return vec3(sky.cameraPosition.x, eye, sky.cameraPosition.z).add(direction.mul(crossings(eye, direction.y, CIRRUS_ALTITUDE).far));
}

/** Where a direction above the horizon falls in the lighting table: a stereographic projection from the nadir,
 * the zenith at the centre and the horizon on the rim (finer toward the horizon than looking straight down). */
export function cirrusTableUv(direction: Vec3): Vec2 {
  return direction.xz.div(direction.y.add(1)).mul(.5).add(.5);
}

/** The direction a table coordinate stands for; corners beyond the disc take the rim's. */
export function cirrusTableDirection(uv: Vec2): Vec3 {
  const disc = uv.mul(2).sub(1), squared = dot(disc, disc), onDisc = disc.div(squared.max(1).sqrt()), r2 = min(squared, 1);
  return vec3(onDisc.x.mul(2), float(1).sub(r2), onDisc.y.mul(2)).div(r2.add(1));
}

/** Light the sheet sends toward the viewer along a direction: the sun's (or moon's) light where the direction
 * meets it, through the ice's phase, and the sky's fill. The clouds tabulate it once a frame, so the dome reads
 * one texel of a small table instead of the atmosphere's tables per pixel (latency a heavy dome shader cannot hide). */
export function cirrusLight(sky: SkyUniforms, atmosphere: AtmospherePart, light: CloudLight, direction: Vec3): Vec3 {
  const phase = henyeyGreenstein(dot(direction, light.direction), ICE_FORWARD).mul(.6).add(float(.4 / (4 * Math.PI)));
  return cloudLightAt(sky, atmosphere, light, sheetPoint(sky, direction)).add(afterglow(atmosphere, light)).mul(phase.mul(CIRRUS_SCATTER))
    .add(atmosphere.ambient(float(CIRRUS_ALTITUDE)).above.mul(CIRRUS_FILL));
}

/** High, thin cirrus and cirrostratus over the dome: a 2D layer at `CIRRUS_ALTITUDE` whose fibres run with
 * the wind and drift with it, lit from `table` (`cirrusLight` this frame, laid out by `cirrusTableUv`).
 * `strength` is the scene's `cirrusAmount`; `axis` the wind's heading as a unit XZ vector. */
export function createCirrus(sky: SkyUniforms, map: Texture, table: TextureNode, strength: UniformNode<'float', number>,
  axis: UniformNode<'vec2', Vector2> = uniform(new Vector2(1, 0))) {
  const pattern = texture(map);
  return (direction: Vec3, behind: Vec3): Vec3 => Fn(() => {
    const result = vec3(behind).toVar();
    If(direction.y.greaterThan(HORIZON[0]).and(strength.greaterThan(0)), () => {
      const drifted = sheetPoint(sky, direction).xz.sub(sky.windOffset.xz.mul(CIRRUS_DRIFT));
      const uv = vec2(dot(drifted, axis), dot(drifted, vec2(axis.y.negate(), axis.x))).div(CIRRUS_TILE);
      const read = pattern.sample(uv), lighting = table.sample(cirrusTableUv(direction));
      read.updateMatrix = false; lighting.updateMatrix = false;
      const texel = read as unknown as Node<'vec4'>, lit = (lighting as unknown as Node<'vec4'>).xyz;
      const veil = smoothstep(.5, 1, texel.y).mul(smoothstep(.3, .8, strength));
      const opacity = texel.x.mul(FIBRE_OPACITY).add(veil.mul(VEIL_OPACITY)).mul(strength).mul(smoothstep(HORIZON[0], HORIZON[1], direction.y)).toVar();
      result.assign(vec3(behind).mul(opacity.oneMinus()).add(lit.mul(opacity)));
    });
    return result;
  })();
}

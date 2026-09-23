import type { Node } from 'three/webgpu';
import { dot, float, smoothstep } from 'three/tsl';
import type { CelestialPart, SkyUniforms } from '../contracts';

/** Disc radius as 1 − cos θ: a 1.4° disc. */
const DISC = 7.5e-5;
/** Disc radiance per unit of irradiance above the air. The display blooms radiance above 2, so a
 * physical disc (some 10⁵ times the sky) would flood the frame; these stay a bright point with a halo. */
const SUN_DISC = 6, MOON_DISC = 12;

/** Flat sun and moon discs, no stars and no shafts, until the real celestial bodies land. */
export function createStubCelestial(uniforms: SkyUniforms): CelestialPart {
  const disc = (direction: Node<'vec3'>, toward: Node<'vec3'>) => smoothstep(float(1 - DISC * 1.15), float(1 - DISC * .85), dot(direction, toward));
  const moon = (direction: Node<'vec3'>) => uniforms.moonIrradiance.mul(disc(direction, uniforms.moonDirection)).mul(MOON_DISC);
  return {
    radiance: direction => uniforms.sunIrradiance.mul(disc(direction, uniforms.sunDirection)).mul(SUN_DISC).add(moon(direction)),
    diffuseRadiance: direction => moon(direction),
    shafts: (_scenePass, color) => color,
    update() {},
    setQuality() {},
    dispose() {},
  };
}

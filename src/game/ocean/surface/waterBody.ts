/** The water body's colour from its inherent optical properties (`OceanRealism.waterColor`): light the sea scatters
 * back out, not an emitted pigment. Sunlight and skylight cross the surface (less what it reflects), are absorbed and
 * backscattered in the water, and what comes back up crosses the surface again: noon, dusk, night, overcast and ship
 * shadows follow the light that reaches the water with no separate night scaling. Absorption is the map's
 * `absorptionColor` (per metre); backscattering is BACKSCATTER. Remote-sensing reflectance after Lee, Carder & Arnone
 * (2002); optical constants after Morel (1974, 1988) and Mobley, "Light and Water" (1994). */
import type { Node, Texture } from 'three/webgpu';
import { exp, float, pmremTexture, vec3 } from 'three/tsl';
import { schlick } from './physicalReflection';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;

/** Backscattering coefficients (1/m) in linear RGB, taken at about 620, 550 and 460 nm: sea water's own (half of Morel's
 * 1974 scattering, 0.00288·(λ/500 nm)^−4.32) plus particles, 0.003/m at 550 nm on a λ⁻¹ slope. That is Jerlov's oceanic
 * type II–III, whose chlorophyll (about 1 mg/m³) goes with the maps' absorption, several times pure water's in blue. */
export const BACKSCATTER = [.00323, .00395, .00565] as const;
/** Lee et al. (2002): subsurface remote-sensing reflectance r_rs = (g0 + g1·u)·u (1/sr), u = b_b/(a + b_b). */
const LEE_G0 = .089, LEE_G1 = .125;
/** Upwelling light the surface reflects back down and the water returns (γQ in Lee et al. 2002): r_rs/(1 − 1.7 r_rs). */
const INTERNAL_RETURN = 1.7;
/** Fresnel reflectance of a uniform sky averaged over the hemisphere; a flat sea transmits the rest of the skylight. */
const SKY_FRESNEL = .066;
/** Sea water's refractive index squared: radiance leaving the water spreads into an n² times larger solid angle. */
const REFRACTION_SQUARED = 1.333 ** 2;
/** Mean cosine of daylight under the surface, refracted to within 48.6° of the vertical: K_d = (a + b_b)/μ_d. */
const MEAN_COSINE = .85;
/** Share of the day's light that reaches a submerged object through the surface. */
const SUBMERGED_LIGHT = .97;

/** Irradiance the sky delivers to a horizontal surface: π times its cosine-weighted mean radiance, which the PMREM's
 * roughest level holds (three lights diffuse surfaces the same way). */
export function skyIrradiance(environment: Texture | null): Vec3 {
  return environment ? pmremTexture(environment, vec3(0, 1, 0), float(1)).rgb.mul(Math.PI) : vec3(0);
}

/** Backscattering as a live vec3. */
export function backscatter(): Vec3 {
  return vec3(...BACKSCATTER);
}

/** Subsurface remote-sensing reflectance r_rs = L_u/E_d (1/sr) of optically deep water with absorption `absorption` and
 * backscattering `scatter` (Lee et al. 2002), including the light the surface returns downward. */
export function subsurfaceReflectance(absorption: Vec3, scatter: Vec3): Vec3 {
  const ratio = scatter.div(absorption.add(scatter).max(1e-6));
  const reflectance = ratio.mul(ratio.mul(LEE_G1).add(LEE_G0));
  return reflectance.div(float(1).sub(reflectance.mul(INTERNAL_RETURN)));
}

/** Downwelling irradiance just under the surface: the sun's on the horizontal, less its Fresnel reflection at its own
 * incidence and where the sun shadow (`lit`) keeps it off, plus the sky's, less its hemispherical Fresnel average. */
export function downwellingIrradiance(sun: Vec3, sunIrradiance: Vec3, sky: Vec3, lit: Float): Vec3 {
  const height = sun.y.max(0);
  return sunIrradiance.mul(height.mul(float(1).sub(schlick(height))).mul(lit)).add(sky.mul(1 - SKY_FRESNEL));
}

/** Radiance just under the surface looking down into optically deep water: r_rs times the downwelling irradiance. */
export function upwelling(reflectance: Vec3, irradiance: Vec3): Vec3 {
  return reflectance.mul(irradiance);
}

/** Share of a submerged object's light that survives the column `column` (m, along the view ray) of water above it:
 * daylight reaches its depth dimmed by exp(−K_d z) with K_d = (a + b_b)/μ_d and z = column·|view.y|, and its image
 * returns along the ray dimmed by exp(−(a + b_b)·column). */
export function columnTransmittance(absorption: Vec3, scatter: Vec3, column: Float, view: Vec3): Vec3 {
  const attenuation = absorption.add(scatter);
  return exp(attenuation.mul(column.mul(float(1).add(view.y.abs().div(MEAN_COSINE)))).negate());
}

/** The water body seen from above, before the surface's own Fresnel transmission: the opaque scene behind the column
 * (lit through the surface) where the column is thin, filling in with the deep water's upwelling in proportion to
 * what the column takes away (single scattering along the ray, lit by the same exponentially dimming daylight), all
 * crossing into air (÷ n²). Shallows over sand and submerged hulls use the same optics as the open sea. */
export function waterBody(scene: Vec3, deep: Vec3, through: Vec3): Vec3 {
  return scene.mul(through).mul(SUBMERGED_LIGHT).add(deep.mul(float(1).sub(through))).div(REFRACTION_SQUARED);
}

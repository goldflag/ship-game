import { Color, MathUtils, type Node } from 'three/webgpu';
import { dot, exp, float, max, mix, pow, smoothstep, vec3 } from 'three/tsl';
import type { AtmospherePart, SkyScene, SkyUniforms } from '../contracts';

const SUNRISE = new Color('#ffd1a0'), DAYLIGHT = new Color(1, 1, 1), SUN_TINT = new Color(1, .95, .85);
/** Share of the moonlight above the air that reaches the sea when the moon is well up. */
const MOON_TRANSMITTANCE = .8;

/** A plain analytic sky until the real atmosphere lands: a zenith-to-horizon gradient that warms
 * toward a low sun and darkens at night, and the scene light the sky it replaced gave the game. */
export function createStubAtmosphere(uniforms: SkyUniforms): AtmospherePart {
  const seaLevel = { sun: new Color(), moon: new Color(), sky: new Color() };
  const sun = uniforms.sunDirection;
  const day = smoothstep(-.12, .2, sun.y);
  const low = float(1).sub(smoothstep(.02, .35, sun.y));
  const scale = uniforms.sunIrradiance.x.div(6).max(.02);
  const sky = (direction: Node<'vec3'>): Node<'vec3'> => {
    const horizonness = pow(float(1).sub(max(direction.y, 0)), 4);
    const zenith = mix(vec3(.004, .007, .016), vec3(.06, .16, .42), day);
    const horizon = mix(vec3(.01, .015, .03), mix(vec3(.42, .52, .62), vec3(.9, .55, .32), low.mul(.8)), day);
    const aureole = pow(max(dot(direction, sun), 0), 24).mul(.35).mul(day);
    return mix(zenith, horizon, horizonness).add(vec3(1, .8, .6).mul(aureole)).mul(scale);
  };
  const transmittance = (direction: Node<'vec3'>): Node<'vec3'> =>
    exp(vec3(.02, .05, .12).mul(float(1).div(max(direction.y, 0).add(.05))).negate());
  return {
    seaLevel,
    apply(scene: SkyScene) {
      const { elevation, intensity } = scene.sun;
      const high = MathUtils.smoothstep(elevation, 0, 18);
      const solar = intensity * (.12 + .88 * high) * MathUtils.smoothstep(elevation, -1, 2);
      seaLevel.sun.copy(SUNRISE).lerp(DAYLIGHT, high).multiply(SUN_TINT).multiplyScalar(solar);
      const moon = uniforms.moonIrradiance.value;
      seaLevel.moon.setRGB(moon.x, moon.y, moon.z).multiplyScalar(MOON_TRANSMITTANCE * MathUtils.smoothstep(uniforms.moonDirection.value.y, 0, Math.sin(Math.PI / 30)));
      seaLevel.sky.setRGB(.06, .16, .42).multiplyScalar(intensity / 6 * MathUtils.smoothstep(elevation, -7, 12));
    },
    sky: direction => sky(direction),
    transmittanceToSpace: direction => transmittance(direction),
    sunTransmittance: () => transmittance(sun),
    moonTransmittance: () => transmittance(uniforms.moonDirection),
    aerial(direction, distance) {
      const t = exp(distance.div(-40000));
      return { transmittance: vec3(t, t, t), inscatter: sky(direction).mul(float(1).sub(t)) };
    },
    ambient: () => ({ above: sky(vec3(0, 1, 0)).mul(2.5), below: vec3(.06, .08, .1).mul(scale) }),
    update() {},
    setQuality() {},
    dispose() {},
  };
}

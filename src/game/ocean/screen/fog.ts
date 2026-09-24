import type { Node } from 'three/webgpu';
import { Fn, cameraPosition, exp, float, mix, normalize, output, positionWorld, reference, select, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { OceanFogParameters, OceanSky } from '../contracts';
import { perRender } from '../../renderUniforms';

/** Koschmieder's constant: the visual range is where extinction leaves 2 % contrast, ln(1 / 0.02). */
const KOSCHMIEDER = 3.912;

/** `scene.fogNode` for every material with `fog` on: the ramp from `start` to `end` raised to
 * `power`, in a colour that turns from `color` into the sky behind the fragment over
 * `skyBlendDistance`, so distant ships, smoke, islands and the sea all dissolve into the
 * horizon they stand against. The sky is read at the horizon for anything below it. With `aerial`
 * the amount is real extinction instead, 1 − exp(−3.912 d / visibility) with `end` as the visibility, so haze
 * builds from the camera outward and the far sea fades into the horizon sky as it does in the open air. */
export function oceanFog(fog: OceanFogParameters, sky: OceanSky | null, aerial: Node<'bool'>): Node<'vec4'> {
  const skyFog = sky?.createFogSampler();
  // Every material reads these; the game sets them between renders.
  const near = perRender(reference('start', 'float', fog)), far = perRender(reference('end', 'float', fog));
  const power = perRender(reference('power', 'float', fog)), blend = perRender(reference('skyBlendDistance', 'float', fog));
  const tint = perRender(uniform(fog.color)) as unknown as Node<'vec3'>;
  return Fn(() => {
    const ray = positionWorld.sub(cameraPosition), distance = ray.length();
    const ramp = distance.sub(near).div(far.sub(near).max(1)).clamp(0, 1).pow(power);
    const extinction = float(1).sub(exp(distance.mul(-KOSCHMIEDER).div(far.max(1))));
    const amount = select(aerial, extinction, ramp);
    const behind = skyFog ? skyFog(normalize(vec3(ray.x, ray.y.max(0), ray.z))) : tint;
    const color = mix(tint, behind, smoothstep(float(0), blend.max(1), distance));
    return vec4(mix(output.rgb, color, amount), output.a);
  })();
}

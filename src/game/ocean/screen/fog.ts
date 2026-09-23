import type { Node } from 'three/webgpu';
import { Fn, cameraPosition, float, mix, normalize, output, positionWorld, reference, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { OceanFogParameters, OceanSky } from '../contracts';

/** `scene.fogNode` for every material with `fog` on: the ramp from `start` to `end` raised to
 * `power`, in a colour that turns from `color` into the sky behind the fragment over
 * `skyBlendDistance`, so distant ships, smoke, islands and the sea all dissolve into the
 * horizon they stand against. The sky is read at the horizon for anything below it. */
export function oceanFog(fog: OceanFogParameters, sky: OceanSky | null): Node<'vec4'> {
  const skyFog = sky?.createFogSampler();
  const near = reference('start', 'float', fog), far = reference('end', 'float', fog);
  const power = reference('power', 'float', fog), blend = reference('skyBlendDistance', 'float', fog);
  const tint = uniform(fog.color) as unknown as Node<'vec3'>;
  return Fn(() => {
    const ray = positionWorld.sub(cameraPosition), distance = ray.length();
    const amount = distance.sub(near).div(far.sub(near).max(1)).clamp(0, 1).pow(power);
    const behind = skyFog ? skyFog(normalize(vec3(ray.x, ray.y.max(0), ray.z))) : tint;
    const color = mix(tint, behind, smoothstep(float(0), blend.max(1), distance));
    return vec4(mix(output.rgb, color, amount), output.a);
  })();
}

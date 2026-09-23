/** The wake on tiers without a wake simulation (Low): it keeps the `WakeFieldApi` bookkeeping
 * (generators, centre, parameters) so the game drives it like any other, but never disturbs the water. */
import type { Object3D } from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import type { WakeFieldApi, WakeGeneratorOptions } from '../contracts';

export function calmWake(): WakeFieldApi {
  const generators = new Map<number, { object: Object3D; options: WakeGeneratorOptions }>();
  let next = 0;
  return {
    enabled: false, resolution: 0, worldSize: 1536, friction: .065, foamStrength: 1.2, foamBreakThreshold: .09, foamLifetime: 9,
    setCenter() {},
    addGenerator(object, options = {}) { generators.set(++next, { object, options: { ...options } }); return next; },
    updateGenerator(id, options) {
      const generator = generators.get(id);
      if (generator) Object.assign(generator.options, options);
      return !!generator;
    },
    removeGenerator: id => generators.delete(id),
    reset() {},
    sampler: { height: () => float(0), normal: () => vec3(0, 1, 0), foam: () => float(0) },
    step() {},
    dispose() { generators.clear(); },
  };
}

/** TEMPORARY STUB, replaced by `wake/index.ts` at integration: a wake field that keeps the
 * `WakeFieldApi` bookkeeping (generators, centre, parameters) but never disturbs the water. */
import type { Object3D } from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import type { CreateWakeField, WakeFieldApi, WakeGeneratorOptions } from '../contracts';

export const createWakeField: CreateWakeField = (_renderer, resolution) => {
  const generators = new Map<number, { object: Object3D; options: WakeGeneratorOptions }>();
  let next = 0;
  const field: WakeFieldApi = {
    enabled: resolution > 0, resolution, worldSize: 1536, friction: .065, foamStrength: 1.2, foamBreakThreshold: .09, foamLifetime: 9,
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
  return field;
};

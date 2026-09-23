/** The ocean's wave field: CPU spectrum (`spectrum.ts`), GPU evolution, inverse FFT and foam
 * (`field.ts`), and the presentation-only height readback (`sampler.ts`). */
import type { CreateWaveField, CreateWaveHeightSampler } from '../contracts';
import { GpuWaveField } from './field';
import { GpuWaveHeightSampler } from './sampler';

export const createWaveField: CreateWaveField = (_renderer, cascades, params, foam, realism) => new GpuWaveField(cascades, params, foam, realism);
export const createWaveHeightSampler: CreateWaveHeightSampler = (renderer, field) => new GpuWaveHeightSampler(renderer, field);

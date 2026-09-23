import type { WebGPURenderer } from 'three/webgpu';

/** The game renders only through WebGPU. Three's WebGPURenderer would otherwise fall back to
 * WebGL2 without saying so, and nothing in the game is built or tested for that backend. */
export const WEBGPU_REQUIRED = 'This game needs WebGPU. Use a current Chrome, Edge or Safari with hardware acceleration on.';

/** Textures, and samplers, a shader stage may bind by WebGPU's default, which three asks for unless told otherwise. */
export const DEFAULT_SAMPLED_TEXTURES = 16;

/** Device limits the game asks above WebGPU's defaults, as far as the adapter offers them. A ship's paint
 * samples its paint and wear maps, the shadow maps and the environment: the default 16 textures and samplers
 * a stage already, before the sky's cloud shadows. Desktop adapters commonly offer 48 of each. */
export const RAISED_LIMITS = ['maxSampledTexturesPerShaderStage', 'maxSamplersPerShaderStage'] as const;
export type RaisedLimits = Partial<Record<typeof RAISED_LIMITS[number], number>>;

/** The part of `navigator.gpu` start-up asks (TypeScript's DOM library does not declare WebGPU). */
export interface GpuAdapterSource {
  requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance'; featureLevel?: string }): Promise<{ limits?: RaisedLimits } | null>;
}

/** Rejects with `WEBGPU_REQUIRED` unless the browser offers a WebGPU adapter. It asks with the
 * options three's backend uses, so the answer matches what `renderer.init()` will get, and resolves
 * to that adapter's `RAISED_LIMITS` for three's device request. */
export async function requireWebGPU(gpu = (globalThis.navigator as { gpu?: GpuAdapterSource } | undefined)?.gpu): Promise<RaisedLimits> {
  const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance', featureLevel: 'compatibility' }).catch(() => null);
  if (!adapter) throw new Error(WEBGPU_REQUIRED);
  const limits: RaisedLimits = {};
  for (const name of RAISED_LIMITS) {
    const offered = adapter.limits?.[name];
    if (typeof offered === 'number') limits[name] = offered;
  }
  return limits;
}

/** Textures a shader stage may sample on the renderer's device, each with its own sampler: the fewer of the two
 * limits, once `renderer.init()` has made the device. */
export function sampledTextureLimit(renderer: Pick<WebGPURenderer, 'backend'>): number {
  const limits = (renderer.backend as { device?: { limits?: RaisedLimits } }).device?.limits;
  return Math.min(limits?.maxSampledTexturesPerShaderStage ?? DEFAULT_SAMPLED_TEXTURES, limits?.maxSamplersPerShaderStage ?? DEFAULT_SAMPLED_TEXTURES);
}

/** After `renderer.init()`: three can still fall back to WebGL2 when the WebGPU device fails. */
export function requireWebGPUBackend(renderer: Pick<WebGPURenderer, 'backend'>): void {
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) throw new Error(WEBGPU_REQUIRED);
}

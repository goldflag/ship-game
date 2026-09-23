import type { WebGPURenderer } from 'three/webgpu';

/** The game renders only through WebGPU. Three's WebGPURenderer would otherwise fall back to
 * WebGL2 without saying so, and nothing in the game is built or tested for that backend. */
export const WEBGPU_REQUIRED = 'This game needs WebGPU. Use a current Chrome, Edge or Safari with hardware acceleration on.';

/** The part of `navigator.gpu` start-up asks (TypeScript's DOM library does not declare WebGPU). */
export interface GpuAdapterSource {
  requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance'; featureLevel?: string }): Promise<unknown>;
}

/** Rejects with `WEBGPU_REQUIRED` unless the browser offers a WebGPU adapter. It asks with the
 * options three's backend uses, so the answer matches what `renderer.init()` will get. */
export async function requireWebGPU(gpu = (globalThis.navigator as { gpu?: GpuAdapterSource } | undefined)?.gpu): Promise<void> {
  const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance', featureLevel: 'compatibility' }).catch(() => null);
  if (!adapter) throw new Error(WEBGPU_REQUIRED);
}

/** After `renderer.init()`: three can still fall back to WebGL2 when the WebGPU device fails. */
export function requireWebGPUBackend(renderer: Pick<WebGPURenderer, 'backend'>): void {
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) throw new Error(WEBGPU_REQUIRED);
}

import { expect, test } from 'bun:test';
import type { WebGPURenderer } from 'three/webgpu';
import { requireWebGPU, requireWebGPUBackend, WEBGPU_REQUIRED } from './webgpu';

test('start-up refuses a browser without a WebGPU adapter', async () => {
  await expect(requireWebGPU(undefined)).rejects.toThrow(WEBGPU_REQUIRED);
  await expect(requireWebGPU({ requestAdapter: async () => null })).rejects.toThrow(WEBGPU_REQUIRED);
  await expect(requireWebGPU({ requestAdapter: async () => { throw new Error('blocked'); } })).rejects.toThrow(WEBGPU_REQUIRED);
  const requests: unknown[] = [];
  await requireWebGPU({ requestAdapter: async options => { requests.push(options); return {}; } });
  // The same request three's backend makes, so both see the same adapter.
  expect(requests).toEqual([{ powerPreference: 'high-performance', featureLevel: 'compatibility' }]);
});

test('a renderer that fell back to WebGL2 is refused', () => {
  const renderer = (backend: object) => ({ backend }) as unknown as WebGPURenderer;
  expect(() => requireWebGPUBackend(renderer({ isWebGLBackend: true }))).toThrow(WEBGPU_REQUIRED);
  expect(() => requireWebGPUBackend(renderer({ isWebGPUBackend: true }))).not.toThrow();
});

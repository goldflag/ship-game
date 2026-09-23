import type { WebGPURenderer } from 'three/webgpu';

/** Keep authored layers in order with Three r185's reversed depth buffer. */
export function configureRenderOrder(renderer: WebGPURenderer): void {
  // Three reverses its sorted lists only for a reversed depth buffer. The game always asks
  // for one; diagnostics that render with ordinary depth keep Three's own order.
  if (!renderer.reversedDepthBuffer) return;
  // r185 RenderList.sort reverses the entire sorted list, including explicit
  // priorities and stable IDs. Counter those reversals, but retain reversed Z
  // sorting. Otherwise the distant water (-30) draws AFTER smoke/spray (0).
  // Sorted entries are active; Three only nulls these fields on released slots.
  renderer.setOpaqueSort((a, b) =>
    b.groupOrder! - a.groupOrder! || b.renderOrder! - a.renderOrder! || a.z! - b.z! || b.id! - a.id!);
  renderer.setTransparentSort((a, b) =>
    b.groupOrder! - a.groupOrder! || b.renderOrder! - a.renderOrder! || b.z! - a.z! || b.id! - a.id!);
}

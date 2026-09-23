/** TEMPORARY STUB, replaced by `screen/reflections.ts` and `screen/underwater.ts` at integration.
 * The shapes below are what the surface material and the facade pass today. */
import type { Node, PassNode } from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import type { OceanApi } from '../contracts';

/** What the surface fragment hands the reflection march. The viewport copies are the same
 * ones the transmission and shoreline terms read, so reflections add no copies of their own. */
export interface ScreenReflectionInput {
  /** World position of the shaded (displaced) surface point. */
  position: Node<'vec3'>;
  /** Unit world direction of the mirrored view ray. */
  direction: Node<'vec3'>;
  /** Opaque scene colour at a screen UV, copied before the water draws. */
  sceneColor: (uv: Node<'vec2'>) => Node<'vec3'>;
  /** Opaque scene depth (device depth, the renderer's convention) at a screen UV. */
  sceneDepth: (uv: Node<'vec2'>) => Node<'float'>;
  /** Ray budget from the quality tier; 0 compiles no march. */
  steps: number;
  /** Live world-space ray length (`OceanApi.reflections.maxDistance`). */
  maxDistance: Node<'float'>;
  /** Live 0/1 switch (`OceanApi.reflections.screenSpace`). */
  enabled: Node<'float'>;
}

/** Reflected scene radiance and how much of it to trust (0 keeps the sky reflection). */
export function screenSpaceReflection(_input: ScreenReflectionInput): { color: Node<'vec3'>; confidence: Node<'float'> } {
  return { color: vec3(0), confidence: float(0) };
}

/** The underwater view composed over the scene pass. It reads the ocean's live colours, waves and
 * `cameraNearSurface`; the stub leaves the frame unchanged. */
export function underwaterPost(_ocean: OceanApi, _scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'> {
  return color;
}

import type { Node } from 'three/webgpu';
import { cameraProjectionMatrix, int, screenSize } from 'three/tsl';

/** `node[index]`: a matrix's column or a vector's component, by a constant or dynamic index. */
export function element<T extends string>(node: unknown, index: number | Node<'int'>): Node<T> {
  return (node as { element(index: unknown): Node<T> }).element(typeof index === 'number' ? int(index) : index);
}

/** Pixels per unit of tangent at the screen centre: a length `l` at view depth `d` spans `focalPixels() × l / d` pixels. */
export function focalPixels(): Node<'float'> {
  return element<'vec4'>(cameraProjectionMatrix, 1).y.mul(screenSize.y.mul(.5));
}

import { BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial, NoBlending, type Node } from 'three/webgpu';
import { cameraProjectionMatrixInverse, cameraWorldMatrix, float, fract, inverseSqrt, luminance, normalize, positionGeometry, screenCoordinate, varying, vec4 } from 'three/tsl';

/** Transparent queue positions, after the sea (−30, which writes depth) and before smoke and spray (≥ 0).
 * The dome draws only where nothing has: the sky left between the opaque scene and the sea, never the
 * half of the screen the sea covers (nor any of it from the chart's height). The sea's screen-space
 * reflections read the scene before either, and treat the empty far plane as sky, as before. The cloud
 * composite then blends over the dome and the sea. */
export const DOME_ORDER = -29.5, CLOUD_ORDER = -29;

/** One triangle covering the viewport (clip-space corners (−1,−1), (3,−1), (−1,3)). */
export function fullScreenTriangle(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return geometry;
}

/** For a full-screen triangle drawn with `vertexNode = screenCorner(depth)`: the unit world direction
 * through each pixel. The view ray is linear across the screen, so it interpolates from the corners. */
export function viewDirection(): Node<'vec3'> {
  const point = cameraProjectionMatrixInverse.mul(vec4(positionGeometry.xy, .5, 1));
  return normalize(varying(cameraWorldMatrix.mul(vec4(point.xyz.div(point.w), 0)).xyz, 'vSkyDirection'));
}

/** Dither of ±half an 8-bit level of a gamma-2.2 display: a relative ±(1.1/255)·radiance^(−1/2.2), the inverse
 * square root standing in for that power. */
const DITHER = 2.2 / 255;

/** Half a display level of static noise over radiance: the night's dark, smooth gradients band in 8 bits
 * without it. Fragment stage only (it reads the pixel's screen position). */
export function dither(radiance: Node<'vec3'>): Node<'vec3'> {
  const level = luminance(radiance).max(1e-6);
  const noise = fract(fract(screenCoordinate.x.mul(.06711056).add(screenCoordinate.y.mul(.00583715))).mul(52.9829189)).sub(.5);
  return radiance.mul(noise.mul(inverseSqrt(level).mul(DITHER).min(.16)).add(1));
}

/** Clip position of a full-screen triangle corner at a fixed NDC depth. */
export function screenCorner(depth: Node<'float'>): Node<'vec4'> {
  return vec4(positionGeometry.xy, depth, 1);
}

/** The sky backdrop: `color(direction)` at the far plane behind everything. Reversed depth clears to 0,
 * so the dome sits at 0 there and at 1 otherwise; it draws only where nothing did. */
export function createDome(color: (direction: Node<'vec3'>) => Node<'vec3'>, reversedDepth: boolean): Mesh {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false });
  material.blending = NoBlending;
  material.name = 'Sky dome';
  material.fog = false;
  material.toneMapped = false;
  material.vertexNode = screenCorner(float(reversedDepth ? 0 : 1));
  material.colorNode = vec4(dither(color(viewDirection())), 1);
  const mesh = new Mesh(fullScreenTriangle(), material);
  mesh.name = 'Sky dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = DOME_ORDER;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

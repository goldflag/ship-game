import { BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { cameraProjectionMatrixInverse, cameraWorldMatrix, float, normalize, positionGeometry, varying, vec4 } from 'three/tsl';

/** Opaque queue position of the dome: after every opaque object, so covered pixels skip it. */
export const DOME_ORDER = 1000;
/** Transparent queue position of the cloud composite: right after the sea (−30), before smoke and spray. */
export const CLOUD_ORDER = -29;

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

/** Clip position of a full-screen triangle corner at a fixed NDC depth. */
export function screenCorner(depth: Node<'float'>): Node<'vec4'> {
  return vec4(positionGeometry.xy, depth, 1);
}

/** The sky backdrop: `color(direction)` at the far plane behind everything opaque. Reversed depth
 * clears to 0, so the dome sits at 0 there and at 1 otherwise; it draws only where nothing did. */
export function createDome(color: (direction: Node<'vec3'>) => Node<'vec3'>, reversedDepth: boolean): Mesh {
  const material = new MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
  material.name = 'Sky dome';
  material.fog = false;
  material.toneMapped = false;
  material.vertexNode = screenCorner(float(reversedDepth ? 0 : 1));
  material.colorNode = vec4(color(viewDirection()), 1);
  const mesh = new Mesh(fullScreenTriangle(), material);
  mesh.name = 'Sky dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = DOME_ORDER;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

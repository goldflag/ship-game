import type { Node, PassNode, TextureNode, UniformNode } from 'three/webgpu';
import { Fn, If, exp, float, luminance, mix, perspectiveDepthToViewZ, reference, uniform, uv, vec3, vec4 } from 'three/tsl';

/** Distance (m) over which a downpour veils the view by e: the rain between the camera and anything past a few
 * hundred metres. The ocean's fog still owns the far distance. */
const RAIN_VISIBILITY = 1800;
/** How far the veil desaturates what it covers, and how far it pulls it toward the rain-lit air. */
const DESATURATE = .4, LIFT = .22;

export interface HazeInput {
  /** 0 when dry (the pass then does nothing), up to 1 in a downpour. */
  readonly strength: UniformNode<'float', number>;
  /** Radiance of the rain-filled air along a world view ray: the light it scatters toward the camera. */
  readonly air: (ray: Node<'vec3'>) => Node<'vec3'>;
}

/** Heavy rain's veil over the composed scene, in linear radiance: by distance from the scene depth, colour drains
 * toward grey and dark, low-contrast distance lifts toward the light the rain scatters. A uniform branch skips
 * everything, the depth read included, when dry. */
export function rainHaze(scenePass: PassNode, color: Node<'vec4'>, { strength, air }: HazeInput): Node<'vec4'> {
  // Camera nodes in the output chain belong to its quad camera; read the scene camera's own matrices.
  const camera = scenePass.camera;
  const cameraWorld = uniform(camera.matrixWorld), projectionInverse = uniform(camera.projectionMatrixInverse);
  const near = reference('near', 'float', camera), far = reference('far', 'float', camera);
  const depth = scenePass.getTextureNode('depth');
  return Fn(() => {
    const result = color.toVar();
    If(strength.greaterThan(0), () => {
      const screen = uv();
      const read = depth.sample(screen) as TextureNode;
      // A screen-space read: never through the texture's UV transform.
      read.updateMatrix = false;
      // Any NDC depth inside the frustum lies on this pixel's ray, whichever depth convention is active.
      const onRay = projectionInverse.mul(vec4(screen.x.mul(2).sub(1), screen.y.mul(-2).add(1), .5, 1));
      const viewRay = onRay.xyz.div(onRay.w).normalize();
      const ray = cameraWorld.mul(vec4(viewRay, 0)).xyz.normalize();
      const distance = perspectiveDepthToViewZ(read.r, near, far).div(viewRay.z.min(-1e-4));
      const veil = float(1).sub(exp(distance.div(-RAIN_VISIBILITY))).mul(strength);
      const rgb = result.rgb;
      const grey = mix(rgb, vec3(luminance(rgb)), veil.mul(DESATURATE));
      result.assign(vec4(mix(grey, air(ray), veil.mul(LIFT)), result.a));
    });
    return result;
  })();
}

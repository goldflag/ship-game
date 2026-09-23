import type { Node, PassNode, UniformNode } from 'three/webgpu';
import { Fn, If, exp, float, luminance, mix, normalize, select, uniform, uv, varying, vec3, vec4 } from 'three/tsl';

/** Distance (m) over which a downpour veils the view by e: the rain between the camera and anything past a few
 * hundred metres. The ocean's fog still owns the far distance. */
const RAIN_VISIBILITY = 1800;
/** How far the veil desaturates what it covers, and how far it pulls it toward the rain-lit air. */
const DESATURATE = .35, LIFT = .18;
/** Longest rain path (m) a ray grazing the sea is given. */
const LONGEST = 30000;

export interface HazeInput {
  /** 0 when dry (the pass then does nothing), up to 1 in a downpour. */
  readonly strength: UniformNode<'float', number>;
  /** Height of the camera above the sea, and of the cloud base above the camera (m): where the rain along a view ray
   * ends. */
  readonly height: UniformNode<'float', number>;
  readonly ceiling: UniformNode<'float', number>;
  /** Radiance of the rain-filled air seen along a world direction: the light it scatters toward the camera. */
  readonly air: (direction: Node<'vec3'>) => Node<'vec3'>;
}

/** Heavy rain's veil over the composed scene, in linear radiance: by the length of rain along each view ray, colour
 * drains toward grey and dark, low-contrast distance lifts toward the light the rain scatters. The rain along a ray
 * ends at the sea below the horizon and at the cloud base above it, so storm clouds overhead keep their darkness.
 * That length, not the scene depth, sets the veil: a depth read here cost this pass several times the veil's own
 * work, and what the veil changes (sea, horizon, far ships) lies at the sea's distance anyway; a hull in the
 * foreground stands below the horizon, where the sea behind it is near and the veil faint. A uniform branch skips
 * everything when dry. */
export function rainHaze(scenePass: PassNode, color: Node<'vec4'>, { strength, height, ceiling, air }: HazeInput): Node<'vec4'> {
  // Camera nodes in the output chain belong to its quad camera; read the scene camera's own matrices.
  const camera = scenePass.camera;
  const cameraWorld = uniform(camera.matrixWorld), projectionInverse = uniform(camera.projectionMatrixInverse);
  // The veil's colour: the air toward the horizon ahead, evaluated at the output triangle's corners rather than at every
  // pixel (the sky model is the costliest part of the veil, and the colour of the rain hardly varies across a view).
  const forward = cameraWorld.mul(vec4(0, 0, -1, 0)).xyz;
  const tint = varying(air(normalize(vec3(forward.x, .08, forward.z))), 'vRainAir');
  // The view ray at the output triangle's corners, interpolated: at a fixed NDC depth (any inside the frustum, whichever
  // depth convention is active) the unprojected point is linear across the screen.
  const screen = uv(), onRay = projectionInverse.mul(vec4(screen.x.mul(2).sub(1), screen.y.mul(-2).add(1), .5, 1));
  const view = varying(cameraWorld.mul(vec4(onRay.xyz.div(onRay.w), 0)).xyz, 'vRainRay');
  return Fn(() => {
    const result = color.toVar();
    If(strength.greaterThan(0), () => {
      const ray = normalize(view);
      const rain = select(ray.y.lessThan(0), height.div(ray.y.negate().max(1e-4)), ceiling.div(ray.y.max(.02))).min(LONGEST);
      const veil = float(1).sub(exp(rain.div(-RAIN_VISIBILITY))).mul(strength);
      const rgb = result.rgb;
      const grey = mix(rgb, vec3(luminance(rgb)), veil.mul(DESATURATE));
      result.assign(vec4(mix(grey, tint, veil.mul(LIFT)), result.a));
    });
    return result;
  })();
}

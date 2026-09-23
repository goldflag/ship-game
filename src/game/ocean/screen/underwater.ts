import { Vector3, type Node, type PassNode, type PerspectiveCamera } from 'three/webgpu';
import { Fn, If, exp, float, fwidth, max, min, mix, perspectiveDepthToViewZ, reference, screenSize, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { OceanSun, WaterColors } from '../contracts';
import { screenRead } from './reflections';

/** What the underwater view reads. Colours and sun are read live (by reference), so the game's
 * night scaling and its submerged absorption easing (`VisualEnvironment.update`) apply directly. */
export interface UnderwaterInput {
  /** Surface height (m) at a world position, any stage: `WaveField.heightAt` plus the wake when it moves the surface. */
  readonly heightAt: (xz: Node<'vec2'>) => Node<'float'>;
  readonly colors: WaterColors;
  /** Direction and colour shape the forward-scattered light; its brightness comes with the pigment, which the
   * game already scales for night, so `intensity` is not read. */
  readonly sun: OceanSun;
  /** False when the near plane is certainly above the waves (`nearPlaneMayBeSubmerged`): the pass then does nothing. */
  readonly cameraNearSurface: Node<'bool'>;
}

/** Water's refractive index: sunlight enters the sea bent toward the vertical. */
const REFRACTION = 1.333;
/** Forward-scattering asymmetry of the sunlit haze (Henyey–Greenstein g). */
const FORWARD = .55;
/** Sunlight scattered forward, relative to the pigment (the backscatter seen looking down into the sea). */
const SUNLIT = .45;
/** Optical depth, in its most transparent channel, over which daylight in the sea takes the colour of what the
 * water absorbs least. Relative to that channel, so the game's submerged easing of the absorption (a uniform
 * scale) keeps the hue. */
const TINT_DEPTH = 1;
/** Daylight scattered along the underside of the surface, relative to the sky's mean radiance overhead: the sun
 * and the whole dome feed it through Snell's window. */
const SIDE_LIGHT = 3;
/** Vertical direction components over which the seen light turns from the deep's upwelling to the side light. */
const DEEP_VIEW = -.7, SIDE_VIEW = 0;

/** Radiance of the lit sea seen along `direction` from just below the surface: the pigment looking down into the
 * deep, brightening toward the horizontal into daylight scattered along the surface, which takes the tint of what
 * the water absorbs least. `daylight` is the sky's mean radiance overhead, dark at night like the sky itself. */
export function waterLight(pigment: Node<'vec3'>, absorption: Node<'vec3'>, daylight: Node<'vec3'>, direction: Node<'vec3'>): Node<'vec3'> {
  const tint = exp(absorption.div(max(absorption.x, max(absorption.y, absorption.z)).max(1e-6)).mul(-TINT_DEPTH));
  return mix(pigment, daylight.mul(tint).mul(SIDE_LIGHT), smoothstep(DEEP_VIEW, SIDE_VIEW, direction.y));
}
/** Waterline width in pixels, and how much the film of water on the lens takes the transmission tint. */
const MENISCUS_WIDTH = 1.6;
const MENISCUS_TINT = .85;

/** The underwater view, composed over the scene pass: `ocean.postProcess(scenePass, color)`.
 *
 * Per pixel it tests whether the view ray starts under water (its near-plane point below
 * `heightAt`). Such rays run through water to the first opaque or surface depth (the surface
 * writes depth, so rays toward it stop there, and the sky's far depth is the open deep):
 * transmittance `exp(−absorption × d)` dims the scene and light scattered toward the camera
 * fills in with the pigment. That in-scattering is integrated in closed form along the ray,
 * lit by light that fades with depth below the surface (the same absorption, so the deep
 * darkens and the view up brightens) and by a forward-scattering sun lobe refracted into
 * the sea. A thin line in the transmission tint marks where the near plane cuts the surface.
 *
 * Integration, in `Ocean.ts` (the facade owns the colours, the sun and the uniform):
 * ```ts
 * const cameraNearSurface = uniform(false);
 * const underwater = createUnderwaterPass({ heightAt: xz => waveField.heightAt(xz), colors, sun, cameraNearSurface });
 * // update(): cameraNearSurface.value = nearPlaneMayBeSubmerged(camera, waveField.maxHeight + wakeBound);
 * postProcess(scenePass, color) { return underwater(scenePass, color); }
 * ```
 * Game.ts puts `ocean.postProcess(this.scenePass, sceneColor)` at the head of its output chain. */
export function createUnderwaterPass(input: UnderwaterInput): (scenePass: PassNode, color: Node<'vec4'>) => Node<'vec4'> {
  const { heightAt, colors, sun, cameraNearSurface } = input;
  const pigment = uniform(colors.waterColor).rgb, absorption = uniform(colors.absorptionColor).rgb, transmission = uniform(colors.transmissionColor).rgb;
  const sunDirection = uniform(sun.direction), sunColor = uniform(sun.color).rgb;
  return (scenePass, color) => {
    // Camera nodes in the output chain belong to its quad camera; read the scene camera's own matrices.
    const camera = scenePass.camera;
    const cameraWorld = uniform(camera.matrixWorld), projectionInverse = uniform(camera.projectionMatrixInverse);
    const near = reference('near', 'float', camera), far = reference('far', 'float', camera);
    return Fn(() => {
      const result = color.toVar();
      If(cameraNearSurface, () => {
        const screen = uv();
        // Any NDC depth inside the frustum lies on this pixel's ray, whichever depth convention is active.
        const onRay = projectionInverse.mul(vec4(screen.x.mul(2).sub(1), screen.y.mul(-2).add(1), .5, 1));
        const viewRay = onRay.xyz.div(onRay.w).normalize().toVar();
        const ray = cameraWorld.mul(vec4(viewRay, 0)).xyz.normalize().toVar();
        const toNear = near.div(viewRay.z.negate());
        const start = cameraWorld.mul(vec4(viewRay.mul(toNear), 1)).xyz.toVar();
        // Metres below the surface where this pixel's ray starts; negative above it.
        const depth = heightAt(start.xz).sub(start.y).toVar();
        // Derivatives before the per-pixel branch: the waterline keeps a constant width in pixels.
        const waterline = smoothstep(MENISCUS_WIDTH * .5, MENISCUS_WIDTH, depth.abs().div(fwidth(depth).max(1e-6))).oneMinus();
        If(depth.greaterThan(0), () => {
          // The farthest depth of this pixel and its neighbours: a multisampled silhouette's colour holds some of
          // what lies behind it, and fogging the edge by the nearer depth would leave a bright unfogged fringe.
          const texel = vec2(1).div(screenSize);
          const sceneDepth = scenePass.getTextureNode('depth');
          const farthest = [vec2(0, 0), vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1)]
            .map(offset => perspectiveDepthToViewZ(screenRead(sceneDepth, screen.add(offset.mul(texel))).r, near, far))
            .reduce((a, b) => min(a, b));
          const distance = farthest.div(viewRay.z).sub(toNear).max(0);
          const transmittance = exp(absorption.mul(distance).negate());
          // Light at depth z below the surface falls as exp(−a·z); along the ray z = depth − s·ray.y, so
          // ∫ a·exp(−a·(depth − s·ray.y))·exp(−a·s) ds over [0, d] = exp(−a·depth)·(1 − exp(−a·(1 − ray.y)·d)) / (1 − ray.y).
          const rise = float(1).sub(ray.y).max(1e-3);
          const optical = absorption.mul(rise).mul(distance).max(1e-4);
          const path = float(1).sub(exp(optical.negate())).div(optical).mul(absorption).mul(distance);
          // The sun, refracted toward the vertical, lights a forward lobe (normalised to average 1).
          const bent = vec3(sunDirection.x, 0, sunDirection.z).div(REFRACTION);
          const sunInWater = vec3(bent.x, float(1).sub(bent.dot(bent)).max(0).sqrt(), bent.z);
          const g2 = FORWARD * FORWARD;
          const lobe = float(1 - g2).div(float(1 + g2).sub(ray.dot(sunInWater).mul(2 * FORWARD)).pow(1.5));
          const tint = sunColor.div(max(sunColor.r, max(sunColor.g, sunColor.b)).max(1e-3));
          const daylight = smoothstep(-.05, .25, sunDirection.y).mul(SUNLIT);
          const lit = pigment.mul(tint.mul(lobe).mul(daylight).add(1));
          const inscattered = lit.mul(exp(absorption.mul(depth).negate())).mul(path);
          result.assign(vec4(result.rgb.mul(transmittance).add(inscattered), result.a));
        });
        // The film of water where the lens meets the surface reads against both the sky and the deep.
        result.assign(vec4(mix(result.rgb, transmission, waterline.mul(MENISCUS_TINT)), result.a));
      });
      return result;
    })();
  };
}

const eye = new Vector3(), forward = new Vector3(), corner = new Vector3();
/** CPU side of the uniform branch: whether any near-plane corner (or the camera) may lie below `maxHeight`,
 * the highest the surface can reach this frame. False means the whole view starts above the water. */
export function nearPlaneMayBeSubmerged(camera: PerspectiveCamera, maxHeight: number): boolean {
  if (!Number.isFinite(maxHeight)) return true;
  const world = camera.matrixWorld.elements;
  eye.set(world[12], world[13], world[14]);
  forward.set(-world[8], -world[9], -world[10]).normalize();
  let lowest = eye.y;
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    // As in the pass: any depth inside the frustum lies on the corner's ray, which then runs to the near plane.
    corner.set(x, y, .5).unproject(camera).sub(eye);
    lowest = Math.min(lowest, eye.y + corner.y * camera.near / corner.dot(forward));
  }
  return lowest <= maxHeight;
}

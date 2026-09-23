import type { Node, TextureNode } from 'three/webgpu';
import { Break, Fn, If, Loop, bool, cameraFar, cameraNear, cameraProjectionMatrix, cameraViewMatrix, float, int, min, mix, perspectiveDepthToViewZ,
  screenSize, smoothstep, vec2, vec3, vec4 } from 'three/tsl';

/** What `screenSpaceReflection` reads. Everything is a node the surface material already has:
 * the function creates no textures and no viewport copies of its own. */
export interface ScreenReflectionInput {
  /** View-space position of the water fragment in metres (the displaced surface, e.g. `positionView`). */
  readonly position: Node<'vec3'>;
  /** View-space direction of the reflected ray; normalised here. */
  readonly direction: Node<'vec3'>;
  /** The surface's viewport copy of the opaque scene colour. Read at level 0. */
  readonly sceneColor: TextureNode;
  /** The surface's viewport copy of the opaque scene depth, in the scene pass's own format
   * (float with reversed depth; see `EffectDepthTextureNode`). Read texel-exact. */
  readonly sceneDepth: TextureNode;
  /** Live switch (Graphics → Reflections). False skips the march in a uniform branch. */
  readonly enabled: Node<'bool'>;
  /** Longest ray in metres; live, since `WaterViewFocus` stretches it under binoculars. */
  readonly maxDistance: Node<'float'>;
  /** Steps along the clipped ray, fixed when the shader is built (the tier's `reflectionSteps`). */
  readonly steps: number;
}

export interface ScreenReflection {
  /** Opaque scene colour where the ray hit (linear HDR); black on a miss. */
  readonly color: Node<'vec3'>;
  /** 0–1 trust in `color`: 0 on a miss, fading at screen edges, near `maxDistance` and for
   * rays heading back toward the camera. Blend with the sky reflection by it. */
  readonly confidence: Node<'float'>;
}

/** Bisections of the step that crossed the scene: 1/256 of a step. */
const REFINEMENTS = 8;
/** Crossings refined per ray at most; a ray skimming a receding surface stops searching after these. */
const SEARCHES = 3;
/** A refined hit may lie behind the scene by this share of its depth (plus the ray's own depth across
 * the final bisection bracket). Proportional, because float depth resolves metres at 20 km but
 * centimetres alongside. */
const THICKNESS = .02;
/** Screen-edge fade, as a share of the viewport. */
const EDGE = .06;

/** Screen-space reflection of the opaque scene for one water fragment (McGuire & Mara, "Efficient
 * GPU Screen-Space Ray Tracing", JCGT 2014). The ray is clipped to the near plane and then to the
 * viewport before its step budget is spread along it, so every step lands on screen however long
 * `maxDistance` is; depth is interpolated as 1/w, keeping the march perspective-correct; the step
 * that first passes behind the depth buffer is refined by bisection and accepted only within a
 * depth-proportional thickness, so rays passing behind a nearer object keep marching. Sky and
 * far-plane pixels never occlude. Rays that leave the screen, fall short or miss return
 * confidence 0 and the caller keeps its sky reflection.
 *
 * Integration, inside the surface material's fragment `Fn` (steps 0 on Low and Medium: skip the call):
 * ```ts
 * const normal = cameraViewMatrix.mul(vec4(waveNormalWorld, 0)).xyz;       // wave normal in view space
 * const mirrored = reflect(positionView.normalize(), normal.normalize());
 * const ssr = screenSpaceReflection({ position: positionView, direction: mirrored,
 *   sceneColor, sceneDepth,                                                  // the copies transmission already reads
 *   enabled: reflectionsEnabled, maxDistance: reflectionDistance,           // uniforms fed from ocean.reflections
 *   steps: OCEAN_TIERS[quality].reflectionSteps });
 * const reflected = mix(skyReflection, ssr.color, ssr.confidence);          // then weight by Fresnel
 * ```
 * Pass the mirror direction unclamped: rays reflected below the horizon re-enter the sea and miss
 * here (the sky lookup may still bend them up to the horizon). */
export function screenSpaceReflection(input: ScreenReflectionInput): ScreenReflection {
  const { position, direction, sceneColor, sceneDepth, enabled, maxDistance, steps } = input;
  const result = Fn(() => {
    const color = vec3(0).toVar(), confidence = float(0).toVar();
    const ray = direction.normalize().toVar();
    // A ray reflected below the horizon re-enters the sea: nothing above water can be its hit.
    If(enabled.and(ray.dot(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz).greaterThan(0)), () => {
      const origin = position.toVar();
      // A ray heading toward the camera ends just in front of the near plane (w stays positive).
      const toNear = cameraNear.mul(-1.001).sub(origin.z).div(ray.z);
      const end = origin.add(ray.mul(ray.z.greaterThan(1e-6).select(min(toNear, maxDistance), maxDistance))).toVar();
      const clipStart = cameraProjectionMatrix.mul(vec4(origin, 1)).toVar(), clipEnd = cameraProjectionMatrix.mul(vec4(end, 1)).toVar();
      const k0 = clipStart.w.reciprocal().toVar(), kEnd = clipEnd.w.reciprocal().toVar();
      // Pixel coordinates with y down, matching three's screen UV on both backends.
      const pixel = (clip: Node<'vec4'>, k: Node<'float'>) => vec2(clip.x.mul(k).mul(.5).add(.5), clip.y.mul(k).mul(-.5).add(.5)).mul(screenSize);
      const s0 = pixel(clipStart, k0).toVar(), sEnd = pixel(clipEnd, kEnd).toVar();
      // Clip to the viewport. The start is this fragment's own pixel, so per axis the exit fraction is how
      // far the end may go before leaving [½, size − ½]. Pixel position, 1/w and P/w are all linear on
      // screen and clip by the same fraction, which keeps the march perspective-correct.
      const delta = sEnd.sub(s0).toVar();
      const exitAxis = (d: Node<'float'>, start: Node<'float'>, stop: Node<'float'>, extent: Node<'float'>) =>
        d.abs().lessThan(1e-3).select(float(1), stop.clamp(.5, extent.sub(.5)).sub(start).div(d));
      const exit = min(exitAxis(delta.x, s0.x, sEnd.x, screenSize.x), exitAxis(delta.y, s0.y, sEnd.y, screenSize.y)).clamp(0, 1).toVar();
      const s1 = s0.add(delta.mul(exit)).toVar();
      const q0 = origin.mul(k0).toVar(), q1 = mix(q0, end.mul(kEnd), exit).toVar(), k1 = mix(k0, kEnd, exit).toVar();
      const farthest = cameraFar.mul(.999);
      /** Ray and scene depth (metres in front of the camera) at screen fraction `t` of the clipped ray. */
      const probe = (t: Node<'float'>) => {
        const along = mix(q0.z, q1.z, t).div(mix(k0, k1, t)).negate().toVar();
        const scene = perspectiveDepthToViewZ(sceneDepth.sample(mix(s0, s1, t).div(screenSize)).r, cameraNear, cameraFar).negate().toVar();
        // Sky and far-plane pixels never occlude, even behind the longest ray.
        const sky = scene.greaterThanEqual(farthest);
        return { along, scene, sky, behind: along.greaterThan(scene).and(sky.not()) };
      };
      // The last sample in front of the scene and the depth it saw there (the far plane over sky).
      const hit = float(-1).toVar(), front = bool(true).toVar(), lastFront = float(0).toVar(), frontScene = cameraFar.toVar();
      const searches = int(0).toVar();
      Loop(steps, ({ i }) => {
        const t = float(i).add(1).div(steps).toVar();
        const sample = probe(t);
        // A step that lands on a much farther surface (or sky) while deeper than the surface it left passed
        // over that surface's edge and may have been behind it on the way: search the edge as well.
        const edge = sample.along.greaterThan(frontScene).and(sample.scene.greaterThan(frontScene.mul(1 + THICKNESS))).toVar();
        // Only a step from in front to behind (or over an edge) can touch a surface; a ray behind a nearer
        // object keeps marching until it emerges. Searches are capped so skimming rays stay bounded.
        If(front.and(sample.behind.or(edge)).and(searches.lessThan(SEARCHES)), () => {
          searches.addAssign(1);
          const low = lastFront.toVar(), high = t.toVar();
          Loop(REFINEMENTS, () => {
            const middle = low.add(high).mul(.5).toVar(), inner = probe(middle);
            If(inner.behind.or(edge.and(inner.along.greaterThan(frontScene))), () => { high.assign(middle); }).Else(() => { low.assign(middle); });
          });
          // Accept a surface within the thickness plus the depth the ray itself covers across the final
          // bracket, which bisection cannot resolve further; a nearer object's edge lies far outside both.
          const refined = probe(high), span = refined.along.sub(probe(low).along);
          If(refined.behind.and(refined.along.sub(refined.scene).lessThan(refined.scene.mul(THICKNESS).add(span))), () => { hit.assign(high); Break(); });
        });
        front.assign(sample.behind.not());
        If(front, () => { lastFront.assign(t); frontScene.assign(sample.sky.select(cameraFar, sample.scene)); });
      });
      If(hit.greaterThanEqual(0), () => {
        const uv = mix(s0, s1, hit).div(screenSize).toVar();
        const point = mix(q0, q1, hit).div(mix(k0, k1, hit));
        const edges = smoothstep(0, EDGE, min(uv.x, uv.x.oneMinus())).mul(smoothstep(0, EDGE, min(uv.y, uv.y.oneMinus())));
        const range = smoothstep(.7, 1, point.distance(origin).div(maxDistance)).oneMinus();
        // Depth holds only camera-facing surfaces; rays coming back toward the camera would see their backs.
        const facing = smoothstep(0, .5, ray.z).oneMinus();
        color.assign(sceneColor.sample(uv).level(float(0)).rgb);
        confidence.assign(edges.mul(range).mul(facing));
      });
    });
    return vec4(color, confidence);
  })();
  return { color: result.rgb, confidence: result.a };
}

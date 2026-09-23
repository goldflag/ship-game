import { HalfFloatType, LinearFilter, MathUtils, NodeMaterial, NodeUpdateType, QuadMesh, RedFormat, RenderTarget, RendererUtils, TempNode, Vector2, Vector3, Vector4,
  type Camera, type Node, type NodeFrame, type PassNode, type Renderer, type TextureNode } from 'three/webgpu';
import { Fn, If, Loop, ceil, clamp, dot, exp, exp2, float, int, interleavedGradientNoise, length, max, passTexture, perspectiveDepthToViewZ, reference, screenCoordinate,
  select, texture, uniform, uv, vec2, vec4 } from 'three/tsl';

/** The shaft buffers are the drawing buffer divided by this on each axis: shafts are soft, and the blur's cost
 * scales with the pixels it runs on. */
const SCALE = 4;
/** Share of the way to the light the radial blur reaches, and how much of its weight is left at the far end. */
const REACH = .8, FAR_WEIGHT = .1;
/** Screen radius (in screen heights) of the sky around the light that feeds the shafts, and how many of those
 * radii out its Gaussian falloff is taken as zero: only that disc is masked, and rays are marched only inside it. */
const SOURCE_RADIUS = .09, EXTENT = 3;
/** Shaft brightness per unit of light at the sea, at a low sun faced squarely. */
const STRENGTH = .3;
/** Share of that strength left with the sun high: shafts are the golden hour's, subtle at noon. */
const HIGH_SUN = .07;
/** Sun elevations (radians, as the light's y) over which shafts lose that golden-hour strength. */
const LOW_SUN = [Math.sin(8 * Math.PI / 180), Math.sin(40 * Math.PI / 180)] as const;
/** Depth of lit air (m) over which scattered light builds up in front of a surface: 1 − e^(−distance / AIR). */
const AIR = 3000;
/** Gain below which the passes are skipped, and shaft light below which the composite skips the depth read. */
const VISIBLE = 1e-4, FAINT = 2e-4;
/** Fewest samples a pixel's ray takes, however short its stretch inside the source disc. */
const MIN_SAMPLES = 3;

let rendererState: ReturnType<typeof RendererUtils.resetRendererState> | undefined;
const quad = new QuadMesh();
const view = new Vector3(), clip = new Vector4(), size = new Vector2();

/** A read that skips the texture's UV matrix (r185 re-enables it on every `sample` clone). */
function direct<T extends TextureNode>(node: T): T {
  node.updateMatrix = false;
  return node;
}

/** CPU side of the shafts: where the light is on screen and how strongly it shines through. One per part; the
 * node it builds reads these uniforms, so nothing recompiles as the light, camera or tier change. */
export class LightShafts {
  /** Screen position of the light (uv, y down), shaft gain and the most radial samples a ray takes. */
  readonly light = uniform(new Vector2(.5, .5));
  readonly gain = uniform(0);
  readonly samples = uniform(24, 'int');
  /** Width over height of the view, and one texel of the shaft buffers (uv). */
  readonly aspect = uniform(1);
  readonly texel = uniform(new Vector2(1, 1));
  /** The look, live: share of the way to the light the blur reaches, the source's screen radius, and log2 of the
   * weight left at the far end (the weight falls exponentially along the ray, away from the pixel). */
  readonly reach = uniform(REACH);
  readonly source = uniform(SOURCE_RADIUS);
  readonly farLog = uniform(Math.log2(FAR_WEIGHT));
  /** 1 / ∫ weight along the whole ray, so an unoccluded source reads 1 however the ray is clipped. */
  readonly normalise = uniform(1);
  strength = STRENGTH;
  /** False when the shafts are invisible: the passes are skipped and the composite adds nothing. */
  active = false;
  /** Diagnostics: a multiplier on the gain (0 turns the shafts off, as when they are invisible). */
  scale = 1;
  /** The passes behind the latest `compose`, for diagnostics that time them. */
  passes?: ShaftNode;

  constructor(samples: number) {
    this.samples.value = samples;
    this.setLook(REACH, FAR_WEIGHT);
  }

  setSamples(samples: number): void { this.samples.value = samples; }

  /** Reach and far weight together, keeping the normaliser in step. */
  setLook(reach: number, farWeight: number): void {
    this.reach.value = reach;
    this.farLog.value = Math.log2(farWeight);
    this.normalise.value = Math.log(farWeight) / (reach * (farWeight - 1));
  }

  /** Place the light on screen and choose the gain. `direction` is toward the light (world, w = 0): the sun, or the
   * moon at night, whose light at the sea (the colour the composite takes) is some ten times dimmer and so makes faint
   * silver shafts. `submerged` cameras see none: the underwater view has its own light. */
  update(camera: Camera, direction: Vector3, submerged: boolean): void {
    let gain = 0;
    view.copy(direction).transformDirection(camera.matrixWorldInverse);
    if (view.z < 0 && direction.y > -.01 && !submerged) {
      clip.set(view.x, view.y, view.z, 0).applyMatrix4(camera.projectionMatrix);
      const x = clip.x / clip.w, y = clip.y / clip.w;
      this.light.value.set(x * .5 + .5, .5 - y * .5);
      // Fade out as the source disc leaves the screen (its radius in NDC is twice its share of the screen height).
      const beyond = Math.max(Math.abs(x) - 1, Math.abs(y) - 1, 0), disc = 2 * EXTENT * this.source.value;
      const facing = MathUtils.smoothstep(-view.z, .35, .9) * (1 - MathUtils.smoothstep(beyond, 0, disc));
      const low = HIGH_SUN + (1 - HIGH_SUN) * (1 - MathUtils.smoothstep(direction.y, ...LOW_SUN));
      gain = this.strength * this.scale * facing * low * MathUtils.smoothstep(direction.y, -.01, .03);
    }
    this.gain.value = gain;
    this.active = gain > VISIBLE;
  }

  /** `color` with the shafts added: a reduced-resolution occlusion mask (open sky, times the clouds' transmittance,
   * near the light) blurred radially toward the light (Mitchell, GPU Gems 3, 2007), tinted by the light. */
  compose(scenePass: PassNode, visibility: TextureNode | null, color: Node<'vec4'>, lightColor: Node<'vec3'>, reversedDepth: boolean): Node<'vec4'> {
    const depth = scenePass.getTextureNode('depth'), shafts = this.passes = new ShaftNode(this, depth, visibility, reversedDepth);
    // Camera nodes in the output chain belong to its quad camera; read the scene camera's own planes.
    const near = reference('near', 'float', scenePass.camera), far = reference('far', 'float', scenePass.camera);
    return Fn(() => {
      const result = color.toVar();
      If(this.gain.greaterThan(0), () => {
        const shaft = shafts.getTextureNode().sample(uv()).r.mul(this.gain).toVar();
        If(shaft.greaterThan(FAINT), () => {
          // The light scatters in the air in front of each pixel: the sky and the distant sea take it all, a nearby
          // hull almost none, so silhouettes stay dark against the glow instead of veiling over.
          const distance = perspectiveDepthToViewZ(direct(depth.sample(uv())).r, near, far).negate();
          result.assign(vec4(result.rgb.add(lightColor.mul(shaft.mul(float(1).sub(exp(distance.div(-AIR)))))), result.a));
        });
      });
      return result;
    })();
  }

  dispose(): void { this.passes?.dispose(); }
}

/** Renders the mask and the radial blur before the output pass that samples it, once per frame; nothing at all
 * while the shafts are invisible, except once at start-up so both pipelines compile under the loading screen. */
class ShaftNode extends TempNode {
  readonly mask = new RenderTarget(1, 1, { type: HalfFloatType, format: RedFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  readonly blur = new RenderTarget(1, 1, { type: HalfFloatType, format: RedFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  readonly maskMaterial = new NodeMaterial();
  readonly blurMaterial = new NodeMaterial();
  private readonly output: TextureNode;
  private compiled = false;

  constructor(private readonly shafts: LightShafts, private readonly depth: TextureNode, private readonly visibility: TextureNode | null,
    private readonly reversedDepth: boolean) {
    super('vec4');
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.mask.texture.name = 'Light shaft mask'; this.blur.texture.name = 'Light shafts';
    this.maskMaterial.name = 'Light shaft mask'; this.blurMaterial.name = 'Light shafts';
    this.output = passTexture(this as never, this.blur.texture);
  }

  getTextureNode(): TextureNode { return this.output; }

  override updateBefore({ renderer }: NodeFrame): undefined {
    if (!renderer || (!this.shafts.active && this.compiled)) return;
    this.compiled = true;
    this.render(renderer);
  }

  /** The mask, then the radial blur, at the drawing buffer's size over `SCALE`. The mask is drawn only in a square
   * about the source disc; the pass's clear leaves the rest of it zero. */
  render(renderer: Renderer): void {
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.round(size.x / SCALE)), height = Math.max(1, Math.round(size.y / SCALE));
    if (this.mask.width !== width || this.mask.height !== height) { this.mask.setSize(width, height); this.blur.setSize(width, height); }
    const shafts = this.shafts, light = shafts.light.value;
    shafts.aspect.value = width / height;
    shafts.texel.value.set(1 / width, 1 / height);
    // The source disc in mask pixels: a radius in screen heights spans that share of the height on both axes.
    const radius = Math.ceil(EXTENT * shafts.source.value * height) + 2, x = Math.round(light.x * width), y = Math.round(light.y * height);
    const left = MathUtils.clamp(x - radius, 0, width), top = MathUtils.clamp(y - radius, 0, height);
    this.mask.scissor.set(left, top, MathUtils.clamp(x + radius, 0, width) - left, MathUtils.clamp(y + radius, 0, height) - top);
    rendererState = RendererUtils.resetRendererState(renderer, rendererState!);
    renderer.setScissorTest(true);
    quad.material = this.maskMaterial; quad.name = 'Light shaft mask';
    renderer.setRenderTarget(this.mask); quad.render(renderer);
    renderer.setScissorTest(false);
    quad.material = this.blurMaterial; quad.name = 'Light shafts';
    renderer.setRenderTarget(this.blur); quad.render(renderer);
    RendererUtils.restoreRendererState(renderer, rendererState);
  }

  override setup(): TextureNode {
    const { shafts, depth, visibility } = this, reversed = this.reversedDepth;
    // Mask: open sky (the far plane) in four taps across the reduced pixel, times the clouds' transmittance, near the light.
    this.maskMaterial.fragmentNode = Fn(() => {
      const p = uv(), sky = float(0).toVar();
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const z = direct(depth.sample(p.add(vec2(x, y).mul(shafts.texel).mul(.25)))).r;
        sky.addAssign(select(reversed ? z.lessThanEqual(0) : z.greaterThanEqual(1), float(.25), float(0)));
      }
      const open = visibility ? sky.mul(direct(visibility.sample(p)).r) : sky;
      const offset = p.sub(shafts.light).mul(vec2(shafts.aspect, 1));
      return vec4(open.mul(exp(dot(offset, offset).div(shafts.source.mul(shafts.source).negate()))), 0, 0, 1);
    })();
    this.maskMaterial.needsUpdate = true;
    // Radial blur toward the light, weighted to fall off exponentially along the ray, over only the stretch of the
    // ray inside the source disc (the mask is zero elsewhere): short stretches take few samples, and every sample
    // counts. Jittered per pixel so the steps read as fine grain rather than bands. A plain texture node: a pass
    // texture of this node would rebuild it inside its own blur material.
    const mask = texture(this.mask.texture);
    this.blurMaterial.fragmentNode = Fn(() => {
      const p = uv(), toLight = shafts.light.sub(p).toVar();
      const distance = length(toLight.mul(vec2(shafts.aspect, 1)));
      const enter = max(float(0), float(1).sub(shafts.source.mul(EXTENT).div(max(distance, 1e-5))));
      const span = shafts.reach.sub(enter).toVar(), sum = float(0).toVar();
      If(span.greaterThan(0), () => {
        const count = int(clamp(ceil(float(shafts.samples).mul(span).div(shafts.reach)), MIN_SAMPLES, float(shafts.samples))).toVar();
        const dt = span.div(float(count)).toVar();
        const t = enter.add(dt.mul(interleavedGradientNoise(screenCoordinate))).toVar();
        const weight = exp2(shafts.farLog.mul(t).div(shafts.reach)).toVar(), fall = exp2(shafts.farLog.mul(dt).div(shafts.reach)).toVar();
        Loop({ start: int(0), end: count, type: 'int' }, () => {
          const at = p.add(toLight.mul(t));
          const inside = at.x.greaterThanEqual(0).and(at.x.lessThanEqual(1)).and(at.y.greaterThanEqual(0)).and(at.y.lessThanEqual(1));
          sum.addAssign(select(inside, direct(mask.sample(at)).r, float(0)).mul(weight));
          weight.mulAssign(fall);
          t.addAssign(dt);
        });
        sum.mulAssign(dt.mul(shafts.normalise));
      });
      return vec4(sum, 0, 0, 1);
    })();
    this.blurMaterial.needsUpdate = true;
    return this.output;
  }

  override dispose(): void {
    this.mask.dispose(); this.blur.dispose(); this.maskMaterial.dispose(); this.blurMaterial.dispose();
    super.dispose();
  }
}

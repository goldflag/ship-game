import * as THREE from 'three/webgpu';
import {
  Fn, If, add, convertToTexture, drawIndex, float, getViewPosition, instanceIndex, int, ivec2, luminance, mat4, max, mix, modelWorldMatrix, mrt, output,
  passTexture, positionGeometry, positionLocal, renderGroup, texture, textureLoad, textureSize, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';

type Node<T extends string = string> = THREE.Node<T>;
type Builder = THREE.NodeBuilder;
type Batched = THREE.BatchedMesh & { _matricesTexture: THREE.DataTexture; _indirectTexture: THREE.DataTexture };

/** Name of the scene pass target that carries object motion. */
export const MOTION_OUTPUT = 'motion';

/** Opt a mesh out of temporal history: its pixels keep the current frame alone. Use it
 * for objects whose motion the history cannot follow, such as instanced shells whose
 * instances move independently of the mesh, and bright tracers. */
export function rejectTemporalHistory(object: THREE.Object3D): void { object.userData.temporalResponse = 1; }

/** Least weight of the current frame on Water Pro's surface. Its waves move through the
 * world, so reprojecting them as static smears their detail; the sea keeps its MSAA frame. */
export const WATER_RESPONSE = 1;

/** Least weight of the current frame a surface asks for, 0 (full history) to 1 (none). */
function temporalResponse(object: THREE.Object3D, material: THREE.Material): number {
  const response = object.userData?.temporalResponse ?? material.userData?.temporalResponse;
  if (typeof response === 'number') return response;
  return 'waterPositionNode' in material ? WATER_RESPONSE : 0;
}

const halton = (index: number, base: number) => {
  let fraction = 1, result = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) { fraction /= base; result += fraction * (i % base); }
  return result;
};
/** Sub-pixel camera offsets, in pixels about the pixel centre. */
const JITTER = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - .5, halton(i + 1, 3) - .5] as const);

const quad = new THREE.QuadMesh();
/** Width in texels of a data texture, as the batch node reads it. */
const width = (map: THREE.Texture) => int((textureSize(textureLoad(map), int(0)) as unknown as Node<'ivec2'>).x);
const drawingSize = new THREE.Vector2();
let rendererState: ReturnType<typeof THREE.RendererUtils.resetRendererState> | undefined;

/** Previous-frame world matrices, tracked once per frame for any object drawn in the scene pass. */
type ObjectHistory = { frame: number; previous: THREE.Matrix4; current: THREE.Matrix4 };
/** Previous-frame pose texture of a batched mesh, refreshed on the GPU after the frame. */
type BatchHistory = { matrices: THREE.DataTexture };

/** Motion of the drawn surface relative to the static world, in the previous frame's NDC.
 * Camera motion is not included: the resolve reconstructs it from depth for every pixel,
 * including the sky, water and anything that writes no motion. Transparent surfaces leave
 * the motion below them alone and add only their response (see `temporalResponse`). */
class ObjectMotionNode extends THREE.TempNode {
  private readonly previousModelWorld = uniform(new THREE.Matrix4());
  private readonly objects = new WeakMap<THREE.Object3D, ObjectHistory>();

  constructor(private readonly taa: TemporalAntialiasing) {
    super('vec4');
    this.updateType = THREE.NodeUpdateType.OBJECT;
  }

  override update({ object }: THREE.NodeFrame): undefined {
    if (!object) return;
    const frame = this.taa.frame;
    let history = this.objects.get(object);
    if (!history) this.objects.set(object, history = { frame, previous: object.matrixWorld.clone(), current: object.matrixWorld.clone() });
    if (history.frame !== frame) {
      // An object that skipped a frame starts again from its current pose.
      history.previous.copy(history.frame === frame - 1 ? history.current : object.matrixWorld);
      history.current.copy(object.matrixWorld);
      history.frame = frame;
    }
    this.previousModelWorld.value.copy(history.previous);
    if ((object as THREE.BatchedMesh).isBatchedMesh) this.taa.touchBatch(object as Batched);
  }

  override setup(builder: Builder): Node<'vec4'> {
    const object = builder.object as THREE.Object3D & Partial<THREE.Mesh>;
    const material = builder.material as THREE.NodeMaterial;
    const reject = float(temporalResponse(object, material));
    // Keep what is below; the sea and tracers add only their response.
    if (material.transparent) return vec4(0, 0, reject, 0);
    if (material.vertexNode || !object.isMesh) return vec4(0, 0, reject, 1);
    let previousLocal: Node<'vec4'>;
    if ((object as THREE.BatchedMesh).isBatchedMesh) {
      // Replays Three's batch node with the previous frame's pose texture.
      const batched = object as unknown as Batched, previous = this.taa.batchHistory(batched).matrices;
      const id = int((builder as Builder & { getDrawIndex(): unknown }).getDrawIndex() === null ? instanceIndex : drawIndex);
      const indirect = batched._indirectTexture;
      const indirectSize = width(indirect);
      const pose = int(textureLoad(indirect, ivec2(id.mod(indirectSize), id.div(indirectSize))).x);
      const size = width(previous), j = pose.mul(4);
      const x = j.mod(size), y = j.div(size);
      const matrix = mat4(textureLoad(previous, ivec2(x, y)), textureLoad(previous, ivec2(x.add(1), y)),
        textureLoad(previous, ivec2(x.add(2), y)), textureLoad(previous, ivec2(x.add(3), y)));
      previousLocal = matrix.mul(vec4(positionGeometry, 1)) as Node<'vec4'>;
    } else {
      // Instances and vertex displacement move with their mesh.
      previousLocal = vec4(positionLocal, 1);
    }
    const project = this.taa.previousViewProjection;
    const current = varying(project.mul(modelWorldMatrix.mul(vec4(positionLocal, 1))), 'vMotionCurrent') as Node<'vec4'>;
    const previous = varying(project.mul(this.previousModelWorld.mul(previousLocal)), 'vMotionPrevious') as Node<'vec4'>;
    return vec4(current.xy.div(current.w).sub(previous.xy.div(previous.w)), reject, 1);
  }
}

/** Temporal anti-aliasing over the composited display frame, on top of the scene's MSAA.
 *
 * The camera takes a Halton sub-pixel offset each frame, and a resolve pass blends the
 * frame into a reprojected history with variance clipping, after three's TRAA. Unlike
 * TRAA it keeps MSAA: the multisampled scene depth cannot be copied, so the history
 * carries its own view depth in alpha for the disocclusion test. Every pixel's camera
 * motion comes from depth; moving meshes (ships, including fleet batches through their
 * previous pose texture) add object motion from the scene pass's `motion` target. The
 * sea, tracers, independently moving instances and disocclusions show the current frame. */
export class TemporalAntialiasing {
  /** Frames drawn with jitter; object motion is tracked against it. */
  frame = 0;
  /** Take no history while set: for layers composited without scene depth, such as the
   * port's armor overlay, whose pixels the depth-based reprojection cannot follow. */
  suspended = false;
  readonly previousViewProjection = uniform(new THREE.Matrix4()).setGroup(renderGroup);
  private readonly currentViewProjection = uniform(new THREE.Matrix4());
  private readonly projectionInverse = uniform(new THREE.Matrix4());
  private readonly cameraWorld = uniform(new THREE.Matrix4());
  private readonly unjittered = new THREE.Matrix4();
  private jitterIndex = 0;
  private hasHistory = false;
  private readonly batches = new WeakMap<Batched, BatchHistory>();
  private readonly touched = new Set<Batched>();
  private resolveNode?: TemporalResolveNode;
  readonly motion: ObjectMotionNode;
  readonly mrt: THREE.MRTNode;
  /** Weight of the current frame with a still camera; 1/20 converges in about a third of a second. */
  readonly minimumWeight = uniform(.06);
  /** Pixel speed at which the current frame fully replaces history. */
  readonly maxVelocityPx = uniform(96);
  /** Relative change of view depth beyond which history belongs to another surface. */
  readonly depthTolerance = uniform(.05);

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.motion = new ObjectMotionNode(this);
    const blend = new THREE.BlendMode(THREE.CustomBlending);
    // Opaque motion (alpha 1) replaces; transparent (alpha 0) adds its rejection only.
    blend.blendSrc = blend.blendSrcAlpha = THREE.OneFactor;
    blend.blendDst = blend.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.mrt = mrt({ output: output, [MOTION_OUTPUT]: this.motion }).setBlendMode(MOTION_OUTPUT, blend);
  }

  batchHistory(batched: Batched): BatchHistory {
    let history = this.batches.get(batched);
    if (!history) {
      const source = batched._matricesTexture, image = source.image as { data: Float32Array; width: number; height: number };
      const matrices = new THREE.DataTexture(image.data.slice(), image.width, image.height, THREE.RGBAFormat, THREE.FloatType);
      matrices.name = 'Previous batch poses'; matrices.needsUpdate = true;
      history = { matrices };
      this.batches.set(batched, history);
      source.addEventListener('dispose', () => matrices.dispose());
    }
    return history;
  }

  touchBatch(batched: Batched): void { this.touched.add(batched); }

  /** Forget history, e.g. after a scene change. */
  reset(): void { this.hasHistory = false; }

  /** The resolved frame, a texture the display pass can filter further. Its alpha holds
   * view depth, negative where the pixel took no history. Replaces any earlier resolve. */
  resolve(beauty: Node<'vec4'>, depth: THREE.TextureNode, motion: THREE.TextureNode): THREE.TextureNode {
    this.resolveNode?.dispose();
    this.resolveNode = new TemporalResolveNode(this, convertToTexture(beauty) as THREE.TextureNode, depth, motion);
    return this.resolveNode.getTextureNode();
  }

  /** Release the resolve targets; per-batch pose textures go with their batches. */
  release(): void { this.resolveNode?.dispose(); this.resolveNode = undefined; }

  /** Jitter the camera for the pipeline's renders and advance the view history. */
  begin(width: number, height: number): void {
    const camera = this.camera;
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const next = this.unjittered.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.previousViewProjection.value.copy(this.hasHistory ? this.currentViewProjection.value : next);
    this.currentViewProjection.value.copy(next);
    const [x, y] = JITTER[this.jitterIndex];
    camera.setViewOffset(width, height, x, y, width, height);
    this.frame++;
  }

  end(): void {
    this.camera.clearViewOffset();
    this.jitterIndex = (this.jitterIndex + 1) % JITTER.length;
    this.hasHistory = true;
  }

  /** Resolve-time uniforms: the jittered camera the depth was drawn with. */
  syncCamera(): void {
    this.projectionInverse.value.copy(this.camera.projectionMatrixInverse);
    this.cameraWorld.value.copy(this.camera.matrixWorld);
  }

  /** After the scene pass: this frame's fleet poses become next frame's previous poses. */
  storeBatchPoses(renderer: THREE.Renderer): void {
    for (const batched of this.touched) {
      const source = batched._matricesTexture, history = this.batchHistory(batched);
      const image = source.image as { data: Float32Array; width: number; height: number };
      const target = history.matrices.image as { data: Float32Array; width: number; height: number };
      if (target.width !== image.width || target.height !== image.height) {
        history.matrices.image = { data: image.data.slice(), width: image.width, height: image.height };
        history.matrices.needsUpdate = true;
      } else renderer.copyTextureToTexture(source, history.matrices);
    }
    this.touched.clear();
  }

  get uniforms() {
    return { current: this.currentViewProjection, previous: this.previousViewProjection, projectionInverse: this.projectionInverse, cameraWorld: this.cameraWorld };
  }
  get historyValid(): boolean { return this.hasHistory; }
}

/** Blend of the current frame into reprojected history (after three's TRAANode). */
class TemporalResolveNode extends THREE.TempNode {
  private readonly history = new THREE.RenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType });
  private readonly target = new THREE.RenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType });
  private readonly material = new THREE.NodeMaterial();
  private readonly output: THREE.TextureNode;
  private readonly inverseSize = uniform(new THREE.Vector2());
  private readonly historyWeight = uniform(0);

  constructor(private readonly taa: TemporalAntialiasing, private readonly beauty: THREE.TextureNode,
    private readonly depth: THREE.TextureNode, private readonly motion: THREE.TextureNode) {
    super('vec4');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    this.history.texture.name = 'Temporal AA history';
    this.target.texture.name = 'Temporal AA resolve';
    this.material.name = 'Temporal AA resolve';
    this.output = passTexture(this as never, this.target.texture);
  }

  getTextureNode(): THREE.TextureNode { return this.output; }

  override updateBefore({ renderer }: THREE.NodeFrame): undefined {
    if (!renderer) return;
    this.taa.syncCamera();
    const source = (this.beauty as unknown as { renderTarget: THREE.RenderTarget }).renderTarget;
    const { width, height } = source.texture.image as { width: number; height: number };
    rendererState = THREE.RendererUtils.resetRendererState(renderer, rendererState!);
    const restart = this.history.width !== width || this.history.height !== height || !this.taa.historyValid || this.taa.suspended;
    if (this.history.width !== width || this.history.height !== height) {
      this.history.setSize(width, height); this.target.setSize(width, height);
      renderer.initRenderTarget(this.history); renderer.initRenderTarget(this.target);
    }
    this.inverseSize.value.set(1 / width, 1 / height);
    this.historyWeight.value = restart ? 0 : 1;
    quad.material = this.material; quad.name = 'Temporal AA';
    renderer.setRenderTarget(this.target);
    quad.render(renderer);
    renderer.setRenderTarget(null);
    renderer.copyTextureToTexture(this.target.texture, this.history.texture);
    this.taa.storeBatchPoses(renderer);
    THREE.RendererUtils.restoreRendererState(renderer, rendererState);
  }

  override setup(builder: Builder): THREE.TextureNode {
    const pipeline = (builder.context as { renderPipeline?: THREE.RenderPipeline }).renderPipeline;
    if (pipeline) {
      const context = (pipeline as unknown as { context: { onBeforeRenderPipeline?: () => void; onAfterRenderPipeline?: () => void } }).context;
      context.onBeforeRenderPipeline = () => {
        const size = builder.renderer.getDrawingBufferSize(drawingSize);
        this.taa.begin(size.width, size.height);
      };
      context.onAfterRenderPipeline = () => this.taa.end();
    }
    const reversed = builder.renderer.reversedDepthBuffer === true;
    const { current, previous, projectionInverse, cameraWorld } = this.taa.uniforms;
    const beauty = this.beauty, depth = this.depth, motion = this.motion;
    const historyTexture = texture(this.history.texture);

    // Nearest depth in the 3×3 neighbourhood: edges take the foreground's motion.
    const nearest = Fn(([texel]: [Node<'vec2'>]) => {
      const closest = float(2).toVar(), closestTexel = vec2(texel).toVar();
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
        const neighbour = texel.add(vec2(x, y)).toVar();
        const raw = depth.load(neighbour).r;
        const value = (reversed ? raw.oneMinus() : raw).toVar();
        If(value.lessThan(closest), () => { closest.assign(value); closestTexel.assign(neighbour); });
      }
      return closestTexel;
    });

    // Clip history toward the neighbourhood's colour box (Playdead's AABB clip).
    const clipAABB = (historyColor: Node<'vec3'>, low: Node<'vec3'>, high: Node<'vec3'>) => {
      const centre = high.add(low).mul(.5);
      const extent = high.sub(low).mul(.5).add(1e-5);
      const offset = historyColor.sub(centre);
      const unit = offset.div(extent).abs();
      const largest = max(unit.x, unit.y, unit.z);
      return largest.greaterThan(1).select(centre.add(offset.div(largest)), historyColor);
    };

    // Variance clipping over the 3×3 neighbourhood of the current frame.
    const varianceClip = (texel: Node<'vec2'>, currentColor: Node<'vec3'>, historyColor: Node<'vec3'>, gamma: Node<'float'>) => {
      const moment1 = vec3(currentColor).toVar(), moment2 = currentColor.pow2().toVar();
      for (const [x, y] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [1, 0], [0, -1], [0, 1], [-1, 0]]) {
        const neighbour = beauty.offset(ivec2(x, y)).load(texel).rgb.max(0);
        moment1.addAssign(neighbour); moment2.addAssign(neighbour.pow2());
      }
      const mean = moment1.div(9);
      const deviation = moment2.div(9).sub(mean.pow2()).max(0).sqrt().mul(gamma);
      return clipAABB(historyColor, mean.sub(deviation), mean.add(deviation));
    };

    // Five bilinear taps of a Catmull-Rom filter: resampling the history every frame with a
    // plain bilinear tap blurs it within a few frames of camera motion.
    const catmullRom = (coord: Node<'vec2'>, size: Node<'vec2'>) => {
      const position = coord.mul(size);
      const centre = position.sub(.5).floor().add(.5);
      const f = position.sub(centre);
      const w0 = f.mul(f.mul(f.mul(-.5).add(1)).sub(.5));
      const w1 = f.mul(f).mul(f.mul(1.5).sub(2.5)).add(1);
      const w2 = f.mul(f.mul(f.mul(-1.5).add(2)).add(.5));
      const w3 = f.mul(f).mul(f.mul(.5).sub(.5));
      const w12 = w1.add(w2);
      const t0 = centre.sub(1).div(size), t3 = centre.add(2).div(size), t12 = centre.add(w2.div(w12)).div(size);
      const tap = (x: Node<'float'>, y: Node<'float'>) => historyTexture.sample(vec2(x, y)).rgb;
      const a = w12.x.mul(w0.y), b = w0.x.mul(w12.y), c = w12.x.mul(w12.y), d = w3.x.mul(w12.y), e = w12.x.mul(w3.y);
      const sum = tap(t12.x, t0.y).mul(a).add(tap(t0.x, t12.y).mul(b)).add(tap(t12.x, t12.y).mul(c))
        .add(tap(t3.x, t12.y).mul(d)).add(tap(t12.x, t3.y).mul(e));
      return sum.div(a.add(b).add(c).add(d).add(e)).max(0);
    };

    const resolve = Fn(() => {
      const coord = uv();
      const size = vec2(beauty.size(int(0)) as unknown as Node<'ivec2'>);
      const texel = coord.mul(size);
      const closestTexel = nearest(texel);
      // Camera motion of the nearest surface, from its depth in this (jittered) frame.
      const closestUv = closestTexel.mul(this.inverseSize);
      const view = getViewPosition(closestUv, depth.load(closestTexel).r, projectionInverse).toVar();
      const world = cameraWorld.mul(vec4(view, 1));
      const now = current.mul(world).toVar(), before = previous.mul(world).toVar();
      const surface = motion.load(closestTexel);
      const velocity = now.xy.div(now.w).sub(before.xy.div(before.w)).add(surface.xy).toVar();
      const historyUv = coord.sub(velocity.mul(vec2(.5, -.5))).toVar();
      const inside = historyUv.greaterThanEqual(0).all().and(historyUv.lessThanEqual(1).all());
      const response = max(surface.z, motion.load(texel).z).saturate().toVar();
      const rejected = response.greaterThan(.99);
      // The history keeps each pixel's nearest view depth in alpha. A surface that was not
      // where this one now reprojects to (it was hidden, or something has moved off it)
      // takes no history: clipping alone leaves trails beside thin rigging under parallax.
      const previousDepth = historyTexture.load(historyUv.mul(size)).a.abs();
      const expectedDepth = before.w;
      const disoccluded = previousDepth.sub(expectedDepth).abs().greaterThan(expectedDepth.mul(this.taa.depthTolerance));
      const valid = inside.and(rejected.not()).and(disoccluded.not()).and(this.historyWeight.greaterThan(.5));

      const currentColor = beauty.sample(coord).rgb.toVar();
      const historyColor = catmullRom(historyUv, size).toVar();
      const motionFactor = velocity.mul(.5).mul(size).length().div(this.taa.maxVelocityPx).saturate();
      const weight = valid.select(max(this.taa.minimumWeight.add(motionFactor), response).saturate(), float(1)).toVar();
      const gamma = mix(.75, 1.25, motionFactor.oneMinus().pow2());
      const clipped = varianceClip(texel, currentColor, historyColor, gamma);
      // Luminance weighting keeps bright specks from flickering or smearing.
      const a = weight.div(luminance(currentColor).add(1)), b = weight.oneMinus().div(luminance(clipped).add(1));
      const color = add(currentColor.mul(a), clipped.mul(b)).div(max(a.add(b), 1e-5)).toVar();
      // Pixels that took no history carry a negative depth: the display pass smooths their
      // edges spatially instead, as it would without temporal AA.
      return vec4(color, valid.select(view.z.negate(), view.z));
    });
    // A colour node would have its alpha forced to 1 on an opaque material; alpha carries depth.
    this.material.fragmentNode = resolve();
    this.material.needsUpdate = true;
    return this.output;
  }

  override dispose(): void {
    this.history.dispose(); this.target.dispose(); this.material.dispose();
    super.dispose();
  }
}

/** A material that writes its own fragment output (`fragmentNode`) otherwise emits one
 * colour; a pass with extra targets then has no value for them and the pipeline fails.
 * This keeps its colour (fogged as before) and leaves every other target below it alone. */
export function writeSceneTargets<T extends THREE.NodeMaterial>(material: T): T {
  const setupOutput = material.setupOutput.bind(material);
  material.setupOutput = (builder: Builder, outputNode: Node<'vec4'>) => {
    const color = setupOutput(builder, outputNode);
    const targets = builder.renderer.getMRT() as THREE.MRTNode | null;
    if (!targets || !builder.renderer.getRenderTarget()) return color;
    const outputs: Record<string, Node<string>> = {};
    for (const name of Object.keys((targets as unknown as { outputNodes: Record<string, unknown> }).outputNodes)) outputs[name] = name === 'output' ? color as Node<'vec4'> : vec4(0);
    return mrt(outputs) as unknown as Node<'vec4'>;
  };
  return material;
}

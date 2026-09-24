import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { AmbientOcclusion } from './graphicsSettings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any; // TSL graphs: three's typings do not follow these chains.
const {
  Fn, If, Loop, PI, abs, acos, add, clamp, cos, cross, div, dot, float, getScreenPosition, getViewPosition, int, materialAO,
  max, min, mix, mul, normalize, pow, screenUV, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} = TSL as unknown as Record<string, N>;

/** Ship surfaces that occlude one another. Ships enable it beside the default layer, so
 * the main view is unaffected; only the occlusion prepass renders this layer alone. */
export const SHIP_OCCLUSION_LAYER = 20;

/** Horizon steps each way along each of three slices: 24 or 48 depth taps per pixel. Both tiers search the same radius;
 * High samples it twice as densely. */
const STEPS: Record<Exclude<AmbientOcclusion, 'off'>, number> = { low: 4, high: 8 };

const drawingSize = new THREE.Vector2();

/* Ambient occlusion between a ship's own parts, applied to indirect light only.
 *
 * Each frame, before the ocean captures and the scene pass, the ships alone (their
 * occlusion layer) are drawn depth-only at half resolution. A horizon-based pass (GTAO,
 * as in three's GTAONode) turns that depth into occlusion, and a depth-aware 5×5 blur
 * removes its rotation noise. Every ship material samples the result at its screen
 * position through `aoNode`, which three's lighting multiplies into the indirect
 * diffuse and specular terms (hemisphere fill and sky light) and never into the sun.
 *
 * Drawing only the ships keeps the sea, sky and islands out of the occluders, so the
 * waterline does not darken, and nothing else in the scene samples the result.
 *
 * Three's GTAONode cannot read this game's scene depth: it sizes the depth texture
 * with textureSize(), which is invalid WGSL for the scene pass's 4× multisampled
 * depth, and it assumes far depth is 1 where the reversed buffer stores 0. */
export class ShipOcclusion {
  /** Search radius in world meters: the gap between two deckhouses, the depth under a platform or bridge wing, the foot of
   * a tower, whose sky the fill would otherwise take as open. The steps crowd toward the pixel (`distanceExponent`), so
   * the nearest still fall within half a meter and draw a barbette's or an AA tub's crease as the former 3.5 m did. */
  readonly radius = uniform(8);
  /** Depth window, in meters, beyond which a sample stops counting as an occluder. Thin
   * shield walls and railings in front of a deck would otherwise shade it like a wall. */
  readonly thickness = uniform(5);
  readonly distanceExponent = uniform(2);
  /** How far a step's horizon counts less the further out it lies: at 1, from all of it near the pixel to half at the
   * radius, by the step's share of the steps, so both tiers weigh an occluder at the same distance alike. */
  readonly distanceFallOff = uniform(1);
  /** Exponent on the occlusion term. */
  readonly scale = uniform(1.45);
  /** View distance (m) over which the effect fades: past it a ship covers too few pixels
   * for meter-scale occlusion and fog dominates its colour. */
  readonly fadeStart = uniform(900);
  readonly fadeEnd = uniform(2200);
  private readonly steps = uniform(STEPS.low);
  private readonly resolution = uniform(new THREE.Vector2(1, 1));
  private readonly projection: N;
  private readonly projectionInverse: N;
  /** Projection elements [2][2] and [3][2], for view depth in the filter. */
  private readonly depthToZ = uniform(new THREE.Vector2());

  private readonly depthTarget = new THREE.RenderTarget(1, 1, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthTexture: new THREE.DepthTexture(1, 1) });
  private readonly rawTarget = new THREE.RenderTarget(1, 1, { depthBuffer: false, format: THREE.RedFormat, type: THREE.HalfFloatType });
  private readonly acrossTarget = new THREE.RenderTarget(1, 1, { depthBuffer: false, format: THREE.RedFormat, type: THREE.HalfFloatType });
  private readonly blurTarget = new THREE.RenderTarget(1, 1, { depthBuffer: false, format: THREE.RedFormat, type: THREE.HalfFloatType });
  private readonly depthMaterial = new THREE.NodeMaterial();
  private readonly aoMaterial = new THREE.NodeMaterial();
  private readonly acrossMaterial = new THREE.NodeMaterial();
  private readonly blurMaterial = new THREE.NodeMaterial();
  private readonly quad = new THREE.QuadMesh();
  /** One node for every receiving material, created once; a second multiplies a baked aoMap. */
  private readonly aoNode: N;
  private readonly aoMapNode: N;
  private readonly receivers = new Set<THREE.MeshStandardNodeMaterial>();
  private state?: ReturnType<typeof THREE.RendererUtils.resetRendererState>;
  private level: AmbientOcclusion = 'off';

  /** A perspective camera, as the game's, or an orthographic one (the model viewer's), whose view rays are parallel. */
  constructor(private readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, reversedDepth: boolean) {
    const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    this.projection = uniform(camera.projectionMatrix);
    this.projectionInverse = uniform(camera.projectionMatrixInverse);
    this.depthTarget.texture.name = 'Ship occlusion depth';
    // The reversed buffer is only precise in floating point, as three's own passes use.
    this.depthTarget.depthTexture!.type = THREE.FloatType;
    this.rawTarget.texture.name = 'Ship occlusion';
    this.blurTarget.texture.name = 'Ship occlusion (filtered)';
    this.blurTarget.texture.minFilter = this.blurTarget.texture.magFilter = THREE.LinearFilter;

    // Depth only, both faces: single-sheet shields and tub walls must occlude from either side.
    // No blending: the one-channel target has no alpha for a blend to read.
    Object.assign(this.depthMaterial, { name: 'Ship occlusion depth', colorWrite: false, blending: THREE.NoBlending, side: THREE.DoubleSide, fog: false, lights: false });
    this.depthMaterial.fragmentNode = vec4(0);

    const depth = this.depthTarget.depthTexture!;
    const depthAt = (at: N): N => texture(depth, clamp(at, vec2(0), vec2(1))).r;
    const viewAt = (at: N, d: N): N => getViewPosition(at, d, this.projectionInverse);
    // Depth to view z without the full inverse: z = -P[3][2] / (d + P[2][2]) in perspective,
    // z = (d - P[3][2]) / P[2][2] in an orthographic projection.
    const viewZ = (d: N): N => orthographic ? d.sub(this.depthToZ.y).div(this.depthToZ.x) : this.depthToZ.y.negate().div(d.add(this.depthToZ.x));
    const isEmpty = (d: N): N => reversedDepth ? d.lessThanEqual(0) : d.greaterThanEqual(1);
    const noise = texture(magicSquareNoise());

    this.aoMaterial.name = 'Ship occlusion';
    this.aoMaterial.fragmentNode = Fn(() => {
      const at = uv();
      const d = depthAt(at).toVar();
      isEmpty(d).discard();
      const position = viewAt(at, d).toVar();
      position.z.negate().greaterThan(this.fadeEnd).discard();
      const texel = vec2(1).div(this.resolution);
      // Normals from depth: per axis, the neighbour nearer in depth, so a silhouette does
      // not tilt the normal of the surface in front of it.
      const dx = vec2(texel.x, 0), dy = vec2(0, texel.y);
      const l = depthAt(at.sub(dx)), r = depthAt(at.add(dx)), b = depthAt(at.add(dy)), t = depthAt(at.sub(dy));
      const dpdx = abs(l.sub(d)).lessThan(abs(r.sub(d))).select(position.sub(viewAt(at.sub(dx), l)), viewAt(at.add(dx), r).sub(position));
      const dpdy = abs(b.sub(d)).lessThan(abs(t.sub(d))).select(position.sub(viewAt(at.add(dy), b)), viewAt(at.sub(dy), t).sub(position));
      const normal = normalize(cross(dpdx, dpdy)).toVar();

      const rotation = noise.sample(vec2(at.x, at.y.oneMinus()).mul(this.resolution.div(5)));
      const random = rotation.xyz.mul(2).sub(1);
      const tangent = vec3(random.xy, 0).normalize();
      const bitangent = vec3(tangent.y.negate(), tangent.x, 0);
      const directions = int(3), steps = int(this.steps).toVar();
      const viewDir = (orthographic ? vec3(0, 0, 1) : normalize(position.negate())).toVar();
      const ao = float(0).toVar();

      Loop({ start: int(0), end: directions, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
        const angle = float(i).div(3).mul(PI);
        const sampleDir = normalize(tangent.mul(cos(angle)).add(bitangent.mul(sin(angle)))).toVar();
        const jitter = add(.5, mul(.5, rotation.w));
        const sliceBitangent = normalize(cross(sampleDir, viewDir)).toVar();
        const sliceTangent = cross(sliceBitangent, viewDir).toVar();
        const projected = normal.sub(sliceBitangent.mul(dot(normal, sliceBitangent))).toVar();
        const projectedLength = projected.length().toVar();
        const projN = projected.div(max(projectedLength, .0001)).toVar();
        const nSin = dot(projN, sliceTangent).toVar();
        const nCos = clamp(dot(projN, viewDir), 0, 1).toVar();
        const angleN = nSin.greaterThanEqual(0).select(float(1), float(-1)).mul(acos(nCos)).toVar();
        const inSlice = cross(projN, sliceBitangent).toVar();
        const cosHorizons = vec2(dot(viewDir, inSlice), dot(viewDir, inSlice.negate())).toVar();

        Loop({ end: steps, type: 'int', name: 'j', condition: '<' }, ({ j }: { j: N }) => {
          const offset = sampleDir.mul(this.radius).mul(jitter).mul(pow(div(float(j).add(1), float(steps)), this.distanceExponent));
          const falloff = mix(1, min(1, float(2).div(float(j).add(1).div(float(steps)).mul(3).add(1))), this.distanceFallOff);
          for (const [sign, side] of [[1, 'x'], [-1, 'y']] as const) {
            const screen = getScreenPosition(position.add(offset.mul(sign)), this.projection).toVar();
            const sampleDepth = depthAt(screen);
            const delta = viewAt(screen, sampleDepth).sub(position).toVar();
            If(abs(delta.z).lessThan(this.thickness).and(isEmpty(sampleDepth).not()), () => {
              cosHorizons[side].addAssign(max(0, dot(viewDir, normalize(delta)).sub(cosHorizons[side]).mul(falloff)));
            });
          }
        });

        // Cosine-weighted slice integral (Activision GTAO, eq. 7), as in three's GTAONode.
        const hPos = acos(clamp(cosHorizons.y, -1, 1)).toVar();
        const hNeg = acos(clamp(cosHorizons.x, -1, 1)).negate().toVar();
        const termPos = cos(hPos.mul(2).sub(angleN)).negate().add(nCos).add(hPos.mul(2).mul(nSin));
        const termNeg = cos(hNeg.mul(2).sub(angleN)).negate().add(nCos).add(hNeg.mul(2).mul(nSin));
        ao.addAssign(projectedLength.mul(termPos.add(termNeg).mul(.25)));
      });

      const occlusion = pow(clamp(ao.div(3), 0, 1), this.scale);
      return vec4(mix(occlusion, 1, smoothstep(this.fadeStart, this.fadeEnd, position.z.negate())), 0, 0, 1);
    })();

    // A 5-tap pass across, then one down: together a 5×5 box at occlusion resolution, which
    // cancels the 5×5 rotation pattern exactly. Taps across a depth step (a turret against
    // the deck behind it) are left out.
    const filter = (source: THREE.Texture, step: THREE.Vector2) => Fn(() => {
      const at = uv();
      const d = depthAt(at).toVar();
      isEmpty(d).discard();
      const centre = viewZ(d).toVar();
      centre.negate().greaterThan(this.fadeEnd).discard();
      const tolerance = max(abs(centre).mul(.02), .3);
      const offset = vec2(step).div(this.resolution);
      const input = texture(source);
      const sum = float(0).toVar(), weight = float(0).toVar();
      for (let i = -2; i <= 2; i++) {
        const tap = at.add(offset.mul(i));
        const w = max(0, float(1).sub(abs(viewZ(depthAt(tap)).sub(centre)).div(tolerance)));
        sum.addAssign(input.sample(tap).r.mul(w)); weight.addAssign(w);
      }
      return vec4(sum.div(max(weight, .0001)), 0, 0, 1);
    })();
    this.acrossMaterial.name = 'Ship occlusion filter (across)';
    this.acrossMaterial.fragmentNode = filter(this.rawTarget.texture, new THREE.Vector2(1, 0));
    this.blurMaterial.name = 'Ship occlusion filter (down)';
    this.blurMaterial.fragmentNode = filter(this.acrossTarget.texture, new THREE.Vector2(0, 1));

    const occlusion = texture(this.blurTarget.texture, screenUV).r;
    this.aoNode = occlusion;
    this.aoMapNode = occlusion.mul(materialAO);
  }

  /** Put a ship model's opaque surfaces on the occlusion layer and let its lit materials
   * receive occlusion. Call on the template before it is batched or cloned. */
  adopt(root: THREE.Object3D): void {
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const material = mesh.material as THREE.Material & { positionNode?: unknown; isMeshStandardNodeMaterial?: boolean };
      // A vertex-animated surface would draw in its rest pose here; transparent ones are not solid.
      if (material.transparent || material.positionNode) return;
      mesh.layers.enable(SHIP_OCCLUSION_LAYER);
      if (material.isMeshStandardNodeMaterial && !this.receivers.has(material as THREE.MeshStandardNodeMaterial)) {
        this.receivers.add(material as THREE.MeshStandardNodeMaterial);
        this.connect(material as THREE.MeshStandardNodeMaterial);
      }
    });
  }

  /** Off leaves every material and pass exactly as without occlusion. */
  setLevel(level: AmbientOcclusion): void {
    if (level !== 'off') this.steps.value = STEPS[level];
    if ((level === 'off') === (this.level === 'off')) { this.level = level; return; }
    this.level = level;
    this.receivers.forEach(material => this.connect(material));
  }

  private connect(material: THREE.MeshStandardNodeMaterial): void {
    const node = this.level === 'off' ? null : material.aoMap ? this.aoMapNode : this.aoNode;
    if (material.aoNode === node) return;
    material.aoNode = node;
    material.needsUpdate = true;
  }

  /** Bytes held by the prepass depth and colour and the three occlusion targets. */
  get bytes(): number {
    const { width, height } = this.depthTarget;
    return width * height * (4 + 1 + 2 + 2 + 2);
  }

  /** Forget receiving materials that are about to be disposed. */
  release(materials: Iterable<THREE.Material>): void {
    for (const material of materials) this.receivers.delete(material as THREE.MeshStandardNodeMaterial);
  }

  /** Draw the ships' depth and their occlusion for this frame's camera, at half of `size`
   * (drawing-buffer pixels of the target the scene renders into; the canvas by default). */
  render(renderer: THREE.Renderer, scene: THREE.Scene, size = renderer.getDrawingBufferSize(drawingSize)): void {
    if (this.level === 'off') return;
    const width = Math.max(1, Math.round(size.width / 2)), height = Math.max(1, Math.round(size.height / 2));
    if (this.depthTarget.width !== width || this.depthTarget.height !== height) {
      for (const target of [this.depthTarget, this.rawTarget, this.acrossTarget, this.blurTarget]) target.setSize(width, height);
      this.resolution.value.set(width, height);
    }
    const camera = this.camera, mask = camera.layers.mask, far = camera.far;
    // Ships past the fade take no occlusion: a nearer far plane culls them from the prepass.
    // The occlusion passes read the same projection, which is restored before the scene pass.
    camera.far = Math.min(far, this.fadeEnd.value * 1.05);
    camera.updateProjectionMatrix();
    this.depthToZ.value.set(camera.projectionMatrix.elements[10], camera.projectionMatrix.elements[14]);
    this.state = THREE.RendererUtils.resetRendererState(renderer, this.state as never);
    const { background, backgroundNode, overrideMaterial } = scene;
    try {
      scene.background = null; scene.backgroundNode = null;
      // The main camera itself; only its layers and far plane change, and both are restored.
      camera.layers.set(SHIP_OCCLUSION_LAYER);
      scene.overrideMaterial = this.depthMaterial;
      renderer.setRenderTarget(this.depthTarget);
      renderer.render(scene, camera);
      camera.layers.mask = mask;
      scene.overrideMaterial = null;
      renderer.setClearColor(0xffffff, 1);
      this.quad.material = this.aoMaterial;
      renderer.setRenderTarget(this.rawTarget); this.quad.render(renderer);
      this.quad.material = this.acrossMaterial;
      renderer.setRenderTarget(this.acrossTarget); this.quad.render(renderer);
      this.quad.material = this.blurMaterial;
      renderer.setRenderTarget(this.blurTarget); this.quad.render(renderer);
    } finally {
      camera.layers.mask = mask;
      camera.far = far;
      camera.updateProjectionMatrix();
      Object.assign(scene, { background, backgroundNode, overrideMaterial });
      THREE.RendererUtils.restoreRendererState(renderer, this.state);
    }
  }

  dispose(): void {
    for (const target of [this.depthTarget, this.rawTarget, this.acrossTarget, this.blurTarget]) target.dispose();
    for (const material of [this.depthMaterial, this.aoMaterial, this.acrossMaterial, this.blurMaterial]) material.dispose();
    this.depthTarget.depthTexture?.dispose();
  }
}

/** The 5×5 magic-square rotation pattern three's GTAONode uses. */
function magicSquareNoise(size = 5): THREE.DataTexture {
  const square = new Array<number>(size * size).fill(0);
  for (let i = Math.floor(size / 2), j = size - 1, value = 1; value <= size * size;) {
    if (i === -1 && j === size) { j = size - 2; i = 0; } else { if (j === size) j = 0; if (i < 0) i = size - 1; }
    if (square[i * size + j] !== 0) { j -= 2; i++; continue; }
    square[i * size + j] = value++; j++; i--;
  }
  const data = new Uint8Array(size * size * 4);
  square.forEach((value, index) => {
    const angle = 2 * Math.PI * value / (size * size);
    data.set([(Math.cos(angle) * .5 + .5) * 255, (Math.sin(angle) * .5 + .5) * 255, 127, 255], index * 4);
  });
  const noise = new THREE.DataTexture(data, size, size);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping; noise.needsUpdate = true;
  return noise;
}

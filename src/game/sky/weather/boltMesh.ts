import { BufferAttribute, CustomBlending, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NodeMaterial, OneFactor,
  Vector3, ZeroFactor } from 'three/webgpu';
import { Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, exp, float, max, mix, positionGeometry, screenSize, select, uniform, varyingProperty,
  vec2, vec3, vec4 } from 'three/tsl';
import { createBoltChannel, MAX_BOLT_SEGMENTS } from './bolt';
import { focalPixels } from './screen';

/** Radiance of the channel's core at a return stroke's peak, in the sea's units: some 150 times a daylight sky, so
 * the display's bloom (above 2) haloes even a bolt thinner than a pixel. */
export const BOLT_RADIANCE = 150;
/** Colour of the channel: the blue-white of a return stroke. */
const BOLT_COLOR = vec3(.78, .85, 1);
/** Narrowest core drawn (px, as a Gaussian's radius); thinner channels keep their light by fading instead. */
const MIN_SIGMA = .55;
/** Glow of the air around the channel: its share of the core's light, and its radius (px, and in core widths). */
const HALO_SHARE = .15, HALO_SIGMA = 5, HALO_WIDTHS = 4;
/** Segments within this distance of the camera plane are dropped (m). */
const NEAR = 1;

/** A cloud-to-ground bolt: the channel `bolt.ts` builds, drawn as camera-facing ribbons of emissive light added
 * over the scene. Each segment is a capsule with a Gaussian core at least a pixel wide (a thinner channel keeps its
 * total light by dimming) and a faint halo of lit air. Joints overlap by half a cap each, so a kinked channel
 * stays even. Its brightness is the flicker `lightning.ts` computes. */
export class BoltMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, NodeMaterial>;
  readonly channel = createBoltChannel();
  /** Where the bolt meets the sea, relative to the camera. */
  readonly origin = uniform(new Vector3());
  /** Core radiance this frame on the main channel and on the branches (flicker and air included). */
  readonly main = uniform(0);
  readonly branches = uniform(0);
  private readonly start: InstancedBufferAttribute;
  private readonly end: InstancedBufferAttribute;

  constructor() {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    this.start = new InstancedBufferAttribute(this.channel.start, 4).setUsage(DynamicDrawUsage);
    this.end = new InstancedBufferAttribute(this.channel.end, 4).setUsage(DynamicDrawUsage);
    geometry.setAttribute('boltStart', this.start);
    geometry.setAttribute('boltEnd', this.end);
    geometry.instanceCount = 0;
    const material = new NodeMaterial();
    material.name = 'Lightning bolt';
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.forceSinglePass = true;
    material.toneMapped = false;
    // Light added to the scene; the scene's alpha is left alone.
    material.blending = CustomBlending;
    material.blendSrc = OneFactor; material.blendDst = OneFactor;
    material.blendSrcAlpha = ZeroFactor; material.blendDstAlpha = OneFactor;
    this.build(material);
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'Lightning bolt';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.userData.temporalResponse = 1;
  }

  /** Send a freshly built channel to the GPU. */
  upload(): void {
    const count = Math.min(this.channel.count, MAX_BOLT_SEGMENTS);
    for (const buffer of [this.start, this.end]) {
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, count * 4);
      buffer.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = count;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }

  private build(material: NodeMaterial): void {
    const across = varyingProperty('float', 'vBoltAcross'), along = varyingProperty('float', 'vBoltAlong');
    const length = varyingProperty('float', 'vBoltLength'), sigma = varyingProperty('float', 'vBoltSigma');
    const haloSigma = varyingProperty('float', 'vBoltHaloSigma'), core = varyingProperty('float', 'vBoltCore'), halo = varyingProperty('float', 'vBoltHalo');
    material.vertexNode = Fn(() => {
      const start = attribute<'vec4'>('boltStart', 'vec4'), end = attribute<'vec4'>('boltEnd', 'vec4');
      const a = cameraViewMatrix.mul(vec4(this.origin.add(start.xyz), 0)).xyz, b = cameraViewMatrix.mul(vec4(this.origin.add(end.xyz), 0)).xyz;
      const visible = a.z.lessThan(-NEAR).and(b.z.lessThan(-NEAR));
      const clipA = cameraProjectionMatrix.mul(vec4(a, 1)).toVar(), clipB = cameraProjectionMatrix.mul(vec4(b, 1)).toVar();
      const halfScreen = screenSize.mul(.5);
      const pixelA = clipA.xy.div(clipA.w).mul(halfScreen), pixelB = clipB.xy.div(clipB.w).mul(halfScreen);
      const delta = pixelB.sub(pixelA), pixels = delta.length().toVar();
      const direction = select(pixels.greaterThan(1e-3), delta.div(pixels.max(1e-3)), vec2(0, 1));
      const normal = vec2(direction.y.negate(), direction.x);
      const focal = focalPixels();
      // True width in pixels, the drawn core and the halo, all Gaussian radii.
      const width = start.w.mul(focal).div(a.z.negate().add(b.z.negate()).mul(.5));
      const coreSigma = width.mul(.5).max(MIN_SIGMA), glowSigma = max(float(HALO_SIGMA), width.mul(HALO_WIDTHS));
      const reach = max(coreSigma, glowSigma).mul(2.5);
      const corner = positionGeometry.xy;
      const pixel = mix(pixelA, pixelB, corner.y).add(normal.mul(corner.x.mul(reach))).add(direction.mul(corner.y.mul(2).sub(1).mul(reach)));
      const clip = mix(clipA, clipB, corner.y);
      // Every stroke lights the main channel; only the first lights the branches.
      const light = select(end.w.greaterThan(0), this.main.mul(end.w), this.branches.mul(end.w.negate()));
      // Peak of a Gaussian holding the channel's light across its true width, for the core and its halo.
      core.assign(light.mul(width).div(coreSigma.mul(Math.sqrt(Math.PI))));
      halo.assign(light.mul(width).mul(HALO_SHARE).div(glowSigma.mul(Math.sqrt(Math.PI))));
      across.assign(corner.x.mul(reach));
      along.assign(corner.y.mul(pixels).add(corner.y.mul(2).sub(1).mul(reach)));
      length.assign(pixels);
      sigma.assign(coreSigma);
      haloSigma.assign(glowSigma);
      return select(visible, vec4(pixel.div(halfScreen).mul(clip.w), clip.z, clip.w), vec4(0, 0, 2, 1));
    })();
    material.colorNode = Fn(() => {
      // Distance to the segment (a capsule); past either end each cap carries half, so joints sum to one.
      const beyond = max(along.negate(), along.sub(length)).max(0);
      const distance2 = across.mul(across).add(beyond.mul(beyond));
      const cap = select(beyond.greaterThan(0), float(.5), float(1));
      const radiance = core.mul(exp(distance2.div(sigma.mul(sigma)).negate())).add(halo.mul(exp(distance2.div(haloSigma.mul(haloSigma)).negate())));
      return vec4(BOLT_COLOR.mul(radiance.mul(cap)), 0);
    })();
  }
}

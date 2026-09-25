import { HalfFloatType, LinearFilter, NoBlending, NodeMaterial, PMREMGenerator, QuadMesh, RGBAFormat, RenderTarget, Vector2, Vector3, type Camera,
  type Texture, type WebGPURenderer } from 'three/webgpu';
import { Fn, If, cos, float, mix, pmremTexture, pow, screenCoordinate, sin, uniform, vec3, vec4 } from 'three/tsl';
import type { OceanSky } from '../../ocean/contracts';
import { directPasses } from '../../DirectPasses';
import type { EnvironmentPart, EnvironmentSources, SkyFrame, SkyQuality, SkyUniforms } from '../contracts';
import { SKY_TIERS } from '../quality';

/** A sweep bakes the sky in this many horizontal bands, evenly over SWEEP_FRAMES frames, and the PMREM then
 * refilters the finished bake once. Every draw is its own render pass, whose fixed cost outweighs a band's
 * shading until the clouds' march arrives, so a few bands a sweep beat one a frame. Clouds drift a fraction of
 * a degree a second: a quarter of a second between refreshes does not show. */
const BANDS = 4, SWEEP_FRAMES = 16;
/** From sea level nothing of the cloud shell sinks below the horizon, so the bake's lower half is the sea
 * itself (the sweep's bands split the sky above it; the last band also takes the sea). The sea's own surface
 * never reads it (it mirrors rays about the horizon), but ships and islands take it as light from below: sky
 * mirrored with water's Fresnel, bright at a glancing angle as the horizon is, dark looking straight down,
 * over the dim glow of the water body. The horizon's colour all the way down lit every hull from below and
 * flattened ships. */
const CLOUD_FLOOR = 0;
/** Water's reflectance looking straight down (refractive index 1.33), and the light its body returns, as a
 * share of the sky's light from overhead: a dark blue-green. */
const WATER_F0 = .02, WATER_BODY = vec3(.012, .03, .04);
/** A sweep restarts at once, baking everything in one frame, after the sun or the sky's light changes or
 * the bake's origin jumps this far (m): a scene change or a teleport must not show a stale sky. */
const JUMP = 2000;

type PmremNode = ReturnType<typeof pmremTexture>;

/** Directions the prefilter's blur poles turn among from level to level, so no one pole gathers the
 * latitudinal blur's pinch: an icosahedron's vertices (from the golden ratio) and a cube's diagonals. */
const PHI = (1 + Math.sqrt(5)) / 2, INVERSE_PHI = 1 / PHI;
const POLES = [[-PHI, INVERSE_PHI, 0], [PHI, INVERSE_PHI, 0], [-INVERSE_PHI, 0, PHI], [INVERSE_PHI, 0, PHI], [0, PHI, -INVERSE_PHI], [0, PHI, INVERSE_PHI],
  [-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]].map(([x, y, z]) => new Vector3(x, y, z).normalize());

/** What the prefilter reaches in three's generator (r185), which its typings leave out. */
interface GeneratorInternals {
  _renderer: WebGPURenderer;
  _lodMeshes: unknown[];
  _sigmas: number[];
  _blur(target: RenderTarget, lodIn: number, lodOut: number, sigma: number, poleAxis: Vector3): void;
}

/** three's PMREM generator (the CubeUV layout every `pmremTexture` and `scene.environment` reads) with its
 * separable Gaussian chain in place of its GGX importance sampling. The GGX filter takes 512 samples per texel
 * at every roughness level: about 7 ms of GPU per refilter on the development machine, a frame spike every
 * sweep. The chain takes a few dozen, and a sky's smooth light hides the difference in the lobes: each level
 * blurs the one before by the Gaussian that widens it to the level's own width. */
class SkyPMREMGenerator extends PMREMGenerator {
  _applyPMREM(target: RenderTarget): void {
    const generator = this as unknown as GeneratorInternals, renderer = generator._renderer, autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const levels = generator._lodMeshes.length, sigmas = generator._sigmas;
    for (let i = 1; i < levels; i++) generator._blur(target, i - 1, i, Math.sqrt(sigmas[i] ** 2 - sigmas[i - 1] ** 2), POLES[(levels - i - 1) % POLES.length]);
    renderer.autoClear = autoClear;
  }
}

/** The environment the sea reflects and every material is lit by: an equirectangular bake of the dome
 * and the clouds from sea level under the camera, in horizontal bands over several frames, then one
 * prefilter per sweep into the PMREM (CubeUV) texture consumers read (`SkyPMREMGenerator`). */
export class Environment implements EnvironmentPart {
  readonly oceanSky: OceanSky;
  private target: RenderTarget;
  private readonly material = new NodeMaterial();
  private readonly quad: QuadMesh;
  /** Bake origin: the sea under the camera. */
  private readonly origin = uniform(new Vector3());
  private readonly size = uniform(new Vector2(1, 1));
  /** Frame of the current sweep. */
  private frame = 0;
  /** First texel row the clouds reach: rows below it hold only the dome under the horizon. */
  private floorRow = 0;
  private full = true;
  private readonly bakedOrigin = new Vector3(Infinity, 0, 0);
  private readonly bakedSun = new Vector3();
  private readonly bakedLight = new Vector3();
  private readonly reflections: PmremNode[] = [];
  private readonly generator: SkyPMREMGenerator;
  /** The prefiltered environment (three's CubeUV layout) consumers sample. */
  private pmrem: RenderTarget;

  constructor(private readonly renderer: WebGPURenderer, private readonly sources: EnvironmentSources, private readonly uniforms: SkyUniforms, quality: SkyQuality) {
    this.target = this.makeTarget(SKY_TIERS[quality].environmentWidth);
    this.generator = new SkyPMREMGenerator(renderer);
    const material = this.material;
    material.name = 'Sky environment';
    material.depthTest = material.depthWrite = false;
    material.blending = NoBlending; material.toneMapped = false; material.fog = false;
    material.fragmentNode = Fn(() => {
      // Texel centre → direction, the inverse of three's `equirectUV` (u from atan2(z, x), v from asin(y)).
      const uv = screenCoordinate.div(this.size);
      const azimuth = uv.x.sub(.5).mul(2 * Math.PI), elevation = uv.y.sub(.5).mul(Math.PI);
      const direction = vec3(cos(elevation).mul(cos(azimuth)), sin(elevation), cos(elevation).mul(sin(azimuth))).toVar();
      const color = vec3(0, 0, 0).toVar();
      If(direction.y.greaterThanEqual(CLOUD_FLOOR), () => {
        const clouds = sources.clouds.bake(this.origin, direction);
        color.assign(sources.dome(direction).mul(clouds.a).add(clouds.rgb));
      }).Else(() => {
        const cosine = direction.y.negate(), fresnel = float(WATER_F0).add(pow(float(1).sub(cosine), 5).mul(1 - WATER_F0));
        color.assign(mix(sources.dome(vec3(0, 1, 0)).mul(WATER_BODY), sources.dome(vec3(direction.x, cosine, direction.z)), fresnel));
      });
      return vec4(color, 1);
    })();
    this.quad = new QuadMesh(material);
    // Allocate the prefiltered target now, so its texture object stands from the start (the first update fills it).
    this.pmrem = this.prefilter(null);
    this.oceanSky = {
      createReflectionSampler: () => (direction, roughness) => {
        const node = pmremTexture(this.pmrem.texture, direction, roughness ?? float(0));
        this.reflections.push(node);
        return node.rgb;
      },
      createFogSampler: () => direction => sources.fog(direction),
      getEnvironmentTexture: () => this.pmrem.texture,
      getMeshes: () => sources.meshes(),
      followCamera: camera => this.followCamera(camera),
    };
  }

  get texture(): Texture { return this.pmrem.texture; }

  followCamera(camera: Camera): void {
    this.origin.value.set(camera.position.x, 0, camera.position.z);
  }

  update(_frame: SkyFrame): void {
    const { sunDirection, sunIrradiance } = this.uniforms, origin = this.origin.value;
    if (!this.bakedSun.equals(sunDirection.value) || !this.bakedLight.equals(sunIrradiance.value)
      || Math.hypot(origin.x - this.bakedOrigin.x, origin.z - this.bakedOrigin.z) > JUMP) this.full = true;
    if (this.full) {
      this.full = false;
      this.bakedSun.copy(sunDirection.value); this.bakedLight.copy(sunIrradiance.value); this.bakedOrigin.copy(origin);
      this.bake(0, this.target.height);
      this.frame = 0;
      this.prefilter(this.pmrem);
      return;
    }
    const frame = this.frame, stride = SWEEP_FRAMES / BANDS;
    this.frame = (frame + 1) % SWEEP_FRAMES;
    if (frame % stride) return;
    // Rows grow with elevation (v = 1 at the zenith): the sweep runs from the zenith down to the cloud floor,
    // and its last band on to the nadir.
    const band = frame / stride, height = this.target.height, span = height - this.floorRow;
    this.bake(band === BANDS - 1 ? 0 : height - Math.round((band + 1) * span / BANDS), height - Math.round(band * span / BANDS));
    if (band === BANDS - 1) {
      this.bakedOrigin.copy(origin);
      this.prefilter(this.pmrem);
    }
  }

  setQuality(quality: SkyQuality): void {
    const width = SKY_TIERS[quality].environmentWidth;
    if (width === this.target.width) return;
    this.target.dispose();
    this.target = this.makeTarget(width);
    // The prefiltered texture's size follows the bake's (a tier change is the one time its object changes).
    this.pmrem.dispose();
    this.pmrem = this.prefilter(null);
    for (const node of this.reflections) node.value = this.pmrem.texture;
    this.full = true;
  }

  dispose(): void {
    this.target.dispose();
    this.pmrem.dispose();
    this.generator.dispose();
    this.material.dispose();
  }

  private makeTarget(width: number): RenderTarget {
    const target = new RenderTarget(width, width / 2, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter,
      depthBuffer: false, generateMipmaps: false });
    target.texture.name = 'Sky environment';
    this.size.value.set(target.width, target.height);
    this.floorRow = Math.max(0, Math.floor((Math.asin(CLOUD_FLOOR) / Math.PI + .5) * target.height));
    return target;
  }

  /** Bake texel rows [from, to) (row 0 is the nadir). */
  private bake(from: number, to: number): void {
    const renderer = this.renderer, target = this.target;
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    const mrt = renderer.getMRT(), autoClear = renderer.autoClear;
    try {
      renderer.setMRT(null);
      renderer.autoClear = false;
      // WebGPU's viewport runs top-down from row 0, the texture's first row.
      target.viewport.set(0, from, target.width, to - from);
      directPasses(renderer).draw(this.quad, target);
    } finally {
      renderer.setRenderTarget(previous, face, level);
      renderer.setMRT(mrt);
      renderer.autoClear = autoClear;
    }
  }

  /** Prefilter the bake into `into` (in place), or into a new target of the bake's size when null; the generator's passes are direct
   * passes after the bake's. */
  private prefilter(into: RenderTarget | null): RenderTarget {
    const renderer = this.renderer, mrt = renderer.getMRT();
    try {
      renderer.setMRT(null);
      return directPasses(renderer).routed(() => this.generator.fromEquirectangular(this.target.texture, into));
    } finally {
      renderer.setMRT(mrt);
    }
  }
}


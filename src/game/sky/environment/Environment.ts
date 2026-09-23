import { HalfFloatType, LinearFilter, NoBlending, NodeMaterial, QuadMesh, RGBAFormat, RenderTarget, Vector2, Vector3, type Camera, type Texture,
  type WebGPURenderer } from 'three/webgpu';
import { Fn, If, cos, float, pmremTexture, screenCoordinate, sin, uniform, vec3, vec4 } from 'three/tsl';
import type { OceanSky } from '../../ocean/contracts';
import type { EnvironmentPart, EnvironmentSources, SkyFrame, SkyQuality, SkyUniforms } from '../contracts';
import { SKY_TIERS } from '../quality';

/** A sweep bakes the sky in this many horizontal bands, evenly over SWEEP_FRAMES frames, and the PMREM then
 * refilters the finished bake once. Every draw is its own render pass, whose fixed cost outweighs a band's
 * shading until the clouds' march arrives, so a few bands a sweep beat one a frame. Clouds drift a fraction of
 * a degree a second: a quarter of a second between refreshes does not show. */
const BANDS = 4, SWEEP_FRAMES = 16;
/** Directions this far below the horizon (as a vertical component) see only the dome: the clouds' bake
 * starts here, a little under the horizon, where the most distant clouds sink. The sweep's bands split the
 * sky above it; the last band also takes everything below, the dome's cheap horizon colour. */
const CLOUD_FLOOR = -.02;
/** A sweep restarts at once, baking everything in one frame, after the sun or the sky's light changes or
 * the bake's origin jumps this far (m): a scene change or a teleport must not show a stale sky. */
const JUMP = 2000;

type PmremNode = ReturnType<typeof pmremTexture>;

/** The environment the sea reflects and every material is lit by: an equirectangular bake of the dome
 * and the clouds from sea level under the camera, in horizontal bands over several frames, then one
 * PMREM refilter per sweep (three's `pmremTexture` regenerates when `pmremVersion` moves). */
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

  constructor(private readonly renderer: WebGPURenderer, private readonly sources: EnvironmentSources, private readonly uniforms: SkyUniforms, quality: SkyQuality) {
    this.target = this.makeTarget(SKY_TIERS[quality].environmentWidth);
    const material = this.material;
    material.name = 'Sky environment';
    material.depthTest = material.depthWrite = false;
    material.blending = NoBlending; material.toneMapped = false; material.fog = false;
    material.fragmentNode = Fn(() => {
      // Texel centre → direction, the inverse of three's `equirectUV` (u from atan2(z, x), v from asin(y)).
      const uv = screenCoordinate.div(this.size);
      const azimuth = uv.x.sub(.5).mul(2 * Math.PI), elevation = uv.y.sub(.5).mul(Math.PI);
      const direction = vec3(cos(elevation).mul(cos(azimuth)), sin(elevation), cos(elevation).mul(sin(azimuth))).toVar();
      const clouds = vec4(0, 0, 0, 1).toVar();
      If(direction.y.greaterThan(CLOUD_FLOOR), () => { clouds.assign(sources.clouds.bake(this.origin, direction)); });
      return vec4(sources.dome(direction).mul(clouds.a).add(clouds.rgb), 1);
    })();
    this.quad = new QuadMesh(material);
    this.oceanSky = {
      createReflectionSampler: () => (direction, roughness) => {
        const node = pmremTexture(this.target.texture, direction, roughness ?? float(0));
        this.reflections.push(node);
        return node.rgb;
      },
      createFogSampler: () => direction => sources.fog(direction),
      getEnvironmentTexture: () => this.target.texture,
      getMeshes: () => sources.meshes(),
      followCamera: camera => this.followCamera(camera),
    };
  }

  get texture(): Texture { return this.target.texture; }

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
      this.refilter();
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
      this.refilter();
    }
  }

  setQuality(quality: SkyQuality): void {
    const width = SKY_TIERS[quality].environmentWidth;
    if (width === this.target.width) return;
    this.target.dispose();
    this.target = this.makeTarget(width);
    for (const node of this.reflections) node.value = this.target.texture;
    this.full = true;
  }

  dispose(): void {
    this.target.dispose();
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
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previous, face, level);
      renderer.setMRT(mrt);
      renderer.autoClear = autoClear;
    }
  }

  /** Let three's PMREM refilter the bake the next time a material samples it. */
  private refilter(): void {
    this.target.texture.needsPMREMUpdate = true;
  }
}


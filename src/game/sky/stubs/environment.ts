import { HalfFloatType, LinearFilter, MeshBasicNodeMaterial, NoBlending, QuadMesh, RenderTarget, RGBAFormat, Vector3, type Camera, type WebGPURenderer } from 'three/webgpu';
import { equirectDirection, float, pmremTexture, uniform, uv, vec4 } from 'three/tsl';
import type { OceanSky } from '../../ocean/contracts';
import type { EnvironmentPart, EnvironmentSources, SkyFrame, SkyQuality } from '../contracts';
import { SKY_TIERS } from '../quality';

/** Frames between whole-texture bakes. */
const BAKE_INTERVAL = 8;

/** Bakes the whole equirectangular environment every few frames: dome, then clouds over it. */
export function createStubEnvironment(renderer: WebGPURenderer, sources: EnvironmentSources, quality: SkyQuality): EnvironmentPart {
  const origin = uniform(new Vector3());
  const makeTarget = (width: number) => new RenderTarget(width, width / 2, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false });
  let target = makeTarget(SKY_TIERS[quality].environmentWidth);
  target.texture.name = 'Sky environment';
  const material = new MeshBasicNodeMaterial();
  material.blending = NoBlending; material.toneMapped = false; material.fog = false;
  const direction = equirectDirection(uv());
  const clouds = sources.clouds.bake(origin, direction);
  material.fragmentNode = vec4(sources.dome(direction).mul(clouds.a).add(clouds.rgb), 1);
  const quad = new QuadMesh(material);
  let frames = 0;
  const bake = () => {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    quad.render(renderer);
    renderer.setRenderTarget(previous);
    target.texture.needsPMREMUpdate = true;
  };
  const oceanSky: OceanSky = {
    createReflectionSampler: () => (dir, roughness) => pmremTexture(target.texture, dir, roughness ?? float(0)).rgb,
    createFogSampler: () => dir => sources.fog(dir),
    getEnvironmentTexture: () => target.texture,
    getMeshes: () => sources.meshes(),
    followCamera: camera => part.followCamera(camera),
  };
  const part: EnvironmentPart = {
    get texture() { return target.texture; },
    oceanSky,
    followCamera(camera: Camera) { origin.value.set(camera.position.x, 0, camera.position.z); },
    update(frame: SkyFrame) {
      if (frame.cut || frames++ % BAKE_INTERVAL === 0) bake();
    },
    setQuality(next: SkyQuality) {
      const width = SKY_TIERS[next].environmentWidth;
      if (width === target.width) return;
      target.dispose();
      target = makeTarget(width);
      target.texture.name = 'Sky environment';
      frames = 0;
    },
    dispose() { target.dispose(); material.dispose(); },
  };
  return part;
}

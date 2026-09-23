import { Texture, Vector3, type Node, type Object3D, type PassNode } from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import type { OceanSky } from '../ocean/contracts';
import type { SkyApi, SkyScene } from './contracts';
import { SkyState } from './state';
import { createStubAtmosphere } from './stubs/atmosphere';

/** A sky without a GPU for tests: the real celestial model, uniforms and light choice over the stub
 * atmosphere's sea-level light. `scene` is the last description applied. */
export class RecordingSky implements SkyApi {
  readonly renderer = 'game' as const;
  readonly quality = 'high' as const;
  readonly state = new SkyState();
  readonly exposure = uniform(1);
  cloudsEnabled = true;
  readonly oceanSky: OceanSky = {
    createReflectionSampler: () => () => vec3(0, 0, 0), createFogSampler: () => () => vec3(0, 0, 0),
    getEnvironmentTexture: () => this.texture, getMeshes: () => [], followCamera() {},
  };
  private readonly texture = new Texture();
  private readonly atmosphere = createStubAtmosphere(this.state.uniforms);

  get light() { return this.state.light; }
  get sun() { return this.state.sun; }
  get moon() { return this.state.moon; }
  get coverage(): number { return this.state.scene.clouds.coverage; }
  get scene(): SkyScene { return this.state.scene; }

  apply(scene: SkyScene): void {
    this.state.apply(scene);
    this.atmosphere.apply(scene);
    this.state.chooseLight(this.atmosphere.seaLevel, 0);
  }
  update(dt: number): void {
    this.state.advance(dt, new Vector3());
    this.state.chooseLight(this.atmosphere.seaLevel, 0);
  }
  postProcess(_scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'> { return color; }
  cloudShadow(): Node<'float'> { return float(1); }
  meshes(): Object3D[] { return []; }
  resetHistory(): void {}
  resize(): void {}
  async setQuality(): Promise<void> {}
  diagnostics(): Record<string, unknown> { return {}; }
  dispose(): void {}
}

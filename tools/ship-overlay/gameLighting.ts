import * as THREE from 'three/webgpu';
import { Sky } from '../../src/game/sky/Sky';
import { MESH_FILL_COLORS, PORT_LIGHT, meshLightShares } from '../../src/game/VisualEnvironment';

/** Sky frames after a change: the environment's bake sweep (16 frames) and the clouds' march settle within them. */
const SETTLE_FRAMES = 40;
/** Shadow texels across the lit model. */
const SHADOW_MAP = 4096;

/** The port's light on a model: the game's sky (never drawn here) bakes the environment the ship reflects,
 * and the sun and hemisphere fill take the shares of its light that ships take in port. The sun's bearing
 * turns about the model so a fixed view can be lit from the front. */
export class GameLighting {
  readonly sun = new THREE.DirectionalLight();
  readonly fill = new THREE.HemisphereLight(MESH_FILL_COLORS.sky, MESH_FILL_COLORS.ground, PORT_LIGHT.ambient);
  private readonly center = new THREE.Vector3();
  private radius = 1;
  private pending = SETTLE_FRAMES;

  static async create(renderer: THREE.WebGPURenderer, bearing: number): Promise<GameLighting> {
    // The sky draws its dome, clouds and rain into a scene of its own that is never rendered; only its
    // environment bake and light reach the model. The bake stands at sea level under this camera.
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 100000);
    camera.position.set(0, 2, 0); camera.updateMatrixWorld();
    const sky = await Sky.create(renderer, new THREE.Scene(), camera, { quality: 'high' });
    sky.resize(64, 64);
    return new GameLighting(sky, bearing);
  }

  private constructor(private readonly sky: Sky, private bearing: number) {
    Object.assign(this.sun.shadow, { bias: -.0005, radius: 1, blurSamples: 8 });
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.castShadow = true;
    this.sun.add(this.sun.target);
    this.apply();
  }

  /** Linear exposure the display grade multiplies by, as in the game. */
  get exposure() { return this.sky.exposure; }
  /** The sky's prefiltered environment, for `scene.environment`. */
  get environment(): THREE.Texture { return this.sky.oceanSky.getEnvironmentTexture(); }
  /** Share of the sky reflection that reaches lit meshes, for `scene.environmentIntensity`. */
  environmentIntensity = 1;

  /** Degrees clockwise from the bow: 0 ahead, 90 starboard. */
  setBearing(bearing: number): void {
    if (bearing === this.bearing) return;
    this.bearing = bearing; this.apply();
  }

  /** Aim the sun at the model and fit its shadow map to it. */
  fit(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    box.getCenter(this.center);
    this.radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, .5);
    const camera = this.sun.shadow.camera, half = this.radius * 1.05;
    Object.assign(camera, { left: -half, right: half, top: half, bottom: -half, near: this.radius, far: this.radius * 5 });
    camera.updateProjectionMatrix();
    // The receiver offset stays proportional to a shadow texel, as the game's.
    this.sun.shadow.normalBias = .75 * 2 * half / SHADOW_MAP;
    this.sun.shadow.needsUpdate = true;
    this.sync();
  }

  /** Advance the sky while its bake settles after a change; true while it wants another frame. */
  step(): boolean {
    if (this.pending <= 0) return false;
    this.pending--;
    this.sky.update(0);
    this.sync();
    return this.pending > 0;
  }

  dispose(): void { this.sky.dispose(); this.sun.shadow.dispose(); }

  private apply(): void {
    // Relative bearing from the bow (-Z) to the sky's compass azimuth (0 toward +Z, 90 toward +X).
    const azimuth = THREE.MathUtils.euclideanModulo(180 - this.bearing, 360);
    this.sky.apply({
      sun: { ...PORT_LIGHT.sun, azimuth }, moon: { phase: .5 }, atmosphere: { ...PORT_LIGHT.atmosphere },
      clouds: { ...PORT_LIGHT.clouds, windSpeed: 0, windHeading: 0 }, weather: { precipitation: 0, lightning: 0 }, port: true,
    });
    this.sky.hold(0);
    this.pending = SETTLE_FRAMES;
    this.sync();
  }

  private sync(): void {
    const light = this.sky.light, shares = meshLightShares(light);
    this.sun.intensity = light.intensity * shares.sun;
    this.sun.color.copy(light.color);
    this.fill.intensity = PORT_LIGHT.ambient * shares.fill;
    this.environmentIntensity = shares.sky;
    this.sun.position.copy(light.direction).multiplyScalar(this.radius * 3).add(this.center);
    this.sun.target.position.copy(this.center).sub(this.sun.position);
    this.sun.updateMatrixWorld(true);
  }
}

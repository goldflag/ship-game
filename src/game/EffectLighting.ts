import * as THREE from 'three/webgpu';
import { cameraFar, cameraNear, float, nodeObject, perspectiveDepthToViewZ, positionView, smoothstep, uniform } from 'three/tsl';
import { EffectDepthTextureNode } from './EffectVolume';

/** The scene's light, wind and opaque depth as every effect material reads them.
 *
 * One instance is shared by combat effects, ship fires and funnel exhaust, so their materials read
 * the same uniform nodes and stay lit alike at noon, dusk, night and under cloud. VisualEnvironment
 * writes it (through `CombatEffects` and `ShipFunnelSmoke`); nothing here owns the sky or the sea. */
export class EffectLighting {
  /** Towards the sun, or towards the moon when it is the brighter light. */
  readonly sunDirection = uniform(new THREE.Vector3(-.55, .74, -.39).normalize());
  /** Direct radiance scattered by smoke: celestial colour × intensity, about 1.25 at a clear noon. */
  readonly direct = uniform(new THREE.Vector3(1.25, 1.19, 1.08));
  /** Sky fill that reaches shaded folds, about (.3, .35, .4) by day. */
  readonly ambient = uniform(new THREE.Vector3(.3, .35, .4));
  /** 0–1 overall scene brightness, for unlit water and spray sprites. */
  readonly daylight = uniform(1);
  /** World drift for smoke and spray in m/s: the ocean's wind × 0.35, radians from +X toward +Z. */
  readonly wind = new THREE.Vector3(2.4, 0, .9);
  private readonly depthTexture = new THREE.DepthTexture(1, 1);
  /** Opaque scene depth (a single viewport copy per frame shared by every effect material). */
  readonly sceneDepth = nodeObject(new EffectDepthTextureNode(undefined, null, this.depthTexture)).r;

  setWind(speed: number, direction: number): void {
    this.wind.set(Math.cos(direction), 0, Math.sin(direction)).multiplyScalar(speed * .35);
  }
  setSun(direction: THREE.Vector3, daylight = 1): void {
    this.sunDirection.value.copy(direction);
    this.daylight.value = daylight;
  }
  /** Match the scene's weather/daylight or moonlight; hot gas and flame stay emissive. */
  setIllumination(color: THREE.Color, intensity: number, ambient: number): void {
    this.direct.value.set(color.r, color.g, color.b).multiplyScalar(Math.max(0, intensity) * 1.25 / 5.8);
    this.ambient.value.set(.3, .35, .4).multiplyScalar(Math.max(0, ambient) / 1.75);
  }

  /** Metres of view depth between this fragment and the opaque surface behind it, for soft particle
   * edges: multiply opacity by `softEdge(metres)` so sprites fade into decks, hulls and the sea instead
   * of cutting them with a hard line. Depth convention (including reversed depth) follows the renderer. */
  depthGap(): THREE.Node<'float'> {
    return positionView.z.sub(perspectiveDepthToViewZ(this.sceneDepth, cameraNear, cameraFar));
  }
  softEdge(metres: number | THREE.Node<'float'>): THREE.Node<'float'> {
    return smoothstep(float(0), typeof metres === 'number' ? float(metres) : metres, this.depthGap());
  }

  dispose(): void { this.depthTexture.dispose(); }
}

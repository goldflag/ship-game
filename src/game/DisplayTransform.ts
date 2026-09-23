import * as THREE from 'three/webgpu';
import { luminance, max, mix, pow, renderOutput, rtt, vec3, vec4 } from 'three/tsl';
import BloomNode, { bloom } from 'three/addons/tsl/display/BloomNode.js';

/** AgX keeps a lit surface's hue as it brightens, as Blender's default view transform does.
 * ACES pushed Yamato's red-oxide boot top toward salmon. */
export const DISPLAY_TONE_MAPPING: THREE.ToneMapping = THREE.AgXToneMapping;

/** A grade ahead of AgX that keeps the sky and sea Sky Pro and Water Pro were tuned for under ACES.
 * AgX's base contrast lifted the dark sea from sRGB 46 to 64 and greyed the sky. A contrast about
 * middle gray and a little saturation, as Blender's AgX looks apply, return both to within a few
 * levels. Contrast scales luminance only, so hues stay where AgX puts them. `exposure` multiplies
 * the sky's own exposure; the mesh light shares in `VisualEnvironment` give ships back what it takes. */
export const DISPLAY_LOOK = { exposure: .9, contrast: 1.25, saturation: 1.25 };
const MIDDLE_GRAY = .18;

/** Glow on HDR highlights ahead of tone mapping: sun glints, muzzle flashes, fires and tracers.
 * Daylight sky, clouds and paint stay below the threshold, and so does the bright sky around a low
 * sun: at a threshold of 1 its aureole hazed a ship seen against it.
 * `knee` is the width of the threshold's ramp. */
export const BLOOM = { strength: .3, radius: .5, threshold: 2, knee: 1 };

export interface DisplaySources {
  /** The scene's linear HDR radiance after the water's post-processing. */
  radiance: THREE.Node<'vec4'>;
  /** The scene pass's own color, which bloom reads at half resolution. Glints, flashes and fires are
   * already in it; sampling `radiance` there would evaluate the water composite a second time. */
  scene: THREE.Node<'vec4'>;
  /** Scalar on linear radiance ahead of tone mapping. */
  exposure: THREE.Node<'float'>;
  /** An overlay already in display space, and its 0/1 switch. */
  overlay: { color: THREE.Node<'vec4'>; enabled: THREE.Node<'float'> };
}

/** `DISPLAY_LOOK` applied to linear radiance. */
function grade(radiance: THREE.Node<'vec3'>, exposure: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const exposed = radiance.mul(exposure.mul(DISPLAY_LOOK.exposure));
  const lum = max(luminance(exposed), 1e-5);
  return mix(vec3(lum), exposed, DISPLAY_LOOK.saturation).max(0).mul(pow(lum.div(MIDDLE_GRAY), DISPLAY_LOOK.contrast - 1));
}

/** The display transform: exposed and graded radiance, optional bloom, AgX and sRGB, then the
 * armor overlay, rendered into one frame that the edge smoothing reads. */
export class DisplayTransform {
  frame?: ReturnType<typeof rtt>;
  private glow?: BloomNode;

  constructor(private readonly sources: DisplaySources) {}

  /** A new frame for a new display pipeline. Bloom is rebuilt with it: `BloomNode.setup` appends
   * five blur materials each time a pipeline sets it up again. */
  build(withBloom: boolean): ReturnType<typeof rtt> {
    this.dispose();
    const { radiance, scene, exposure, overlay } = this.sources;
    let color = grade(radiance.rgb, exposure);
    if (withBloom) {
      this.glow = bloom(vec4(grade(scene.rgb, exposure), 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      this.glow.smoothWidth.value = BLOOM.knee;
      color = color.add(this.glow.rgb);
    }
    const display = renderOutput(vec4(color, radiance.a), DISPLAY_TONE_MAPPING, THREE.SRGBColorSpace);
    const armor = renderOutput(overlay.color, THREE.NoToneMapping, THREE.SRGBColorSpace);
    return this.frame = rtt(vec4(mix(display.rgb, armor.rgb, armor.a.mul(overlay.enabled)), display.a));
  }

  /** The live bloom pass, when the current frame has one. */
  get bloom(): BloomNode | undefined { return this.glow; }

  dispose(): void {
    this.frame?.renderTarget?.dispose();
    this.glow?.dispose();
    this.frame = this.glow = undefined;
  }
}

import type { SkyQuality } from './contracts';

/** What each Graphics → Clouds tier spends. Every part reads its own budget here; the whole
 * tier must cost no more GPU time than Sky Pro's same tier on the same scene. */
export interface SkyTier {
  /** The cloud march buffer is the drawing buffer divided by this on each axis. */
  readonly cloudScale: 2 | 3 | 4;
  /** Each frame marches one pixel of every `cloudInterleave`² block of the cloud buffer; temporal
   * reconstruction fills the rest from history. */
  readonly cloudInterleave: 1 | 2 | 4;
  /** Most primary march steps a ray may take. */
  readonly cloudSteps: number;
  /** Samples toward the sun (or moon) per lit march step. */
  readonly cloudLightSteps: number;
  /** Texels per edge of the top-down cloud shadow map. */
  readonly cloudShadowSize: number;
  /** Frames between cloud updates seen from under the layer (1: every frame); the composite turns the last
   * update to the current view in between. */
  readonly cloudUpdateInterval: number;
  /** High cirrus in the dome. Off, the dome skips its two texture reads on every sky pixel. */
  readonly cloudCirrus: boolean;
  /** Environment bake width (height is half); its cloud march steps. */
  readonly environmentWidth: number;
  readonly environmentSteps: number;
  /** Radial samples of the screen-space sun shafts; 0 draws none. */
  readonly shaftSamples: number;
  /** Rain streaks around the camera at full precipitation. */
  readonly rainDrops: number;
  /** Stars drawn, brightest first. */
  readonly stars: number;
}

export const SKY_TIERS: Readonly<Record<SkyQuality, SkyTier>> = {
  low: { cloudScale: 3, cloudInterleave: 4, cloudSteps: 40, cloudLightSteps: 3, cloudShadowSize: 512, cloudUpdateInterval: 1, cloudCirrus: false,
    environmentWidth: 256, environmentSteps: 12, shaftSamples: 16, rainDrops: 3000, stars: 3000 },
  medium: { cloudScale: 2, cloudInterleave: 4, cloudSteps: 64, cloudLightSteps: 4, cloudShadowSize: 1024, cloudUpdateInterval: 1, cloudCirrus: true,
    environmentWidth: 384, environmentSteps: 16, shaftSamples: 24, rainDrops: 8000, stars: 6000 },
  high: { cloudScale: 2, cloudInterleave: 2, cloudSteps: 80, cloudLightSteps: 4, cloudShadowSize: 1024, cloudUpdateInterval: 1, cloudCirrus: true,
    environmentWidth: 512, environmentSteps: 24, shaftSamples: 32, rainDrops: 16000, stars: 9000 },
  ultra: { cloudScale: 2, cloudInterleave: 2, cloudSteps: 128, cloudLightSteps: 5, cloudShadowSize: 1024, cloudUpdateInterval: 1, cloudCirrus: true,
    environmentWidth: 768, environmentSteps: 32, shaftSamples: 48, rainDrops: 30000, stars: 9000 },
};

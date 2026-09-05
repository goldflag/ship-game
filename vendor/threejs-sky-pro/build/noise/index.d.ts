import * as THREE from 'three/webgpu';
export { WeatherMap, type WeatherMapParams } from './WeatherMap';
export { BaseShapeVolume } from './BaseShapeVolume';
export { DEFAULT_BASE_SHAPE_DIMS, DEFAULT_BASE_SHAPE_PROFILE, DEFAULT_WEATHER_MAP_PROFILE, type NoiseDim3, type WorleyFBM, type BaseShapeProfile, type WeatherMapProfile, type WeatherFBM, type WeatherMassFBM, type WeatherDetailFBM, } from './noiseProfiles';
export { loadCloudNoiseTextures, generateCloudNoiseTextures, type GenerateCloudNoiseOptions, type BakedCloudNoise, } from './loadNoise';
export { createBlueNoiseTexture } from './blueNoise';
/** Noise textures consumed by the cloud raymarch material. */
export interface CloudNoiseTextures {
    /** Base-shape volume, RGBA8 with a full mip chain: RGB = Worley fBm at low/mid/high frequency. */
    baseShape: THREE.Data3DTexture;
    /** Weather map, 2D R8 coverage. */
    weather: THREE.DataTexture;
}

import { Matrix3, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { SkyUniforms } from './contracts';

/** The uniforms every part reads. Only the facade writes them. */
export function createSkyUniforms(): SkyUniforms {
  return {
    sunDirection: uniform(new Vector3(0, 1, 0)),
    sunIrradiance: uniform(new Vector3(6, 6, 6)),
    moonDirection: uniform(new Vector3(0, -1, 0)),
    moonIrradiance: uniform(new Vector3()),
    moonPhase: uniform(.5),
    starRotation: uniform(new Matrix3()),
    cameraPosition: uniform(new Vector3()),
    time: uniform(0),
    windOffset: uniform(new Vector3()),
    lightningPosition: uniform(new Vector3()),
    lightningIntensity: uniform(0),
  };
}

import * as THREE from 'three/webgpu';
import type { WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';

type Cascade = { initialized: boolean; scale: number; h0Buffer: { value: THREE.BufferAttribute } };
type SpectrumWater = { oceanSim?: { cascades?: Cascade[] } };

/** An unnormalised inverse FFT is bounded by the sum of its coefficients.
 * Time evolution adds h0(k) and conjugate h0(-k). Bilinear sampling and the
 * hierarchical cascade coordinates cannot exceed the sum of these bounds. */
export function spectrumHeightBound(coefficients: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < coefficients.length; i += 4) sum += 2 * Math.hypot(coefficients[i], coefficients[i + 1]);
  return Number.isFinite(sum) ? sum : Infinity;
}

export function cameraAboveSurface(camera: THREE.Camera, maximumHeight: number): boolean {
  if (!Number.isFinite(maximumHeight)) return false;
  const corner = new THREE.Vector3();
  const near = camera.reversedDepth ? 1 : camera.coordinateSystem === THREE.WebGPUCoordinateSystem ? 0 : -1;
  let lowest = camera.matrixWorld.elements[13];
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    corner.set(x, y, near).unproject(camera);
    lowest = Math.min(lowest, corner.y);
  }
  return lowest > maximumHeight;
}

/** Visual-only culling for the pinned Water Pro 3.5.1 adapter. Unknown spectra,
 * backend changes and pending readbacks retain all underwater passes. The CPU
 * combat simulation never observes this bound or its asynchronous readback. */
export class UnderwaterPassVisibility {
  private generation = 0;
  private pending?: Promise<void>;
  private sampled?: { cascade: Cascade; scale: number }[];
  private bound = Infinity;
  private disposed = false;
  private readonly enabled: boolean;

  constructor(private readonly water: WaterSystem, private readonly renderer: Pick<THREE.WebGPURenderer, 'getArrayBufferAsync'>) {
    this.enabled = water.underwater.enabled;
  }

  private cascades(): Cascade[] | undefined {
    return (this.water as unknown as SpectrumWater).oceanSim?.cascades;
  }

  update(camera: THREE.Camera): void {
    const cascades = this.cascades();
    if (this.water.waves.dirty || this.sampled && (!cascades || cascades.length !== this.sampled.length ||
      this.sampled.some((sample, i) => sample.cascade !== cascades[i] || sample.scale !== cascades[i].scale || !cascades[i].initialized))) {
      this.bound = Infinity; this.sampled = undefined; this.generation++;
    }
    this.water.underwater.enabled = this.enabled && !cameraAboveSurface(camera, this.bound);
  }

  /** Called after water.update has submitted any newly generated spectrum. */
  capture(): void {
    const cascades = this.cascades();
    if (!this.enabled || this.disposed || this.pending || this.sampled || this.water.waves.dirty ||
      !cascades?.length || cascades.some(c => !c.initialized || !c.h0Buffer?.value)) return;
    const generation = this.generation;
    const sampled = cascades.map(cascade => ({ cascade, scale: cascade.scale }));
    const amplitude = Math.abs(this.water.waves.amplitude.value);
    const evolution = Math.max(1, Math.abs(1 - this.water.waves.standingWaveRatio.value));
    this.pending = Promise.all(cascades.map(c => this.renderer.getArrayBufferAsync(c.h0Buffer.value))).then(buffers => {
      if (this.disposed || generation !== this.generation) return;
      const fft = buffers.reduce((sum, buffer) => sum + spectrumHeightBound(new Float32Array(buffer)), 0) * amplitude * evolution;
      // The pinned wake integrator clamps height to ±8 m (vendor index.js, Et).
      // Add 1% plus 10 cm for floating-point FFT/interpolation roundoff.
      this.bound = fft * 1.01 + 8.1;
      this.sampled = sampled;
    }).catch(() => { this.bound = Infinity; }).finally(() => { this.pending = undefined; });
  }

  diagnostics() { return { maximumHeight: this.bound, pending: !!this.pending, underwater: this.water.underwater.enabled }; }
  dispose(): void { this.disposed = true; this.generation++; }
}

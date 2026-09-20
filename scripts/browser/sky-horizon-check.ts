import { DataUtils, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import type { Game } from '../../src/game/Game';
import type { SkySystem } from '../../vendor/threejs-sky-pro/build/index.js';

/** Run on the real, ready harness game. Read back the sky LUT so clouds, exposure
 * and screenshot compression cannot hide a regression in the horizon band. */
export async function checkSkyHorizon(game: Game) {
  const scene = game as unknown as { sky: SkySystem; renderer: WebGPURenderer; paused: boolean };
  const sky = scene.sky, initial = sky.atmosphere.toParams(), paused = scene.paused;
  const weather = game.developerWeather()!.overrides;
  const target = (sky.pipeline as unknown as { _skyViewLUT: { target: RenderTarget } })._skyViewLUT.target;
  const frames = async () => { for (let n = 0; n < 3; n++) await new Promise(requestAnimationFrame); };
  const sample = async (correction: number) => {
    sky.atmosphere.horizonCorrection.value = correction;
    await frames();
    const raw = await scene.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
    // WebGPU pads each readback row to a 256-byte boundary.
    const stride = raw.length === target.width * target.height * 4 ? target.width * 4
      : Math.ceil(target.width * 4 * raw.BYTES_PER_ELEMENT / 256) * 256 / raw.BYTES_PER_ELEMENT;
    const values: number[] = [];
    for (let row = 0; row < target.height; row++) for (let x = 0; x < target.width * 4; x++) {
      const value = raw[row * stride + x];
      values.push(raw instanceof Uint16Array ? DataUtils.fromHalfFloat(value) : value);
    }
    if (!values.every(Number.isFinite)) throw new Error('Sky LUT contains non-finite radiance');
    return values;
  };
  const luma = (values: number[], row: number) => {
    let sum = 0;
    for (let x = 0; x < target.width; x++) {
      const i = (row * target.width + x) * 4;
      sum += .2126 * values[i] + .7152 * values[i + 1] + .0722 * values[i + 2];
    }
    return sum / target.width;
  };
  const error = (a: number[], b: number[], firstRow = 0) => {
    let maximum = 0;
    for (let i = firstRow * target.width * 4; i < a.length; i++) {
      maximum = Math.max(maximum, Math.abs(a[i] - b[i]) / Math.max(1e-5, Math.abs(a[i])));
    }
    return maximum;
  };
  const results = [];
  scene.paused = true;
  try {
    for (const [name, timeHours] of [['day', 12], ['dusk', 18], ['night', 0]] as const) {
      game.setDeveloperWeather({ ...weather, timeHours });
      await frames();
      const original = await sample(0), elevation = sky.sun.elevationDeg;
      const { horizonCorrection: _, ...palette } = sky.atmosphere.toParams();
      let previous = 1;
      for (const strength of [.5, .8, 1]) {
        const corrected = await sample(strength);
        const gain = luma(corrected, 0) / Math.max(1e-10, luma(original, 0));
        // LUT elevation is asin(v²); leave a texel beyond the 6° cutoff.
        const firstUpperRow = Math.ceil(Math.sqrt(Math.sin(6 * Math.PI / 180)) * target.height) + 1;
        const upperError = error(original, corrected, firstUpperRow);
        const { horizonCorrection: __, ...after } = sky.atmosphere.toParams();
        if (JSON.stringify(palette) !== JSON.stringify(after)) throw new Error('Horizon correction changed the authored palette');
        if (upperError > .002) throw new Error(`Upper sky changed: ${upperError}`);
        if (name === 'day' && (elevation < 18 || gain < previous + .05)) throw new Error(`Horizon lift did not increase: ${gain}`);
        if (name !== 'day' && (elevation > 6 || error(original, corrected) > .002)) throw new Error(`${name} sky changed`);
        previous = gain;
        results.push({ name, strength, elevation, horizonGain: gain, upperError });
      }
      if (error(original, await sample(0)) > .002) throw new Error('Original sky did not restore after changing correction');
    }
    return results;
  } finally {
    game.setDeveloperWeather(weather); sky.atmosphere.applyParams(initial); scene.paused = paused;
  }
}

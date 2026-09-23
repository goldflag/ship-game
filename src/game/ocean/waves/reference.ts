/** Direct (slow) inverse DFT of a cascade: the ground truth the GPU transform is checked against
 * by the unit tests and `scripts/diagnostics/ocean-waves.html`. */
import type { CascadeSpectrum } from './spectrum';

/** The eight real fields of one cascade at one texel: displacement, height slope and the
 * horizontal displacement's derivatives (∂Dx/∂x, ∂Dz/∂z, ∂Dx/∂z). */
export interface WaveTexel { dx: number; dy: number; dz: number; hx: number; hz: number; dxx: number; dzz: number; dxz: number }

/** Every nonzero texel as (kx, kz, Re a, Im a, m), so repeated evaluations skip the empty lattice. */
export function activeModes(cascade: CascadeSpectrum): Float64Array {
  const { amplitudes: a, resolution: n, size } = cascade, dk = 2 * Math.PI / size, modes: number[] = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = (z * n + x) * 4;
    if (a[i] === 0 && a[i + 1] === 0) continue;
    modes.push((x < n / 2 ? x : x - n) * dk, (z < n / 2 ? z : z - n) * dk, a[i], a[i + 1], a[i + 2]);
  }
  return Float64Array.from(modes);
}

/** Fields at texel (x, z) (world position (x, z)·size/resolution) and folded time `phase`
 * = t / FOLD_PERIOD. Each mode is H = a·e^{−2πi·m·phase}; displacement uses +i·k̂·choppiness so
 * crests sharpen, as in Gerstner waves. */
export function referenceTexel(cascade: CascadeSpectrum, modes: Float64Array, choppiness: number, phase: number, x: number, z: number): WaveTexel {
  const scale = cascade.size / cascade.resolution, px = x * scale, pz = z * scale;
  const out: WaveTexel = { dx: 0, dy: 0, dz: 0, hx: 0, hz: 0, dxx: 0, dzz: 0, dxz: 0 };
  for (let i = 0; i < modes.length; i += 5) {
    const kx = modes[i], kz = modes[i + 1], k = Math.hypot(kx, kz);
    const turn = 2 * Math.PI * ((modes[i + 4] * phase) % 1);
    const hr = modes[i + 2] * Math.cos(turn) + modes[i + 3] * Math.sin(turn);
    const hi = modes[i + 3] * Math.cos(turn) - modes[i + 2] * Math.sin(turn);
    const space = kx * px + kz * pz, c = Math.cos(space), s = Math.sin(space);
    // Re(H·e^{ik·x}) and Re(i·H·e^{ik·x}).
    const real = hr * c - hi * s, imaginary = -(hr * s + hi * c);
    out.dy += real;
    out.dx += choppiness * kx / k * imaginary; out.dz += choppiness * kz / k * imaginary;
    out.hx += kx * imaginary; out.hz += kz * imaginary;
    out.dxx -= choppiness * kx * kx / k * real; out.dzz -= choppiness * kz * kz / k * real; out.dxz -= choppiness * kx * kz / k * real;
  }
  return out;
}

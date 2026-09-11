import type { PerformanceReadout } from '../game/types';

/** The quiet frame-rate counter. The Graphics setting hides it or extends it with
 * frame time, render size and draw counts; `fps` covers telemetry without a readout. */
export function PerformanceCounter({ performance, fps, className }: { performance?: PerformanceReadout; fps: number; className: string }) {
  const mode = performance?.mode ?? 'fps';
  if (mode === 'hidden') return null;
  const value = performance?.fps ?? fps;
  const detail = performance?.detail;
  return <span className={className} aria-label={`${value || 0} frames per second`}>
    <strong>{value || '—'}</strong> FPS
    {mode === 'detailed' && performance && <span className="performance-detail">
      {performance.frameMs.toFixed(1)} ms · {performance.width} × {performance.height} · {performance.backend === 'webgl' ? 'WebGL' : 'WebGPU'}
      {detail && ` · ${detail.shipInstances} ship draws (${detail.reducedInstances} reduced) · ${detail.particles} particles · ${detail.aircraft} aircraft`}
    </span>}
  </span>;
}

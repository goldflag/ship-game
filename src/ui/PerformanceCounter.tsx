import type { PerformanceReadout } from '../game/types';

/** The quiet frame-rate counter. The Graphics setting hides it or extends it with
 * frame time, render size and draw counts; `fps` covers telemetry without a readout.
 * Local battles add the simulation worker's load beside it, since the worker, not
 * the renderer, is often what limits a large battle. */
export function PerformanceCounter({ performance, fps, className }: { performance?: PerformanceReadout; fps: number; className: string }) {
  const mode = performance?.mode ?? 'fps';
  if (mode === 'hidden') return null;
  const value = performance?.fps ?? fps;
  const detail = performance?.detail, sim = performance?.simulation;
  // Behind: the worker could not hold the requested speed over the last window.
  const behind = sim?.achievedSpeed !== undefined && sim.achievedSpeed < sim.speed * 0.95;
  const simClass = !sim ? '' : behind || sim.busy >= 0.9 ? ' poor' : sim.busy >= 0.6 ? ' strained' : '';
  return <span className={className} aria-label={`${value || 0} frames per second${sim ? `, simulation ${Math.round(sim.busy * 100)} percent busy, ${sim.tickMs.toFixed(1)} milliseconds per tick` : ''}`}>
    <strong>{value || '—'}</strong> FPS
    {sim && <span className={`performance-simulation${simClass}`} title="Simulation worker: share of wall time spent stepping, and step cost per 60 Hz tick (16.7 ms is the whole 1× budget)">
      <strong>{Math.round(sim.busy * 100)}%</strong> SIM · {sim.tickMs.toFixed(1)} ms/tick{behind && ` · ${sim.achievedSpeed!.toFixed(1)}× of ${sim.speed}×`}
    </span>}
    {mode === 'detailed' && performance && <span className="performance-detail">
      {performance.frameMs.toFixed(1)} ms · {performance.width} × {performance.height} · {performance.backend === 'webgl' ? 'WebGL' : 'WebGPU'}
      {sim && ` · sim ${Math.round(sim.ticksPerSecond)} ticks/s, ${sim.snapshotMs.toFixed(1)} ms snapshot`}
      {detail && ` · ${detail.shipInstances} ship draws (${detail.reducedInstances} reduced) · ${detail.particles} particles · ${detail.aircraft} aircraft`}
    </span>}
  </span>;
}

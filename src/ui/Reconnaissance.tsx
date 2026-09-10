import { useMemo } from 'react';
import type { ReconCoverage } from '../multiplayer/generated/ReconCoverage';
import { coveragePatches } from './reconReports';
import './Reconnaissance.css';

/** Place inside the existing projected SVG, behind routes and contact markers. */
export function ReconnaissanceCoverage({ coverage, tick }: { coverage?: ReconCoverage; tick: number }) {
  const patches = useMemo(() => coverage ? coveragePatches(coverage, tick) : [], [coverage, tick]);
  return <g className="fleet-recon-coverage" aria-hidden="true">{patches.map(patch =>
    <path key={patch.key} className={patch.age} data-map-path={JSON.stringify(patch.points)} data-closed="true" data-map-fill="true"/>)}</g>;
}

export function ReconnaissanceLegend({ coverage }: { coverage?: ReconCoverage }) {
  if (!coverage?.cells.length) return null;
  return <div className="fleet-recon-legend" aria-label="Visual search coverage age" title="Sampled lookout visibility for a 100 m surface vessel with a 5 m visible feature, using actual range, horizon and terrain checks. This does not guarantee empty water or detection of smaller or submerged targets.">
    <strong>Surface search</strong><span className="current">Now</span><span className="recent">Past minute</span><span className="older">Older</span>
  </div>;
}

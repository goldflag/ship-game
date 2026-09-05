import { BUOYS } from '../game/Game';
import type { Telemetry } from '../game/types';

export function NavigationChart({ data }: { data: Telemetry }) {
  const scale = 0.055;
  const point = (x: number, z: number) => `${110 + (x - data.ship.x) * scale},${110 + (z - data.ship.z) * scale}`;
  return <div className="navigation-chart">
    <div className="chart-heading"><span>LOCAL CHART</span><span>2 KM</span></div>
    <svg viewBox="0 0 220 220" role="img" aria-label="Local navigation chart, north up. Your ship is centered with its course trail and four marker buoys.">
      <defs><clipPath id="chart-clip"><rect x="0" y="0" width="220" height="220"/></clipPath></defs>
      <g className="chart-grid"><path d="M0 55h220M0 110h220M0 165h220M55 0v220M110 0v220M165 0v220"/><circle cx="110" cy="110" r="55"/><circle cx="110" cy="110" r="98"/></g>
      <g clipPath="url(#chart-clip)">
        <polyline points={data.trail.map(p => point(p.x, p.z)).join(' ')} className="chart-trail"/>
        {BUOYS.map((buoy, i) => <circle key={i} cx={110 + (buoy.x - data.ship.x) * scale} cy={110 + (buoy.z - data.ship.z) * scale} r="3" fill={buoy.color} stroke="#d9eee6" strokeWidth="0.6"/>)}
      </g>
      <path d="m110 98 5 16-5-3-5 3Z" fill="#e0c88f" transform={`rotate(${data.ship.heading * 180 / Math.PI} 110 110)`}/>
      <path d="M110 82V67" stroke="#e0c88f" strokeDasharray="2 3" transform={`rotate(${data.ship.heading * 180 / Math.PI} 110 110)`}/>
      <text x="110" y="16" textAnchor="middle">N</text><text x="206" y="114" textAnchor="middle">E</text>
      <text x="110" y="211" textAnchor="middle">S</text><text x="14" y="114" textAnchor="middle">W</text>
    </svg>
    <div className="chart-footer"><span>TRACK {Math.round(data.ship.distance).toLocaleString()} M</span><span>N ↑</span></div>
  </div>;
}

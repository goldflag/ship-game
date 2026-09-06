import { coastOutline, oceanMap, DEFAULT_MAP } from '../maps/catalog';
import { useId, useState } from 'react';
import { BUOYS } from '../game/Game';
import type { Telemetry } from '../game/types';
import { Icon } from './Icons';
import { bindingLabel, type Keybindings } from '../game/keybindings';

const CHART_RANGES = [1000, 2000, 4000, 8000];

export function NavigationChart({ data, onResize, bindings }: { data: Telemetry; bindings: Keybindings; onResize(direction: number): void }) {
  const clipId = useId();
  const [zoom, setZoom] = useState(3);
  const radius = CHART_RANGES[zoom];
  const scale = 100 / radius;
  const point = (x: number, z: number) => `${110 + (x - data.ship.x) * scale},${110 + (z - data.ship.z) * scale}`;
  return <div className="navigation-chart">
    <svg viewBox="0 0 220 220" role="img" aria-label={`Navigation chart, north up, ${radius / 1000} kilometer radius. Your ship, friendly and enemy fleets, course trail and marker buoys.`}>
      <defs><clipPath id={clipId}><rect x="0" y="0" width="220" height="220"/></clipPath></defs>
      <g className="chart-grid"><path d="M0 55h220M0 110h220M0 165h220M55 0v220M110 0v220M165 0v220"/><circle cx="110" cy="110" r="50"/><circle cx="110" cy="110" r="100"/></g>
      <g clipPath={`url(#${clipId})`}>
        {data.islands?.map(island => <polygon key={island.id} points={coastOutline(island).map(([x, z]) => point(x, z)).join(' ')} fill="#65786a" fillOpacity=".65" stroke="#b3c5af" strokeWidth=".8"><title>Coastline</title></polygon>)}
        <path d="M110 110 57 8Q110-10 163 8Z" className="chart-view-cone" transform={`rotate(${(data.viewBearing ?? data.ship.heading) * 180 / Math.PI} 110 110)`}/>
        <polyline points={data.trail.map(p => point(p.x, p.z)).join(' ')} className="chart-trail"/>
        {data.combat?.airContacts?.map(contact => <path key={contact.id} d="M-3 0h6M0-3v6" transform={`translate(${point(contact.x, contact.z)})`} stroke={contact.team === 'friendly' ? 'var(--fleet-active)' : '#ff9c8d'} strokeWidth="1.2"><title>{contact.team} aircraft</title></path>)}
        {BUOYS.map((buoy, i) => <circle key={i} cx={110 + (buoy.x - data.ship.x) * scale} cy={110 + (buoy.z - data.ship.z) * scale} r="2.5" fill={buoy.color} stroke="#d9eee6" strokeWidth=".6"/>)}
        {data.combat?.contacts.filter(contact => contact.id !== data.ship.id && !contact.sunk).map(contact => <g key={contact.id} transform={`translate(${point(contact.x, contact.z)})`}>
          <title>{contact.team === 'friendly' ? 'Friendly' : 'Enemy'} · {contact.name}</title>
          <path d="m0-7 4 10-4-2-4 2Z" className={`chart-contact ${contact.team === 'friendly' ? 'chart-friendly' : ''}`} transform={`rotate(${contact.heading * 180 / Math.PI})`}/>
          {contact.id === data.combat?.targetId && <circle r="10" fill="none" stroke="var(--accent)" strokeWidth="1"/>}
        </g>)}
      </g>
      <path d="m110 101 4 13-4-3-4 3Z" fill="var(--fleet-active)" stroke="#142c35" strokeWidth=".8" transform={`rotate(${data.ship.heading * 180 / Math.PI} 110 110)`}/>
      <text x="110" y="16" textAnchor="middle">N</text><text x="209" y="114" textAnchor="middle">E</text><text x="11" y="114" textAnchor="middle">W</text>
    </svg>
    <span className="chart-orientation">{oceanMap(data.mapId ?? DEFAULT_MAP).name.toUpperCase()}</span>
    <button className="chart-range-button" title="Change chart range" aria-label={`Change chart range · Current radius ${radius / 1000} kilometers`} onClick={event => { setZoom(value => (value + 1) % CHART_RANGES.length); event.currentTarget.blur(); }}>{radius / 1000} km <Icon name="chevron" size={10}/></button>
    <div className="chart-controls"><span>SIZE</span><button aria-label={`Decrease minimap size · ${bindingLabel(bindings, 'chartSmaller')}`} title={`Smaller map · ${bindingLabel(bindings, 'chartSmaller')}`}  disabled={(data.chartSize ?? 2) === 0} onClick={event => { onResize(-1); event.currentTarget.blur(); }}><Icon name="minus" size={12}/></button><button aria-label={`Increase minimap size · ${bindingLabel(bindings, 'chartLarger')}`} title={`Larger map · ${bindingLabel(bindings, 'chartLarger')}`}  disabled={(data.chartSize ?? 2) === 4} onClick={event => { onResize(1); event.currentTarget.blur(); }}><Icon name="plus" size={12}/></button></div>
  </div>;
}

import { useId, useMemo, useRef, useState } from 'react';
import { coastOutline } from '../maps/catalog';
import { shipPreset } from '../ships/presets';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import type { Placement } from '../multiplayer/generated/Placement';
import { Button, Input } from './components';
import { deploymentIslands, moveFormation, placementError, unitName } from './pveSetup';

interface Props { briefing: PveBriefing; placements: Placement[]; onChange(value: Placement[]): void; disabled: boolean }
export function PveDeployment({ briefing, placements, onChange, disabled }: Props) {
  const [selected, setSelected] = useState<string[]>(briefing.assignments.filter(s => s.groupId === briefing.groups.find(g => briefing.assignments.some(unit => unit.groupId === g.id))?.id).map(s => s.id));
  const [history, setHistory] = useState<Placement[][]>([]);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, z: 0 });
  const svg = useRef<SVGSVGElement>(null), clip = useId();
  const islands = useMemo(() => deploymentIslands(briefing), [briefing]);
  const active = placements.filter(p => selected.includes(p.id));
  const x = active.reduce((n, p) => n + p.spawn.x, 0) / (active.length || 1), z = active.reduce((n, p) => n + p.spawn.z, 0) / (active.length || 1);
  const error = placementError(briefing, placements), radius = briefing.setup.missionRules!.area.radiusM, span = radius * 1.12 / zoom;
  const commit = (next: Placement[]) => { if (disabled) return; setHistory(h => [...h.slice(-29), placements]); onChange(next); };
  const move = (nx: number, nz: number, angle = 0) => commit(moveFormation(placements, selected, nx, nz, angle));
  const adjustZoom = (value: number) => { setZoom(value); setCenter(value === 1 ? { x: 0, z: 0 } : { x, z }); };
  return <div className="pve-deployment">
    <aside className="pve-deploy-roster" aria-label="Deployment task groups">
      <header><h2>Place task groups</h2><p>Select a group or ship, then click the chart. Arrows move the selection; Q / E rotate it.</p></header>
      <div className="pve-scroll">
        {briefing.groups.filter(g => briefing.assignments.some(s => s.groupId === g.id)).map(group => {
          const members = briefing.assignments.filter(s => s.groupId === group.id), ids = members.map(s => s.id);
          return <section key={group.id}>
            <Button disabled={disabled} className="pve-group-select" aria-pressed={ids.length === selected.length && ids.every(id => selected.includes(id))} onClick={() => setSelected(ids)}>{group.name}<small>{members.length} ships · {group.station === 'rear' ? 'Rear patrol' : 'Front station'}</small></Button>
            <ul>{members.map(unit => <li key={unit.id}><Button disabled={disabled} aria-pressed={selected.length === 1 && selected[0] === unit.id} onClick={() => setSelected([unit.id])}>{unitName(unit, briefing.assignments)}</Button></li>)}</ul>
          </section>;
        })}
      </div>
      <div className="pve-deploy-tools">
        <p>{active.length} selected · {Math.round(x / 100) / 10} km E, {Math.round(z / 100) / 10} km S</p>
        <div><Button disabled={disabled || !active.length} onClick={() => move(x, z, -Math.PI / 12)}>↶ 15°</Button><Button disabled={disabled || !active.length} onClick={() => move(x, z, Math.PI / 12)}>↷ 15°</Button></div>
        {active.length === 1 && <label>Heading <Input type="number" min="0" max="359" step="5" value={Math.round(((active[0].spawn.heading * 180 / Math.PI) % 360 + 360) % 360)} disabled={disabled} onChange={e => { if (e.target.value !== '') move(x, z, Number(e.target.value) * Math.PI / 180 - active[0].spawn.heading); }}/>°</label>}
        <div><Button disabled={disabled || !history.length} onClick={() => { onChange(history.at(-1)!); setHistory(h => h.slice(0, -1)); }}>Undo</Button><Button disabled={disabled} onClick={() => commit(briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! })))}>Reset positions</Button></div>
      </div>
    </aside>
    <div className="pve-chart-wrap">
      <div className="pve-chart-heading"><div><strong>Deployment chart</strong><span>25 km radius · enemy disposition unknown</span></div><div><Button aria-label="Zoom out" disabled={zoom === 1} onClick={() => adjustZoom(Math.max(1, zoom / 1.5))}>−</Button><Button aria-label="Zoom in on selection" disabled={zoom >= 4} onClick={() => adjustZoom(Math.min(4, zoom * 1.5))}>+</Button><Button onClick={() => adjustZoom(1)}>Full chart</Button></div></div>
      <svg ref={svg} className="pve-chart" viewBox={`${center.x - span} ${center.z - span} ${span * 2} ${span * 2}`} tabIndex={0} role="application" aria-label="Deployment chart. Select a group in the roster. Click friendly water to place it, or use arrow keys in 500 metre steps; Shift uses 100 metres. Q and E rotate 15 degrees."
        onClick={event => {
          if (disabled || !active.length || !svg.current) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current.getScreenCTM()!.inverse()); move(point.x, point.y);
        }} onKeyDown={event => {
          if (disabled || !active.length) return;
          const step = event.shiftKey ? 100 : 500;
          const delta: Record<string, [number, number, number]> = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], q: [0, 0, -Math.PI / 12], e: [0, 0, Math.PI / 12] };
          const d = delta[event.key]; if (d) { event.preventDefault(); event.stopPropagation(); move(x + d[0], z + d[1], d[2]); }
        }}>
        <defs><clipPath id={clip}><circle r={radius}/></clipPath></defs>
        <g clipPath={`url(#${clip})`}>
          <circle r={radius} className="pve-map-water"/>
          <rect x={-radius} y={briefing.deploymentMinZ} width={radius * 2} height={radius * 2} className="pve-friendly-sector"/>
          {Array.from({ length: 11 }, (_, i) => (i - 5) * 5000).map(n => <g key={n} className="pve-map-grid"><path d={`M ${n} ${-radius} V ${radius} M ${-radius} ${n} H ${radius}`}/></g>)}
          {islands.map(i => <polygon key={i.id} className="pve-map-land" points={coastOutline(i, 64).map(p => p.join(',')).join(' ')}/>)}
          <path className="pve-sector-edge" d={`M ${-radius} ${briefing.deploymentMinZ} H ${radius}`}/>
          <text x="0" y="-14000" className="pve-map-label" fontSize={750}>NO CONTACTS REPORTED</text>
          <text x="0" y="22500" className="pve-map-label" fontSize={650}>FRIENDLY DEPLOYMENT</text>
        </g>
        <circle r={radius} className="pve-map-boundary"/>
        <text x="0" y={-radius - 1100} className="pve-map-label" fontSize={850}>N</text>
        {placements.map(p => {
          const unit = briefing.assignments.find(s => s.id === p.id)!, name = unitName(unit, briefing.assignments), scale = 75 / zoom;
          return <g key={p.id} transform={`translate(${p.spawn.x} ${p.spawn.z})`} className={`pve-map-unit ${selected.includes(p.id) ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={`Select ${name}`} aria-pressed={selected.includes(p.id)}
            onClick={e => { e.stopPropagation(); if (!disabled) setSelected([p.id]); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!disabled) setSelected([p.id]); } }}>
            <title>{name} · {shipPreset(unit.presetId).hull.length.toFixed(0)} m</title>
            <circle r={scale * 9} className="pve-unit-hit"/>
            <path transform={`rotate(${p.spawn.heading * 180 / Math.PI}) scale(${scale})`} d="M 0 -8 L 4 0 L 3 7 L -3 7 L -4 0 Z"/>
            <text x={scale * 11} y={scale * 3} fontSize={scale * 10}>{briefing.assignments.indexOf(unit) + 1}</text>
          </g>;
        })}
      </svg>
      <p className={`pve-chart-status ${error ? 'is-error' : ''}`} role="status">{error || 'Placement clear. Front groups hold station; rear leaders patrol with their assigned escorts.'}</p>
    </div>
  </div>;
}

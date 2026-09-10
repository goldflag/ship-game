import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { assetUrl } from '../assetUrl';
import { coastOutline } from '../maps/catalog';
import { shipPreset } from '../ships/presets';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import type { Placement } from '../multiplayer/generated/Placement';
import { Button, Input } from './components';
import { deploymentIslands, moveFormation, placementError, unitName } from './pveSetup';
import { dragFormation, rotateFormation, zoomDeployment, type DeploymentPoint } from './deploymentGestures';

const PLACEMENT_DRAG = 'application/x-fleet-deployment';
interface Gesture {
  kind: 'pan' | 'move' | 'rotate'; pointer: number; inverse: DOMMatrix;
  start: DeploymentPoint; client: [number, number]; center: DeploymentPoint;
  placements: Placement[]; selected: string[]; moved: boolean;
}

interface Props { briefing: PveBriefing; placements: Placement[]; onChange(value: Placement[]): void; disabled: boolean }
export function PveDeployment({ briefing, placements, onChange, disabled }: Props) {
  const [selected, setSelected] = useState<string[]>(briefing.assignments.filter(s => s.groupId === briefing.groups.find(g => briefing.assignments.some(unit => unit.groupId === g.id))?.id).map(s => s.id));
  const [history, setHistory] = useState<Placement[][]>([]);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, z: 0 });
  const [dragging, setDragging] = useState(false), [dropActive, setDropActive] = useState(false);
  const gesture = useRef<Gesture | undefined>(undefined);
  const viewport = useRef({ center, zoom }); viewport.current = { center, zoom };
  const svg = useRef<SVGSVGElement>(null), clip = useId();
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const inverse = element.getScreenCTM()?.inverse();
      if (gesture.current || !inverse) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
      const next = zoomDeployment(viewport.current, { x: point.x, z: point.y }, event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1));
      viewport.current = next; setZoom(next.zoom); setCenter(next.center);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const islands = useMemo(() => deploymentIslands(briefing), [briefing]);
  const active = placements.filter(p => selected.includes(p.id));
  const x = active.reduce((n, p) => n + p.spawn.x, 0) / (active.length || 1), z = active.reduce((n, p) => n + p.spawn.z, 0) / (active.length || 1);
  const error = placementError(briefing, placements), radius = briefing.setup.missionRules!.area.radiusM, span = radius * 1.12 / zoom;
  const commit = (next: Placement[]) => { if (disabled) return; setHistory(h => [...h.slice(-29), placements]); onChange(next); };
  const move = (nx: number, nz: number, angle = 0) => commit(moveFormation(placements, selected, nx, nz, angle));
  const worldPoint = (clientX: number, clientY: number, inverse = svg.current?.getScreenCTM()?.inverse()) => {
    if (!inverse) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(inverse);
    return { x: point.x, z: point.y };
  };
  const startGesture = (event: PointerEvent<SVGElement>, kind: Gesture['kind'], ids = selected) => {
    if (disabled || (event.button !== 0 && (kind !== 'pan' || event.button !== 1))) return;
    event.preventDefault(); event.stopPropagation();
    const inverse = svg.current?.getScreenCTM()?.inverse(), start = worldPoint(event.clientX, event.clientY, inverse);
    if (!inverse || !start || !svg.current) return;
    svg.current.focus(); svg.current.setPointerCapture(event.pointerId);
    gesture.current = { kind, pointer: event.pointerId, inverse, start, client: [event.clientX, event.clientY], center,
      placements, selected: ids, moved: false };
    setDragging(true);
  };
  const finishGesture = (cancel = false) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined; setDragging(false);
    if (current.moved) {
      if (cancel) { if (current.kind === 'pan') setCenter(current.center); else onChange(current.placements); }
      else if (current.kind !== 'pan') setHistory(h => [...h.slice(-29), current.placements]);
    }
    if (svg.current?.hasPointerCapture(current.pointer)) svg.current.releasePointerCapture(current.pointer);
  };
  const rosterDrag = (event: DragEvent, ids: string[]) => {
    event.stopPropagation();
    if (disabled) { event.preventDefault(); return; }
    setSelected(ids); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(PLACEMENT_DRAG, JSON.stringify(ids));
  };
  const rotationRadius = Math.max(0, ...active.map(p => Math.hypot(p.spawn.x - x, p.spawn.z - z))) + 1600 / zoom;
  return <div className="pve-deployment">
    <aside className="pve-deploy-roster" aria-label="Deployment task groups">
      <header><h2>Place task groups</h2><p>Drag ships or groups onto the chart. Drag water to pan; scroll to zoom. The round handle rotates; Home resets the view.</p></header>
      <div className="pve-scroll">
        {briefing.groups.filter(g => briefing.assignments.some(s => s.groupId === g.id)).map(group => {
          const members = briefing.assignments.filter(s => s.groupId === group.id), ids = members.map(s => s.id);
          return <section key={group.id}>
            <Button disabled={disabled} draggable={!disabled} onDragStart={event => rosterDrag(event, ids)} className="pve-group-select" aria-pressed={ids.length === selected.length && ids.every(id => selected.includes(id))} onClick={() => setSelected(ids)}>{group.name}<small>{members.length} {members.length === 1 ? 'ship' : 'ships'}</small></Button>
            <ul>{members.map(unit => <li key={unit.id}><Button disabled={disabled} draggable={!disabled} onDragStart={event => rosterDrag(event, [unit.id])} className="pve-deploy-ship" aria-pressed={selected.length === 1 && selected[0] === unit.id} onClick={() => setSelected([unit.id])}>
              <img src={assetUrl(`models/${unit.presetId}-thumbnail.png`)} alt="" width="112" height="38" draggable={false}/><span>{unitName(unit, briefing.assignments)}</span>
            </Button></li>)}</ul>
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
      <svg ref={svg} className={`pve-chart ${dragging ? 'is-dragging' : ''} ${dropActive ? 'is-drop-target' : ''}`} viewBox={`${center.x - span} ${center.z - span} ${span * 2} ${span * 2}`} tabIndex={0} role="application" aria-label="Deployment chart. Drag ships or groups to move them. Drag empty water to pan and scroll to zoom. Drag the round handle to rotate. Arrows move 500 metres; Shift uses 100 metres. Q and E rotate 15 degrees. Home shows the full chart. Escape cancels a drag."
        onPointerDown={event => startGesture(event, 'pan')}
        onPointerMove={event => {
          const current = gesture.current;
          if (!current || current.pointer !== event.pointerId) return;
          if (!current.moved && Math.hypot(event.clientX - current.client[0], event.clientY - current.client[1]) < 3) return;
          const point = worldPoint(event.clientX, event.clientY, current.inverse);
          if (!point) return;
          current.moved = true;
          if (current.kind === 'pan') setCenter({ x: current.center.x + current.start.x - point.x, z: current.center.z + current.start.z - point.z });
          else onChange(current.kind === 'move' ? dragFormation(current.placements, current.selected, current.start, point) : rotateFormation(current.placements, current.selected, current.start, point));
        }} onPointerUp={() => finishGesture()} onPointerCancel={() => finishGesture(true)} onLostPointerCapture={() => finishGesture(true)}
        onDragOver={event => {
          if (disabled || !event.dataTransfer.types.includes(PLACEMENT_DRAG)) return;
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropActive(true);
        }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }}
        onDrop={event => {
          event.preventDefault(); event.stopPropagation(); setDropActive(false);
          if (disabled) return;
          const point = worldPoint(event.clientX, event.clientY);
          if (!point) return;
          try {
            const data: unknown = JSON.parse(event.dataTransfer.getData(PLACEMENT_DRAG));
            const ids = Array.isArray(data) ? placements.filter(p => data.includes(p.id)).map(p => p.id) : [];
            if (ids.length) { setSelected(ids); commit(moveFormation(placements, ids, point.x, point.z)); }
          } catch { /* Ignore drops that are not a deployment selection. */ }
        }} onKeyDown={event => {
          if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); finishGesture(true); return; }
          if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); setZoom(1); setCenter({ x: 0, z: 0 }); return; }
          if (['+', '=', '-'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            const next = zoomDeployment({ center, zoom }, active.length ? { x, z } : center, event.key === '-' ? 120 : -120);
            setZoom(next.zoom); setCenter(next.center); return;
          }
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
            onPointerDown={event => {
              event.stopPropagation(); if (disabled || event.button !== 0) return;
              if (event.shiftKey) { setSelected(ids => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id]); return; }
              const ids = selected.includes(p.id) ? selected : [p.id]; setSelected(ids); startGesture(event, 'move', ids);
            }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!disabled) setSelected([p.id]); } }}>
            <title>{name} · {shipPreset(unit.presetId).hull.length.toFixed(0)} m</title>
            <circle r={scale * 9} className="pve-unit-hit"/>
            <path transform={`rotate(${p.spawn.heading * 180 / Math.PI}) scale(${scale})`} d="M 0 -8 L 4 0 L 3 7 L -3 7 L -4 0 Z"/>
            <text x={scale * 11} y={scale * 3} fontSize={scale * 10}>{briefing.assignments.indexOf(unit) + 1}</text>
          </g>;
        })}
        {!!active.length && <g className="pve-rotation-handle" transform={`translate(${x} ${z}) rotate(${active[0].spawn.heading * 180 / Math.PI})`} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="Rotate selected ships. Drag the handle, or press Q or E."
          onPointerDown={event => startGesture(event, 'rotate')} onClick={event => event.stopPropagation()}>
          <line x1="0" y1={-700 / zoom} x2="0" y2={-rotationRadius}/>
          <circle className="pve-rotation-hit" cy={-rotationRadius} r={1100 / zoom}/>
          <circle cy={-rotationRadius} r={600 / zoom}/>
          <path transform={`translate(0 ${-rotationRadius}) scale(${65 / zoom})`} d="M-5-4A6 6 0 1 1-5 4M-5-4H1M-5-4V-10"/>
          <title>Drag to rotate the selection</title>
        </g>}
      </svg>
      <p className={`pve-chart-status ${error ? 'is-error' : ''}`} role="status">{error || 'Placement clear.'}</p>
    </div>
  </div>;
}

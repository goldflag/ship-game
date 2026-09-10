import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { coastOutline } from '../../maps/catalog';
import { shipPreset } from '../../ships/presets';
import { dragFormation, rotateFormation, zoomDeployment, type DeploymentPoint } from '../deploymentGestures';
import { formationLabel } from '../formationStations';
import { moveFormation } from '../pveSetup';
import { SHIP_GLYPHS, shipClassOf } from '../shipGlyphs';
import { formatHeading, headingDegrees, unitsBox, unitsCenter, type ChartUnit, type Deployment } from './deploymentModel';

export const DEPLOYMENT_DRAG = 'application/x-fleet-deployment';
export type ChartSelection = { kind: 'group' | 'ship'; id: string } | undefined;
export type ChartScope = 'group' | 'ship';
interface Gesture {
  kind: 'pan' | 'move' | 'rotate'; pointer: number; inverse: DOMMatrix; start: DeploymentPoint; client: [number, number];
  center: DeploymentPoint; units: ChartUnit[]; ids: string[]; moved: boolean;
}
interface Props {
  deployment: Deployment; fit: number; onChange(units: ChartUnit[]): void; onCommit(before: ChartUnit[]): void;
  selection: ChartSelection; onSelect(selection: ChartSelection): void; scope: ChartScope; onScopeChange(scope: ChartScope): void;
  disabled?: boolean;
}
export function selectedUnits(deployment: Deployment, selection: ChartSelection): ChartUnit[] {
  if (!selection) return [];
  return deployment.units.filter(unit => selection.kind === 'ship' ? unit.id === selection.id : unit.groupId === selection.id);
}

/** North-up chart. Frames and tags move a group, ship markers move one ship, the compass ring turns the selection. */
export function DeploymentChart({ deployment, fit, onChange, onCommit, selection, onSelect, scope, onScopeChange, disabled }: Props) {
  const svg = useRef<SVGSVGElement>(null), clip = useId(), gesture = useRef<Gesture | undefined>(undefined);
  const [zoom, setZoom] = useState(1), [center, setCenter] = useState(deployment.focus);
  const [size, setSize] = useState({ w: 600, h: 600 });
  const [dragging, setDragging] = useState(false), [dropActive, setDropActive] = useState(false);
  const viewport = useRef({ center, zoom }); viewport.current = { center, zoom };
  const focusX = deployment.focus.x, focusZ = deployment.focus.z;
  useEffect(() => { setZoom(1); setCenter({ x: focusX, z: focusZ }); }, [fit, focusX, focusZ]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => { const rect = entries[0].contentRect; if (rect.width && rect.height) setSize({ w: rect.width, h: rect.height }); });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const inverse = element.getScreenCTM()?.inverse();
      if (gesture.current || !inverse) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
      const next = zoomDeployment(viewport.current, { x: point.x, z: point.y }, event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1));
      viewport.current = next; setZoom(next.zoom); setCenter(next.center);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);

  // The fit spans the shorter axis, so zoom 1 shows the whole battle area however wide the chart is.
  const span = fit / zoom, wide = size.w >= size.h;
  const halfW = wide ? span * (size.w / size.h) : span, halfH = wide ? span : span * (size.h / size.w);
  const view = { x: center.x - halfW, z: center.z - halfH, w: halfW * 2, h: halfH * 2 };
  const k = view.w / size.w; // metres per CSS pixel
  const units = deployment.units, active = selectedUnits(deployment, selection);
  const focus = active.length ? unitsCenter(active) : undefined;
  const worldPoint = (clientX: number, clientY: number, inverse = svg.current?.getScreenCTM()?.inverse()): DeploymentPoint | undefined => {
    if (!inverse) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(inverse);
    return { x: point.x, z: point.y };
  };
  const startGesture = (event: ReactPointerEvent<SVGElement>, kind: Gesture['kind'], ids: string[] = []) => {
    if (disabled && kind !== 'pan') return;
    if (event.button !== 0 && (kind !== 'pan' || event.button !== 1)) return;
    event.preventDefault(); event.stopPropagation();
    const inverse = svg.current?.getScreenCTM()?.inverse(), start = worldPoint(event.clientX, event.clientY, inverse);
    if (!inverse || !start || !svg.current) return;
    svg.current.focus({ preventScroll: true }); svg.current.setPointerCapture(event.pointerId);
    const moving = units.filter(unit => ids.includes(unit.id));
    gesture.current = { kind, pointer: event.pointerId, inverse, start, client: [event.clientX, event.clientY], center: kind === 'pan' ? center : unitsCenter(moving), units, ids, moved: false };
    setDragging(true);
  };
  const finishGesture = (cancel = false) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined; setDragging(false);
    if (current.moved) {
      if (cancel) { if (current.kind === 'pan') setCenter(current.center); else onChange(current.units); }
      else if (current.kind !== 'pan') onCommit(current.units);
    }
    // Press and release on open water without moving: nothing was aimed at, so let the selection go.
    else if (!cancel && current.kind === 'pan' && selection) onSelect(undefined);
    if (svg.current?.hasPointerCapture(current.pointer)) svg.current.releasePointerCapture(current.pointer);
  };
  const pressShip = (event: ReactPointerEvent<SVGElement>, unit: ChartUnit) => {
    event.stopPropagation();
    if (disabled || event.button !== 0) return;
    const asShip = scope === 'ship' || event.altKey;
    const next: ChartSelection = asShip ? { kind: 'ship', id: unit.id } : { kind: 'group', id: unit.groupId };
    onSelect(next);
    startGesture(event, 'move', asShip ? [unit.id] : units.filter(other => other.groupId === unit.groupId).map(other => other.id));
  };
  const pressGroup = (event: ReactPointerEvent<SVGElement>, groupId: string) => {
    event.stopPropagation();
    if (disabled || event.button !== 0) return;
    onSelect({ kind: 'group', id: groupId });
    startGesture(event, 'move', units.filter(unit => unit.groupId === groupId).map(unit => unit.id));
  };
  const pressRotate = (event: ReactPointerEvent<SVGElement>) => { event.stopPropagation(); startGesture(event, 'rotate', active.map(unit => unit.id)); };
  const nudge = (dx: number, dz: number, turn = 0) => {
    if (disabled || !active.length || !focus) return;
    const ids = active.map(unit => unit.id);
    onChange(moveFormation(units, ids, focus.x + dx, focus.z + dz, turn)); onCommit(units);
  };
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      if (gesture.current) { event.preventDefault(); event.stopPropagation(); finishGesture(true); return; }
      // Nothing is dragging, so Escape clears the selection before the dialog sees it.
      if (selection) { event.preventDefault(); event.stopPropagation(); onSelect(undefined); }
      return;
    }
    if (key === 'home') { event.preventDefault(); event.stopPropagation(); setZoom(1); setCenter(deployment.focus); return; }
    if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = zoomDeployment({ center, zoom }, focus ?? center, event.key === '-' ? 120 : -120);
      setZoom(next.zoom); setCenter(next.center); return;
    }
    if (key === 'g' || key === 's') { event.preventDefault(); event.stopPropagation(); onScopeChange(key === 'g' ? 'group' : 'ship'); return; }
    const step = event.shiftKey ? 100 : 500;
    const delta: Record<string, [number, number, number]> = { arrowleft: [-step, 0, 0], arrowright: [step, 0, 0], arrowup: [0, -step, 0], arrowdown: [0, step, 0], q: [0, 0, -Math.PI / 12], e: [0, 0, Math.PI / 12] };
    const move = delta[key];
    if (move) { event.preventDefault(); event.stopPropagation(); nudge(...move); }
  };

  const bounds = deployment.bounds, radius = bounds.kind === 'circle' ? bounds.radius : bounds.half;
  const gridStep = fit > 12000 ? 5000 : 1000;
  const gridLines: number[] = [];
  for (let n = Math.floor(Math.max(view.x, -radius) / gridStep) * gridStep; n <= Math.min(view.x + view.w, radius); n += gridStep) gridLines.push(n);
  const gridRows: number[] = [];
  for (let n = Math.floor(Math.max(view.z, -radius) / gridStep) * gridStep; n <= Math.min(view.z + view.h, radius); n += gridStep) gridRows.push(n);
  const groups = deployment.groups.map(group => ({ ...group, units: units.filter(unit => unit.groupId === group.id) })).filter(group => group.units.length);
  const px = (value: number) => value * k;
  const ring = active.length && focus ? (() => {
    const one = selection?.kind === 'ship';
    const box = unitsBox(active), pad = px(26);
    const r = one ? px(34) : Math.hypot((box.x1 - box.x0) / 2 + pad, (box.z1 - box.z0) / 2 + pad) + px(22);
    return { r, heading: active[0].spawn.heading };
  })() : undefined;
  let number = 0;
  return <svg ref={svg} className={`deploy-chart ${dragging ? 'is-dragging' : ''} ${dropActive ? 'is-drop-target' : ''}`} viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`} tabIndex={0} role="application"
    aria-label="Deployment chart. Drag a frame or its tag to move a group; drag a ship to move that ship. Drag the ring, the heading knob or the heading readout to rotate. Arrows move 500 metres, Shift 100 metres. Q and E rotate 15 degrees. G and S change the selection scope. Scroll to zoom, drag water to pan, click open water to deselect, Home shows the full chart, Escape cancels a drag or clears the selection."
    onPointerDown={event => startGesture(event, 'pan')}
    onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (!current.moved && Math.hypot(event.clientX - current.client[0], event.clientY - current.client[1]) < 3) return;
      const point = worldPoint(event.clientX, event.clientY, current.inverse);
      if (!point) return;
      current.moved = true;
      if (current.kind === 'pan') setCenter({ x: current.center.x + current.start.x - point.x, z: current.center.z + current.start.z - point.z });
      else if (current.kind === 'move') onChange(dragFormation(current.units, current.ids, current.start, point));
      else onChange(rotateFormation(current.units, current.ids, current.start, point, (event.shiftKey ? 15 : 5) * Math.PI / 180));
    }}
    onPointerUp={() => finishGesture()} onPointerCancel={() => finishGesture(true)} onLostPointerCapture={() => finishGesture(true)}
    onDragOver={event => { if (disabled || !event.dataTransfer.types.includes(DEPLOYMENT_DRAG)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropActive(true); }}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }}
    onDrop={(event: DragEvent<SVGSVGElement>) => {
      event.preventDefault(); event.stopPropagation(); setDropActive(false);
      if (disabled) return;
      const point = worldPoint(event.clientX, event.clientY);
      if (!point) return;
      try {
        const data: unknown = JSON.parse(event.dataTransfer.getData(DEPLOYMENT_DRAG));
        const ids = Array.isArray(data) ? units.filter(unit => data.includes(unit.id)).map(unit => unit.id) : [];
        if (!ids.length) return;
        const first = units.find(unit => unit.id === ids[0])!;
        onSelect(ids.length === 1 ? { kind: 'ship', id: ids[0] } : { kind: 'group', id: first.groupId });
        onChange(moveFormation(units, ids, point.x, point.z)); onCommit(units);
      } catch { /* Ignore drops that are not a deployment selection. */ }
    }}
    onKeyDown={keyDown}>
    <defs>{bounds.kind === 'circle' && <clipPath id={clip}><circle r={bounds.radius}/></clipPath>}</defs>
    <g clipPath={bounds.kind === 'circle' ? `url(#${clip})` : undefined}>
      {bounds.kind === 'circle' ? <circle r={bounds.radius} className="chart-water"/> : <rect x={view.x} y={view.z} width={view.w} height={view.h} className="chart-water"/>}
      {deployment.friendlyMinZ !== undefined && <rect x={-radius} y={deployment.friendlyMinZ} width={radius * 2} height={radius * 2} className="chart-sector"/>}
      <path className="chart-grid" d={[...gridLines.map(n => `M ${n} ${-radius} V ${radius}`), ...gridRows.map(n => `M ${-radius} ${n} H ${radius}`)].join(' ')}/>
      {deployment.islands.map(island => <polygon key={island.id} className="chart-land" points={coastOutline(island, 64).map(p => p.join(',')).join(' ')}/>)}
      {deployment.friendlyMinZ !== undefined && <path className="chart-edge" d={`M ${-radius} ${deployment.friendlyMinZ} H ${radius}`}/>}
      {deployment.labels.north && <text x="0" y={-radius * .56} className="chart-label" fontSize={px(11)}>{deployment.labels.north}</text>}
      {deployment.labels.south && <text x="0" y={radius * .86} className="chart-label" fontSize={px(11)}>{deployment.labels.south}</text>}
    </g>
    {bounds.kind === 'circle' && <><circle r={bounds.radius} className="chart-boundary"/><text x="0" y={-bounds.radius - px(12)} className="chart-rose" fontSize={px(13)}>N</text></>}
    {bounds.kind === 'square' && <text x={view.x + px(14)} y={view.z + px(20)} className="chart-rose" fontSize={px(13)} textAnchor="start">N ↑</text>}
    {/* The compass ring sits beneath every frame, tag and ship marker: SVG paints later
        siblings on top, so a press on another group always reaches that group instead of
        starting a rotation of the current selection. */}
    {ring && focus && <g className="chart-ring-group" transform={`translate(${focus.x} ${focus.z})`}>
      <circle className="chart-ring-hit" r={ring.r} style={{ strokeWidth: px(28) }} onPointerDown={pressRotate} onClick={event => event.stopPropagation()}/>
      <circle className="chart-ring" r={ring.r}/>
      {Array.from({ length: 24 }, (_, i) => i * 15).map(angle => {
        const major = angle % 90 === 0, length = px(major ? 9 : angle % 45 === 0 ? 7 : 4), rad = angle * Math.PI / 180;
        return <line key={angle} className={`chart-tick ${major ? 'major' : ''}`} x1={Math.sin(rad) * ring.r} y1={-Math.cos(rad) * ring.r} x2={Math.sin(rad) * (ring.r + length)} y2={-Math.cos(rad) * (ring.r + length)}/>;
      })}
      {([['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const).map(([letter, angle]) => { const rad = angle * Math.PI / 180, d = ring.r + px(19); return <text key={letter} className="chart-rose" x={Math.sin(rad) * d} y={-Math.cos(rad) * d + px(4)} fontSize={px(9)} opacity=".7">{letter}</text>; })}
      <g className="chart-knob" transform={`rotate(${headingDegrees(ring.heading)})`} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="Rotate the selection. Drag the heading knob, or press Q or E."
        onPointerDown={pressRotate} onClick={event => event.stopPropagation()}>
        <g transform={`translate(0 ${-ring.r})`}>
          <circle className="chart-knob-hit" r={px(16)}/>
          <circle className="chart-knob-face" r={px(11)}/>
          <path className="chart-handle" transform={`scale(${px(1)})`} d="M0 -6.5 5 4.5 0 2 -5 4.5Z"/>
        </g>
      </g>
      <g className="chart-readout" transform={`translate(${Math.sin(ring.heading) * (ring.r + px(42))} ${-Math.cos(ring.heading) * (ring.r + px(42))})`}
        role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`Heading ${formatHeading(ring.heading)}. Drag to rotate the selection.`}
        onPointerDown={pressRotate} onClick={event => event.stopPropagation()}>
        <rect className="chart-readout-hit" x={-px(26)} y={-px(13)} width={px(52)} height={px(26)}/>
        <rect x={-px(19)} y={-px(9)} width={px(38)} height={px(18)} rx={px(2)}/><text y={px(4.5)} fontSize={px(11)}>{formatHeading(ring.heading)}</text>
      </g>
    </g>}
    {groups.map(group => {
      const box = unitsBox(group.units), pad = px(26), x = box.x0 - pad, z = box.z0 - pad, w = box.x1 - box.x0 + pad * 2, h = box.z1 - box.z0 + pad * 2;
      const selected = selection?.kind === 'group' && selection.id === group.id;
      const label = `${group.name.toUpperCase()} · ${group.units.length} ${group.units.length === 1 ? 'SHIP' : 'SHIPS'}${group.formation ? ` · ${formationLabel(group.formation).toUpperCase()}` : ''}`;
      const tagWidth = px(label.length * 6.4 + 16), tagHeight = px(18);
      return <g key={group.id} className={`chart-group ${group.side} ${selected ? 'is-selected' : ''}`}>
        <rect className="chart-frame" x={x} y={z} width={w} height={h} rx={px(8)} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Select ${group.name}`} aria-pressed={selected}
          onPointerDown={event => pressGroup(event, group.id)} onClick={event => event.stopPropagation()}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (!disabled) onSelect({ kind: 'group', id: group.id }); } }}/>
        <g className="chart-tag" onPointerDown={event => pressGroup(event, group.id)} onClick={event => event.stopPropagation()}>
          <rect x={x} y={z - tagHeight - px(4)} width={tagWidth} height={tagHeight} rx={px(2)}/>
          <text x={x + px(8)} y={z - tagHeight - px(4) + px(13)} fontSize={px(10)}>{label}</text>
        </g>
      </g>;
    })}
    {units.map(unit => {
      number++;
      const selected = active.some(other => other.id === unit.id), own = selection?.kind === 'ship' && selection.id === unit.id;
      const shipClass = shipClassOf(shipPreset(unit.presetId)), glyph = SHIP_GLYPHS[shipClass];
      return <g key={unit.id} transform={`translate(${unit.spawn.x} ${unit.spawn.z})`} className={`chart-ship ${unit.side} ${selected ? 'is-selected' : ''} ${own ? 'is-focus' : ''}`} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Select ${unit.name}`} aria-pressed={own}
        onPointerDown={event => pressShip(event, unit)} onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (!disabled) onSelect(scope === 'ship' ? { kind: 'ship', id: unit.id } : { kind: 'group', id: unit.groupId }); } }}>
        <title>{`${unit.name} · ${shipClass} · ${shipPreset(unit.presetId).hull.length.toFixed(0)} m · ${formatHeading(unit.spawn.heading)}`}</title>
        <circle r={px(13)} className="chart-ship-hit"/>
        <g transform={`rotate(${headingDegrees(unit.spawn.heading)}) scale(${px(.95)})`}>
          <path className="chart-hull" d={glyph.hull}/><path className="chart-mark" d={glyph.mark}/>
        </g>
        <text x={px(14)} y={px(4)} fontSize={px(10)}>{number}</text>
      </g>;
    })}
  </svg>;
}

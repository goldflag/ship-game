import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ConstructionBalcony, ConstructionPrimitive } from '../../ships/blueprint';
import { balconyProblem, defaultBalcony } from '../../ships/constructionBalcony';
import { newConstructionId } from '../../ships/constructionEditor';
import { NumberField } from './NumberField';
import './BalconyEditor.css';

/** One outline edit is one source command; an interrupted drag never saves. */
export function BalconyEditor({ primitive, onChange, onClose }: {
  primitive: ConstructionPrimitive; onChange(value: ConstructionPrimitive): void; onClose(): void;
}) {
  const [draft, setDraft] = useState(() => primitive.balcony ?? defaultBalcony());
  const [selected, setSelected] = useState(0);
  const [gridStep, setGridStep] = useState(.25);
  const latest = useRef(draft), drag = useRef<{ id: number; baseline: ConstructionBalcony; indices: number[]; x: number; y: number; scale: number; extent: number } | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null);
  const update = (value: ConstructionBalcony) => { latest.current = value; setDraft(value); };
  const commit = (value: ConstructionBalcony) => { update(value); onChange({ ...primitive, balcony: value }); };
  const edit = (change: (value: ConstructionBalcony) => void) => { const value = structuredClone(draft); change(value); commit(value); };
  const cancel = () => { if (drag.current) { update(drag.current.baseline); drag.current = undefined; } };
  useEffect(() => { update(primitive.balcony ?? defaultBalcony()); setSelected(i => Math.min(i, (primitive.balcony?.points.length ?? 4) - 1)); }, [primitive]);
  useEffect(() => { window.addEventListener('blur', cancel); return () => window.removeEventListener('blur', cancel); }, []);
  const point = draft.points[selected] ?? draft.points[0], next = (selected + 1) % draft.points.length;
  const extent = drag.current?.extent ?? Math.max(primitive.size[0], primitive.size[2], ...draft.points.flatMap(p => [Math.abs(p.x * primitive.size[0]) * 2.4, Math.abs(p.z * primitive.size[2]) * 2.4]));
  const scale = 240 / extent;
  const snap = (meters: number) => gridStep ? Math.round(meters / gridStep) * gridStep : meters;
  // Keep large-platform drawings bounded; visible lines remain grid multiples.
  const visibleStep = gridStep ? gridStep * Math.max(1, Math.ceil(extent / gridStep / 60)) : 0;
  const gridLines = visibleStep ? Array.from({ length: Math.floor(130 / scale / visibleStep) * 2 + 1 }, (_, i) => 150 + (i - Math.floor(130 / scale / visibleStep)) * visibleStep * scale) : [];
  const project = (p: { x: number; z: number }) => [150 + p.x * primitive.size[0] * scale, 150 + p.z * primitive.size[2] * scale];
  /** Move points together by metres: the first lands on the grid and the rest keep their offsets, so a dragged edge keeps its shape. */
  const moved = (from: ConstructionBalcony, indices: number[], dx: number, dz: number) => {
    const value = structuredClone(from);
    for (const [key, axis, raw] of [['x', 0, dx], ['z', 2, dz]] as const) {
      const size = primitive.size[axis], at = indices.map(i => from.points[i][key] * size);
      const delta = Math.max(...at.map(m => -2 * size - m), Math.min(...at.map(m => 2 * size - m), snap(at[0] + raw) - at[0]));
      for (const i of indices) value.points[i][key] = (from.points[i][key] * size + delta) / size;
    }
    return value;
  };
  const startDrag = (event: ReactPointerEvent, indices: number[]) => {
    drag.current = { id: event.pointerId, baseline: structuredClone(draft), indices, x: event.clientX, y: event.clientY, scale: scale * svg.current!.getBoundingClientRect().width / 300, extent };
    svg.current!.setPointerCapture(event.pointerId);
  };
  const nudge = (event: ReactKeyboardEvent, indices: number[]) => {
    const step = gridStep || .1, [dx, dz] = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[event.key] ?? [0, 0];
    commit(moved(draft, indices, dx, dz));
  };
  /** Split edge i where it was clicked, on the grid when the grid point lies on the edge. */
  const splitAt = (i: number, event: ReactMouseEvent) => {
    if (draft.points.length >= 32) return;
    const box = svg.current!.getBoundingClientRect(), [sx, , sz] = primitive.size;
    const a = draft.points[i], b = draft.points[(i + 1) % draft.points.length];
    const ax = a.x * sx, az = a.z * sz, ex = b.x * sx - ax, ez = b.z * sz - az, length = ex * ex + ez * ez;
    const along = (x: number, z: number) => ((x - ax) * ex + (z - az) * ez) / length;
    const cx = ((event.clientX - box.left) * 300 / box.width - 150) / scale, cz = ((event.clientY - box.top) * 300 / box.height - 150) / scale;
    let t = Math.max(.05, Math.min(.95, along(cx, cz)));
    const gx = snap(ax + ex * t), gz = snap(az + ez * t), gt = along(gx, gz);
    if (gt > .01 && gt < .99 && Math.hypot(ax + ex * gt - gx, az + ez * gt - gz) < 1e-6) t = gt;
    edit(value => { value.points.splice(i + 1, 0, { id: newConstructionId('point'), x: (ax + ex * t) / sx, z: (az + ez * t) / sz, edge: a.edge }); });
    setSelected(i + 1);
  };
  const problem = balconyProblem(draft);
  return <section className="sb-balcony" aria-label="Balcony outline editor" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (drag.current) cancel(); else onClose(); }
  }}>
    <header><h2>Balcony outline</h2><button className="sb-edit-freeform" onClick={onClose}>Done</button></header>
    <p>Drag a point or an edge. Right-click an edge to add a point. Select an edge to choose its finish.</p>
    <div className="sb-balcony-grid-control"><span>Grid spacing · m</span><div className="sb-snap-steps" role="group" aria-label="Balcony grid step">
      {[0, .125, .25, .5, 1].map(step => <button key={step} type="button" aria-label={step ? `${step} m` : 'No grid'} aria-pressed={gridStep === step} onClick={() => { cancel(); setGridStep(step); }}>{step || 'No grid'}</button>)}
    </div></div>
    <svg ref={svg} viewBox="0 0 300 300" aria-label="Balcony plan drawing" onPointerMove={event => {
      const current = drag.current; if (!current || current.id !== event.pointerId) return;
      update(moved(current.baseline, current.indices, (event.clientX - current.x) / current.scale, (event.clientY - current.y) / current.scale));
    }} onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      const before = drag.current.baseline; drag.current = undefined;
      if (JSON.stringify(before) !== JSON.stringify(latest.current)) commit(latest.current);
    }} onPointerCancel={cancel} onLostPointerCapture={cancel} onContextMenu={event => { event.preventDefault(); cancel(); }}>
      <polygon className="sb-balcony-deck" points={draft.points.map(p => project(p).join(',')).join(' ')} />
      {gridLines.map(at => <path key={at} className="sb-balcony-grid" d={`M${at} 20V280M20 ${at}H280`} />)}
      <path className="sb-balcony-axis" d="M150 20V280M20 150H280" />
      <text x="150" y="16" textAnchor="middle">LOCAL BOW · −Z</text>
      {draft.points.map((p, i) => {
        const [x, y] = project(p), [nx, ny] = project(draft.points[(i + 1) % draft.points.length]);
        return <g key={p.id}>
          <line className={`sb-balcony-edge ${p.edge}${i === selected ? ' selected' : ''}`} x1={x} y1={y} x2={nx} y2={ny} />
          <line className="sb-balcony-hit" x1={x} y1={y} x2={nx} y2={ny} role="button" tabIndex={0} aria-label={`Edge ${i + 1} to ${(i + 1) % draft.points.length + 1}: ${p.edge}`} onClick={() => setSelected(i)} onPointerDown={event => {
            if (event.button !== 0 || event.ctrlKey) return;
            event.preventDefault(); event.currentTarget.focus(); setSelected(i); startDrag(event, [i, (i + 1) % draft.points.length]);
          }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (drag.current) cancel(); else splitAt(i, event); }} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); setSelected(i);
            if (event.key.startsWith('Arrow')) nudge(event, [i, (i + 1) % draft.points.length]);
          }} />
        </g>;
      })}
      {draft.points.map((p, i) => {
        const [x, y] = project(p);
        return <g key={p.id}>
          <circle className={`sb-balcony-point${i === selected ? ' selected' : ''}`} cx={x} cy={y} r="7" role="button" tabIndex={0} aria-label={`Outline point ${i + 1}`} onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus(); setSelected(i); startDrag(event, [i]);
          }} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); setSelected(i);
            if (event.key.startsWith('Arrow')) nudge(event, [i]);
          }} />
          <text className="sb-balcony-number" x={x + 11} y={y - 10}>{i + 1}</text>
        </g>;
      })}
    </svg>
    <div className="sb-balcony-actions">
      <button disabled={draft.points.length >= 32} onClick={() => { edit(b => { const a = b.points[selected], z = b.points[next]; b.points.splice(selected + 1, 0, { id: newConstructionId('point'), x: (a.x + z.x) / 2, z: (a.z + z.z) / 2, edge: a.edge }); }); setSelected(selected + 1); }}>Add point after {selected + 1}</button>
      <button disabled={draft.points.length <= 3} onClick={() => { edit(b => { b.points.splice(selected, 1); }); setSelected(Math.max(0, selected - 1)); }}>Remove point</button>
    </div>
    <fieldset><legend>Edge {selected + 1} → {next + 1}</legend><div className="sb-balcony-edges">{([['open', 'Open'], ['railing', 'Railing'], ['triple-railing', 'Triple railing'], ['wall', 'Solid wall']] as const).map(([edge, label]) => <button key={edge} aria-pressed={point.edge === edge} onClick={() => edit(b => { b.points[selected].edge = edge; })}>{label}</button>)}</div></fieldset>
    <div className="sb-balcony-fields">
      <NumberField label="Edge height" value={draft.heightM} min={.2} max={5} step={.1} unit="m" onChange={value => edit(b => { b.heightM = value; })} />
      <NumberField label="Wall thickness" value={draft.wallThicknessM} min={.01} max={.5} step={.01} unit="m" onChange={value => edit(b => { b.wallThicknessM = value; })} />
    </div>
    {problem ? <p className="sb-balcony-error" role="status">{problem}</p> : <p>Each edit saves automatically. Use Undo to restore it.</p>}
  </section>;
}

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Preview } from './CustomHullPreview';
import { clone, displayPoints, influence, invalidReason, lockSymmetry, makeHull, outline, presets, resizeSection, sectionAt, setSectionCount, uid, type Hull, type Station } from '../../ships/customHullModel';
import './CustomHullEditor.css';

// Shared section editor. Integration applies a draft to one source primitive;
// the development study additionally exposes alternate layouts and annotations.
type Change = (h: Hull) => void;
type Drag = (event: ReactPointerEvent<SVGElement>, change: (h: Hull, dx: number, dy: number) => void) => void;
const variants = ['A', 'B', 'C'];
const variantNames = ['Section workshop', 'Drawing board', 'Model first'];
const path = (points: { x: number; y: number }[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + 'Z';
function Icon({ name }: { name: 'left' | 'right' | 'undo' | 'redo' | 'hull' }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'hull' ? <><path d="M3 7h18l-4 11H7Z" /><path d="M7 7l3 11M17 7l-3 11M3 12h18" /></> : name === 'left' ? <path d="m14 5-7 7 7 7" /> : name === 'right' ? <path d="m10 5 7 7-7 7" /> : <g transform={name === 'redo' ? 'translate(24 0) scale(-1 1)' : ''}><path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" /></g>}
  </svg>;
}
function NumberField({ label, value, onChange, unit = 'm', min, max, step = .1 }: { label: string; value: number; onChange: (v: number) => void; unit?: string; min?: number; max?: number; step?: number }) {
  const [text, setText] = useState(String(Number(value.toFixed(2))));
  useEffect(() => setText(String(Number(value.toFixed(2)))), [value]);
  const apply = () => { const v = Number(text); if (text.trim() && Number.isFinite(v) && v !== value) onChange(v); setText(String(Number(value.toFixed(2)))); };
  return <label className="hp-number"><span>{label}</span><span><input aria-label={label} type="number" value={text} min={min} max={max} step={step} onChange={e => setText(e.target.value)} onBlur={apply} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><small>{unit}</small></span></label>;
}
function Toggle({ children, checked, onChange }: { children: ReactNode; checked: boolean; onChange: () => void }) {
  return <label className="hp-toggle"><input type="checkbox" checked={checked} onChange={onChange} /><span>{children}</span></label>;
}

function Drawings({ h, selected, select, drag, soft, kind }: { h: Hull; selected: string[]; select: (id: string, multi?: boolean) => void; drag: Drag; soft: boolean; kind: 'plan' | 'profile' }) {
  const W = 640, X = 40, Y = 106, S = 65;
  const at = h.stations;
  const edges = at.map(s => {
    const p = displayPoints(h, s);
    return kind === 'plan' ? [{ x: X + s.t * W, y: Y + p[0].x * S }, { x: X + s.t * W, y: Y + p[8].x * S }] : [{ x: X + s.t * W, y: Y - p[0].y * S }, { x: X + s.t * W, y: Y - p[4].y * S }];
  });
  const shape = [...edges.map(p => p[0]), ...edges.slice().reverse().map(p => p[1])];
  return <section className={`hp-drawing hp-${kind}`}>
    <div className="hp-panel-title"><h2>{kind === 'plan' ? 'Top outline' : 'Side profile'}</h2><span>{kind === 'plan' ? 'Drag widths · Shift-click to group' : 'Drag deck / keel · drag station lines to move'}</span></div>
    <svg viewBox="0 0 720 214" role="group" aria-label={kind === 'plan' ? 'Editable top outline' : 'Editable side profile'}>
      {[40, 168, 296, 424, 552, 680].map((x, i) => <g key={x}><line className="hp-grid" x1={x} x2={x} y1={24} y2={184} /><text x={x} y={202} textAnchor="middle">{Math.round(i * h.length / 5)} m</text></g>)}
      <line className="hp-datum" x1="24" x2="696" y1={Y} y2={Y} />
      <path className="hp-outline" d={path(shape)} />
      {h.stations.map((s, i) => {
        const p = displayPoints(h, s), x = X + s.t * W, chosen = selected.includes(s.id);
        const ys = kind === 'plan' ? [Y + p[0].x * S, Y + p[8].x * S] : [Y - p[0].y * S, Y - p[4].y * S];
        const ids = chosen ? selected : [s.id];
        return <g key={s.id} className={chosen ? 'hp-chosen' : influence(h, selected, s.t, soft) > 0 ? 'hp-influenced' : ''}>
          <line className="hp-station-line" x1={x} x2={x} y1={26} y2={182} />
          <line className="hp-hit-line" x1={x} x2={x} y1={30} y2={180} tabIndex={0} role="button" aria-label={`Select section ${i + 1} in ${kind}`} onClick={e => select(s.id, e.shiftKey)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(s.id, e.shiftKey); } }} onPointerDown={e => {
            if (e.shiftKey) return;
            select(s.id); drag(e, (draft, dx) => {
              const target = draft.stations.find(v => v.id === s.id)!;
              if (i > 0 && i < h.stations.length - 1) target.t = s.t + dx / W;
            });
          }} />
          {ys.map((y, side) => <circle key={side} className="hp-handle" cx={x} cy={y} r="5" tabIndex={0} role="button" aria-label={`${kind === 'plan' ? side ? 'Starboard width' : 'Port width' : side ? 'Keel' : 'Deck'} section ${i + 1}`} onKeyDown={e => { if (e.key === 'Enter') select(s.id, e.shiftKey); }} onPointerDown={e => {
            if (e.shiftKey) { e.stopPropagation(); select(s.id, true); return; }
            if (!chosen) select(s.id);
            drag(e, (draft, _dx, dy) => {
              for (const q of draft.stations) {
                const weight = influence(h, ids, q.t, soft); if (!weight) continue;
                if (kind === 'plan') {
                  const source = h.stations.find(v => v.id === q.id)!;
                  const index = side ? 8 : 0, delta = dy / S * weight;
                  const signedWidth = source.points[index].x + delta;
                  resizeSection(q, (side ? 1 : -1) * signedWidth);
                } else {
                  const delta = -dy / S * weight;
                  q.points.forEach((v, k) => { const f = side ? [0, 0, .6, 1, 1, 1, .6, 0, 0][k] : [1, .4, 0, 0, 0, 0, 0, .4, 1][k]; v.y += delta * f; });
                }
              }
            });
          }} />)}
          <text className="hp-station-label" x={x} y="18" textAnchor="middle">{String(i + 1).padStart(2, '0')}</text>
        </g>;
      })}
      <text x="24" y="202" textAnchor="end">BOW</text><text x="696" y="202">AFT</text>
    </svg>
  </section>;
}

function CrossSection({ h, selected, point, setPoint, drag, soft, edit }: { h: Hull; selected: string[]; point: number; setPoint: (p: number) => void; drag: Drag; soft: boolean; edit: (change: Change) => void }) {
  const s = h.stations.find(v => selected.includes(v.id)) ?? h.stations[3];
  const scale = Math.min(140 / (h.beam / 2), 132 / h.depth), sx = h.beam / 2 * scale, sy = h.depth * scale;
  const project = (p: { x: number; y: number }) => ({ x: 190 + p.x * sx, y: 172 - p.y * sy });
  const points = displayPoints(h, s);
  const changePoint = (d: Hull, dx: number, dy: number) => {
    for (const q of d.stations) {
      const w = influence(h, selected, q.t, soft); if (!w) continue;
      const p = q.points[point]; p.x += dx * w; p.y += dy * w;
      if (point === 4) p.x = 0;
      if (point !== 4) q.points[8 - point] = { ...p, x: -p.x };
    }
  };
  return <section className="hp-section-editor">
    <div className="hp-panel-title"><h2>Cross-section {String(h.stations.indexOf(s) + 1).padStart(2, '0')}</h2><span>{(s.t * h.length).toFixed(1)} m from bow</span></div>
    <svg className="hp-cross" viewBox="0 0 380 340" role="group" aria-label="Editable cross-section">
      {[58, 96, 134, 172, 210, 248, 286].map(y => <line key={y} className="hp-grid" x1="20" x2="360" y1={y} y2={y} />)}
      {[38, 76, 114, 152, 190, 228, 266, 304, 342].map(x => <line key={x} className="hp-grid" x1={x} x2={x} y1="40" y2="304" />)}
      <line className="hp-datum" x1="190" x2="190" y1="28" y2="309" />
      <text x="20" y="25">PORT</text><text x="360" y="25" textAnchor="end">STARBOARD</text>
      {h.stations.filter(v => !selected.includes(v.id)).map(v => <path key={v.id} className="hp-ghost-section" d={path(outline(h, v).map(project))} />)}
      <path className="hp-outline" d={path(outline(h, s).map(project))} />
      <path className="hp-control-polygon" d={path(points.map(project))} />
      {points.map((p, k) => {
        const pos = project(p);
        return <g key={k} className={point === k ? 'hp-chosen' : ''}><circle className="hp-handle" cx={pos.x} cy={pos.y} r={point === k ? 7 : 5} tabIndex={0} role="button" aria-label={`Outline point ${k + 1}`} onClick={() => setPoint(k)} onKeyDown={e => {
          if (e.key === 'Enter') setPoint(k);
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.stopPropagation(); e.preventDefault(); setPoint(k);
            edit(d => { for (const q of d.stations) {
              const w = influence(h, selected, q.t, soft); if (!w) continue;
              const v = q.points[k]; v.x += k === 4 ? 0 : (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) * .1 / (h.beam / 2) * w;
              v.y += (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0) * .1 / h.depth * w;
              if (k !== 4) q.points[8 - k] = { ...v, x: -v.x };
            } });
          }
        }} onPointerDown={e => {
          setPoint(k);
          drag(e, (d, dx, dy) => {
            for (const q of d.stations) {
              const w = influence(h, selected, q.t, soft); if (!w) continue;
              const v = q.points[k]; v.x += k === 4 ? 0 : dx / sx * w; v.y -= dy / sy * w;
              if (k !== 4) q.points[8 - k] = { ...v, x: -v.x };
            }
          });
        }} /><text className="hp-point-label" x={pos.x + (p.x < 0 ? -12 : 12)} y={pos.y - 10}>{k + 1}</text></g>;
      })}
      <text x="190" y="330" textAnchor="middle">Drag an outline point · arrow keys nudge 0.1 m</text>
    </svg>
    <div className="hp-point-controls">
      <label>Point<select aria-label="Outline point" value={point} onChange={e => setPoint(+e.target.value)}>{s.points.map((_, i) => <option key={i} value={i}>{i + 1}{i === 4 ? ' · keel' : i === 0 || i === 8 ? ' · deck edge' : ''}</option>)}</select></label>
    </div>
    <div className="hp-pair">
      <NumberField label="Point X" value={s.points[point].x * h.beam / 2} onChange={v => edit(d => changePoint(d, v / (h.beam / 2) - s.points[point].x, 0))} />
      <NumberField label="Point Y" value={s.points[point].y * h.depth} onChange={v => edit(d => changePoint(d, 0, v / h.depth - s.points[point].y))} />
    </div>
  </section>;
}

export default function CustomHullEditor({ integration }: { integration?: { hull: Hull; onApply(hull: Hull): void; onClose(): void } }) {
  const sessionDialog = useRef<HTMLDialogElement>(null);
  const integrated = !!integration;
  // Open before the preview measures its viewport and fits the camera.
  useLayoutEffect(() => {
    if (!integrated) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = sessionDialog.current!; dialog.showModal();
    return () => { dialog.close(); opener?.focus({ preventScroll: true }); };
  }, [integrated]);
  useEffect(() => { const previous = document.title; document.title = 'Custom hull · Shipbuilder'; return () => { document.title = previous; }; }, []);
  const [hulls, setHulls] = useState<Hull[]>(() => [integration ? clone(integration.hull) : makeHull()]);
  const [active, setActive] = useState(hulls[0].id), [selected, setSelected] = useState([hulls[0].stations[3].id]);
  const [pending, setPending] = useState<Hull[]>(), [error, setError] = useState('');
  const [past, setPast] = useState<Hull[][]>([]), [future, setFuture] = useState<Hull[][]>([]);
  // Preserve an open study on hot reload while applying the newly fixed symmetry rule.
  useEffect(() => {
    setHulls(value => value.map(lockSymmetry));
    setPast(value => value.map(hulls => hulls.map(lockSymmetry)));
    setFuture(value => value.map(hulls => hulls.map(lockSymmetry)));
    setPending(undefined);
  }, []);
  const [variant, setVariant] = useState(() => { const v = integration ? 'A' : new URLSearchParams(location.search).get('variant') ?? 'A'; return variants.includes(v) ? v : 'A'; });
  const [point, setPoint] = useState(7), [soft, setSoft] = useState(false), [lines, setLines] = useState(true);
  const [view, setView] = useState('Orbit'), [fit, setFit] = useState(0), [gallery, setGallery] = useState(false), [tool, setTool] = useState('Shape');
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const current = useRef(hulls); current.current = hulls;
  const displayed = pending ?? hulls, h = displayed.find(v => v.id === active) ?? displayed[0];
  const selectedValid = selected.filter(id => h.stations.some(v => v.id === id));
  const selection = selectedValid.length ? selectedValid : [h.stations[3]?.id ?? h.stations[0].id];
  const station = h.stations.find(v => selection.includes(v.id))!;
  const commit = (next: Hull[]) => {
    const reason = next.map(invalidReason).find(Boolean);
    if (reason) { setError(reason); return false; }
    setPast(v => [...v.slice(-49), clone(current.current)]); setFuture([]); setHulls(next); setError('');
    return true;
  };
  const edit = (change: Change) => { const next = clone(hulls); change(next.find(v => v.id === h.id)!); commit(next); };
  const select = (id: string, multi = false) => setSelected(previous => multi ? previous.includes(id) ? previous.length > 1 ? previous.filter(v => v !== id) : previous : [...previous, id] : [id]);
  const changeVariant = (next: string) => { setVariant(next); const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url); };
  const undo = () => { if (!past.length || pending) return; setFuture(v => [clone(hulls), ...v]); setHulls(past.at(-1)!); setPast(v => v.slice(0, -1)); setError(''); };
  const redo = () => { if (!future.length || pending) return; setPast(v => [...v, clone(hulls)]); setHulls(future[0]); setFuture(v => v.slice(1)); setError(''); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable],svg')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (!integration && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); changeVariant(variants[(variants.indexOf(variant) + (e.key === 'ArrowLeft' ? 2 : 1)) % 3]); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => () => dragCleanup.current?.(), []);
  const drag: Drag = (event, change) => {
    event.preventDefault(); event.stopPropagation();
    dragCleanup.current?.();
    const svg = event.currentTarget.ownerSVGElement!;
    const inverse = svg.getScreenCTM()!.inverse();
    const start = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    const baseline = clone(hulls); let candidate = baseline, reason: string | undefined, moved = false;
    const move = (e: PointerEvent) => {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
      moved ||= Math.hypot(p.x - start.x, p.y - start.y) > 1;
      if (!moved) return;
      candidate = clone(baseline); change(candidate.find(v => v.id === h.id)!, p.x - start.x, p.y - start.y);
      reason = invalidReason(candidate.find(v => v.id === h.id)!);
      setPending(candidate); setError(reason ?? '');
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); dragCleanup.current = undefined; };
    const cancel = () => { cleanup(); setPending(undefined); setError(''); };
    const end = () => { cleanup(); setPending(undefined); if (moved && !reason) commit(candidate); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key);
    dragCleanup.current = cancel;
  };
  const chosenChange = (change: (s: Station, weight: number) => void) => edit(d => d.stations.forEach(s => { const w = influence(h, selection, s.t, soft); if (w) change(s, w); }));
  const addSection = () => edit(d => {
    const i = d.stations.findIndex(s => s.id === station.id), next = d.stations[i + 1] ?? d.stations[i - 1];
    const s = sectionAt(d, (station.t + next.t) / 2); s.id = uid(); d.stations.push(s); d.stations.sort((a, b) => a.t - b.t); setSelected([s.id]);
  });
  const changeSectionCount = (count: number) => {
    if (!Number.isInteger(count) || count < 4 || count > 24) { setError('Use a whole section count from 4 to 24.'); return; }
    const next = clone(hulls), draft = next.find(v => v.id === h.id)!;
    setSectionCount(draft, count);
    if (commit(next)) {
      const retained = selection.filter(id => draft.stations.some(s => s.id === id));
      const nearest = draft.stations.reduce((a, b) => Math.abs(a.t - station.t) < Math.abs(b.t - station.t) ? a : b);
      setSelected(retained.length ? retained : [nearest.id]);
    }
  };
  const changeHull = (id: string) => { setActive(id); const next = hulls.find(v => v.id === id)!; setSelected([next.stations[3].id]); };
  const modelPanel = <section className="hp-model-panel">
    <Preview hulls={displayed} active={h.id} selected={selection} soft={soft} invalid={!!pending && !!error} lines={lines} view={view} fit={fit} onSelect={(id, section, multi) => { setActive(id); select(section, multi && id === h.id); }} />
    <div className="hp-model-heading"><h2>{h.name}</h2><span>{h.length} × {h.beam} × {h.depth} m · {h.stations.length} sections</span></div>
    <div className="hp-model-tools">{['Orbit', 'Plan', 'Profile', 'Bow'].map(v => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}<button onClick={() => setFit(v => v + 1)}>Fit</button></div>
    <div className="hp-model-caption"><span>Drag to orbit · scroll to zoom · click to select a section</span><Toggle checked={lines} onChange={() => setLines(!lines)}>Section lines</Toggle></div>
  </section>;
  const sectionPanel = <CrossSection h={h} selected={selection} point={point} setPoint={setPoint} drag={drag} soft={soft} edit={edit} />;
  const planPanel = <Drawings h={h} selected={selection} select={select} drag={drag} soft={soft} kind="plan" />;
  const profilePanel = <Drawings h={h} selected={selection} select={select} drag={drag} soft={soft} kind="profile" />;
  const controls = <aside className="hp-inspector">
    <div className="hp-panel-title"><h2>Hull controls</h2><span>{selection.length} section{selection.length === 1 ? '' : 's'} selected</span></div>
    <div className="hp-tabs" role="group" aria-label="Hull editing tools">{(integration ? ['Shape'] : ['Shape', 'Surfaces']).map(v => <button key={v} aria-pressed={tool === v} onClick={() => setTool(v)}>{v}</button>)}</div>
    {tool === 'Shape' ? <>
      <div className="hp-fields"><NumberField label="Length" value={h.length} min={5} max={500} onChange={v => edit(d => { d.length = v; })} /><NumberField label="Beam" value={h.beam} min={1} max={100} onChange={v => edit(d => { d.beam = v; })} /><NumberField label="Depth" value={h.depth} min={1} max={60} onChange={v => edit(d => { d.depth = v; })} /></div>
      <div className="hp-control-group"><Toggle checked={h.redPaintY !== undefined} onChange={() => edit(d => { d.redPaintY = d.redPaintY === undefined ? -.02 * d.depth : undefined; })}>Red lower hull</Toggle>{h.redPaintY !== undefined && <NumberField label="Red paint Y" value={h.redPaintY} min={-500} max={500} onChange={v => edit(d => { d.redPaintY = v; })} />}<p>Meters from the hull center. Red oxide below this height, face paint above. Moves with the hull; does not change its draft.</p></div>
      <div className="hp-control-group"><NumberField label="Section count" unit="" value={h.stations.length} min={4} max={24} step={1} onChange={changeSectionCount} /><p>4–24 sections. Increasing adds sections between existing ones. Reducing simplifies the shape. Undo restores the previous hull.</p></div>
      <div className="hp-control-group"><p className="hp-symmetry-note">Left / right symmetry is always on.</p><Toggle checked={soft} onChange={() => setSoft(!soft)}>Blend edits into nearby sections</Toggle><p>{soft ? `Shape edits also move neighbors within ${(h.length * .2).toFixed(1)} m of a selected section, fading with distance. Dashed brass sections show these neighbors; percentages show how much they follow your edit.` : 'Off: shape edits affect only selected sections. Turn on to gently reshape nearby sections too.'}</p>{soft && <p>Example: a neighbor marked 25% moves 0.25 m when you move a point 1 m. Moving section positions and changing hull dimensions are unaffected.</p>}<p>Shift-click section numbers to edit a group at full strength.</p></div>
      <div className="hp-control-group"><h3>Selected sections</h3><div className="hp-pair"><NumberField label="Width" value={(station.points[8].x - station.points[0].x) * h.beam / 2} onChange={v => chosenChange((s, w) => { const delta = (v - (station.points[8].x - station.points[0].x) * h.beam / 2) / h.beam; resizeSection(s, Math.abs(s.points[8].x) + delta * w); })} /><NumberField label="Deck height" value={station.points[0].y * h.depth} onChange={v => chosenChange((s, w) => { const delta = v / h.depth - station.points[0].y; s.points[0].y += delta * w; s.points[8].y += delta * w; })} /></div>
      <div className="hp-pair"><NumberField label="Flare" unit="%" value={station.points[0].x ? (1 - Math.abs(station.points[1].x / station.points[0].x)) * 100 : 4} onChange={v => chosenChange((s, w) => { for (const [a, b] of [[1, 0], [7, 8]]) s.points[a].x += (s.points[b].x * (1 - v / 100) - s.points[a].x) * w; })} /><NumberField label="Bilge inset" unit="%" value={station.points[0].x ? (1 - Math.abs(station.points[2].x / station.points[0].x)) * 100 : 26} onChange={v => chosenChange((s, w) => { for (const [a, b] of [[2, 0], [6, 8]]) s.points[a].x += (s.points[b].x * (1 - v / 100) - s.points[a].x) * w; })} /></div>
      <div className="hp-actions"><button onClick={addSection} disabled={h.stations.length >= 24}>Add section</button><button disabled={h.stations.length - selection.length < 4 || selection.some(id => id === h.stations[0].id || id === h.stations.at(-1)!.id)} onClick={() => edit(d => { d.stations = d.stations.filter(s => !selection.includes(s.id)); })}>Remove selected</button></div></div>
      <div className="hp-control-group"><h3>Bow</h3><div className="hp-pair"><NumberField label="Bow rake" unit="%" value={h.rake * 100} onChange={v => edit(d => { d.rake = Math.max(0, Math.min(1.5, v / 100)); })} /><NumberField label="Bow bulb" unit="%" value={h.bulb * 100} onChange={v => edit(d => { d.bulb = Math.max(0, Math.min(1, v / 100)); })} /></div><p>Drag deck and keel points in the side profile to change their heights.</p></div>
    </> : <div className="hp-control-group"><h3>Central belt region</h3><Toggle checked={h.region.enabled} onChange={() => edit(d => { d.region.enabled = !d.region.enabled; })}>Show surface region</Toggle><p>One editable region demonstrates boundaries independent of the shaping sections. Armor is a visual annotation in this study.</p><div className="hp-pair"><NumberField label="Region start" unit="%" value={h.region.start * 100} onChange={v => edit(d => { d.region.start = v / 100; })} /><NumberField label="Region end" unit="%" value={h.region.end * 100} onChange={v => edit(d => { d.region.end = v / 100; })} /><NumberField label="Lower edge" unit="%" value={h.region.low * 100} onChange={v => edit(d => { d.region.low = v / 100; })} /><NumberField label="Upper edge" unit="%" value={h.region.high * 100} onChange={v => edit(d => { d.region.high = v / 100; })} /></div><NumberField label="Armor annotation" unit="mm" value={h.region.armor} onChange={v => edit(d => { d.region.armor = Math.max(0, v); })} /><label className="hp-color">Region paint<input aria-label="Region paint" type="color" value={h.region.color} onChange={e => edit(d => { d.region.color = e.target.value; })} /></label></div>}
    {!integration && <details className="hp-state"><summary>Inspect prototype state</summary><pre>{JSON.stringify(h, null, 2)}</pre></details>}
  </aside>;
  const content = <main className={`hp-root hp-variant-${variant}${pending && error ? ' hp-invalid' : ''}${integration ? ' hp-integrated' : ''}`}>
    <header className="hp-header"><button className="hp-brand" onClick={() => integration ? integration.onClose() : location.assign('./')} title="Return to shipbuilder"><Icon name="hull" /><span>Shipbuilder</span></button><div className="hp-heading"><h1>Custom hull</h1><span>{integration ? 'Shape the hull, then apply to your design' : 'Interactive prototype · changes stay in this tab'}</span></div><div className="hp-history"><button aria-label="Undo" disabled={!past.length || !!pending} onClick={undo}><Icon name="undo" />Undo</button><button aria-label="Redo" disabled={!future.length || !!pending} onClick={redo}><Icon name="redo" />Redo</button></div><button onClick={() => setGallery(!gallery)} aria-expanded={gallery}>Choose a starter</button>{integration && <div className="hp-apply-actions"><button onClick={integration.onClose}>Cancel</button><button className="hp-primary" disabled={!!pending || !!error} onClick={() => integration.onApply(h)}>Apply hull</button></div>}</header>
    <div className="hp-hull-strip">{!integration && <><label>Editing<select aria-label="Active hull" value={h.id} onChange={e => changeHull(e.target.value)}>{displayed.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label><button disabled={hulls.length >= 3} onClick={() => { const copy = clone(h); copy.id = uid(); copy.name += ' copy'; copy.offset += h.beam * 1.5; copy.stations.forEach(s => { s.id = uid(); }); commit([...hulls, copy]); setActive(copy.id); setSelected([copy.stations[3].id]); setFit(v => v + 1); }}>Duplicate hull</button><NumberField label="Lateral position" value={h.offset} onChange={v => edit(d => { d.offset = v; })} /></>}<span className="hp-strip-note">Flat faces · symmetric · {hulls.length} hull block{hulls.length > 1 ? 's' : ''}</span></div>
    {gallery && <section className="hp-gallery" aria-label="Hull starters"><div className="hp-panel-title"><h2>Start with a useful shape</h2><span>Replaces the selected hull · undo available</span></div><div className="hp-preset-list">{presets.map((p, i) => <button key={p.name} onClick={() => { const fresh = makeHull(i); fresh.id = h.id; fresh.offset = h.offset; commit(hulls.map(v => v.id === h.id ? fresh : v)); setSelected([fresh.stations[3].id]); setGallery(false); setFit(v => v + 1); }}><svg viewBox="0 0 220 72" aria-hidden="true"><path d={path([...p.widths.map((w, j) => ({ x: 12 + j / 7 * 196, y: 36 - w * (i === 1 ? 16 : 24) })), ...p.widths.slice().reverse().map((w, j) => ({ x: 208 - j / 7 * 196, y: 36 + w * (i === 1 ? 16 : 24) }))])} /></svg><strong>{p.name}</strong><span>{p.note}</span><small>{p.length} × {p.beam} × {p.depth} m</small></button>)}</div><button onClick={() => setGallery(false)}>Keep current hull</button></section>}
    <div className="hp-station-strip"><span>Sections</span><div>{h.stations.map((s, i) => {
      const chosen = selection.includes(s.id), weight = influence(h, selection, s.t, soft);
      const percent = weight > 0 && Math.round(weight * 100) === 0 ? '<1%' : `${Math.round(weight * 100)}%`;
      const description = chosen ? 'Selected: full edit' : weight > 0 ? `Follows ${percent} of a shape edit` : 'Unaffected by edits to the current selection';
      return <button key={s.id} className={!chosen && weight > 0 ? 'hp-influenced' : ''} aria-label={`Section ${i + 1}`} aria-description={description} title={description} aria-pressed={chosen} onClick={e => select(s.id, e.shiftKey)}>{String(i + 1).padStart(2, '0')}{soft && weight > 0 && <small>{chosen ? '100%' : percent}</small>}</button>;
    })}</div><button onClick={() => setSelected(h.stations.map(s => s.id))}>Select all</button><span>Bow → Stern</span></div>
    <div className="hp-workspace">
      {variant === 'A' && <>{modelPanel}<div className="hp-section-column">{sectionPanel}{controls}</div><div className="hp-drawings-row">{planPanel}{profilePanel}</div></>}
      {variant === 'B' && <><div className="hp-drafting-column">{planPanel}{profilePanel}{controls}</div><div className="hp-preview-column">{modelPanel}{sectionPanel}</div></>}
      {variant === 'C' && <>{modelPanel}<div className="hp-floating-section">{sectionPanel}</div><div className="hp-bottom-dock">{planPanel}{profilePanel}</div><div className="hp-floating-controls">{controls}</div></>}
    </div>
    <footer className={`hp-status ${error ? 'hp-error' : ''}`} role="status"><span>{error ? `${pending ? 'Invalid preview' : 'Edit rejected'}: ${error}` : pending ? 'Shaping hull… release to apply · Esc cancels' : 'Drag mint handles to shape the hull. Each drag is one undoable edit.'}</span><span>{integration ? 'Apply updates the saved design · equipment stays in place · Undo available in Shipbuilder' : 'Visual study · no saving, buoyancy or combat compilation'}</span></footer>
    {!integration && <nav className="hp-switcher" aria-label="Prototype layout"><button aria-label="Previous layout" onClick={() => changeVariant(variants[(variants.indexOf(variant) + 2) % 3])}><Icon name="left" /></button><span><b>{variant}</b> {variantNames[variants.indexOf(variant)]}</span><button aria-label="Next layout" onClick={() => changeVariant(variants[(variants.indexOf(variant) + 1) % 3])}><Icon name="right" /></button></nav>}
  </main>;
  return integration ? <dialog ref={sessionDialog} className="hp-session" aria-label="Custom hull editor" onCancel={event => { event.preventDefault(); integration.onClose(); }}>{content}</dialog> : content;
}

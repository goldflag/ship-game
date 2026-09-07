import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import { coastOutline } from '../maps/catalog';
import { AIR_STATUS_LABELS, type AirStatus, type AirWingTelemetry, type FlightSummary } from '../simulation/airTelemetry';
import type { AirOrder } from '../simulation/aircraft';
import { chartPoint, chartWorld, fitAirChart, type ChartView } from './airChart';
import './AirOperations.css';

export const duration = (seconds: number) => {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};
const roleLabel = (role: string) => role === 'fighter' ? 'Fighters' : role === 'dive-bomber' ? 'Dive bombers' : 'Torpedo bombers';
const mission = (f: FlightSummary) => f.order.kind === 'attack' ? `Attack ${f.targetName ?? 'assigned ship'}` : f.order.kind === 'escort' ? `Escort ${f.targetName ?? 'assigned flight'}` : f.order.kind === 'patrol' ? 'Patrol assigned area' : f.order.kind === 'return' ? 'Return to carrier' : 'Defend carrier';

export function WingCounts({ wing, selected, onSelect }: { wing: AirWingTelemetry; selected?: AirStatus; onSelect?(status: AirStatus): void }) {
  return <div className="air-counts" aria-label="Whole air wing status">{(Object.keys(AIR_STATUS_LABELS) as AirStatus[]).map(status =>
    <button key={status} className={`air-count air-count-${status}`} aria-pressed={selected === status} onClick={e => { onSelect?.(status); e.currentTarget.blur(); }}>
      <strong>{wing.counts[status]}</strong><span>{AIR_STATUS_LABELS[status]}</span>
    </button>)}</div>;
}

export function AirOperations({ data, game, bindings }: { data: Telemetry; game: Game | null; bindings: Keybindings }) {
  const wing = data.combat!.airWing!;
  const [filter, setFilter] = useState<AirStatus | undefined>();
  const [mode, setMode] = useState<'select' | 'attack' | 'patrol' | 'escort'>('select');
  const [feedback, setFeedback] = useState('');
  const [view, setView] = useState<ChartView>({ x: data.ship.x, z: data.ship.z - 2500, radius: 8000 });
  const [size, setSize] = useState({ width: 800, height: 530 });
  const map = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const selected = wing.groups.find(f => f.id === data.selectedFlightId) ?? wing.groups.find(f => f.active) ?? wing.groups.at(-1);
  const canCommand = data.combat!.result === 'active' && !data.combat!.playerSunk;
  const canLaunch = canCommand && wing.available && wing.activeFlights < wing.maxActiveFlights;
  const validTarget = !data.combat!.targetSunk && (data.combat!.targetDepthM ?? 0) <= 8 && !data.combat!.contacts.find(c => c.id === data.combat!.targetId)?.combatLost;
  const point = (x: number, z: number) => chartPoint(view, size.width, size.height, x, z);
  const ownContacts = data.combat!.airContacts?.filter(p => p.ownerId === data.ship.id) ?? [];
  const detail = view.radius < 3500;
  useEffect(() => { setMode('select'); setFeedback(''); }, [selected?.id]);
  useEffect(() => {
    const element = map.current;
    if (!element) return;
    const resize = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    resize.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      setView(previous => {
        const anchor = chartWorld(previous, rect.width, rect.height, x, y);
        const radius = Math.min(40000, Math.max(750, previous.radius * Math.exp(event.deltaY * .0015)));
        const next = { ...previous, radius }, after = chartWorld(next, rect.width, rect.height, x, y);
        return { radius, x: next.x + anchor[0] - after[0], z: next.z + anchor[1] - after[1] };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { resize.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);
  const select = (f: FlightSummary) => { game?.selectFlight(f.id); setFilter(undefined); };
  const issue = (order: AirOrder) => {
    if (!selected) return;
    const accepted = game?.orderFlight(selected.id, order);
    setFeedback(accepted ? `${selected.name} · Order received` : 'Order unavailable. Check flight status, payload and target.');
    if (accepted) setMode('select');
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-contact]')) return;
    event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start) return;
    start.moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
    const dx = event.clientX - start.lastX, dy = event.clientY - start.lastY;
    start.lastX = event.clientX; start.lastY = event.clientY;
    if (start.moved) setView(v => ({ ...v, x: v.x - dx * 2 * v.radius / size.width, z: v.z - dy * 2 * v.radius / size.width }));
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current; drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!start || start.moved || mode !== 'patrol') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const [x, z] = chartWorld(view, size.width, size.height, event.clientX - rect.left, event.clientY - rect.top);
    issue({ kind: 'patrol', point: [x, 420, z] });
  };
  const instruction = mode === 'attack' ? 'Select an enemy ship to assign the strike.' : mode === 'patrol' ? 'Select a patrol position on the chart.' : mode === 'escort' ? 'Select a friendly flight to escort.' : 'Select a flight to inspect or command. Drag to pan · Scroll to zoom';
  const selectedAircraft = selected ? wing.flights.filter(p => p.flightId === selected.id) : [];
  const filteredAircraft = filter ? wing.flights.filter(p => p.status === filter) : [];
  const mapMark = (key: string, x: number, z: number, label: string, child: React.ReactNode, action: () => void, classes = '') =>
    <g key={key} data-contact="true" className={`air-chart-contact ${classes}`} transform={`translate(${point(x, z).join(' ')})`} role="button" tabIndex={0} aria-label={label}
      onClick={e => { e.stopPropagation(); action(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); action(); } }}>
      <title>{label}</title><circle r="23" fill="transparent" stroke="none"/>{child}
    </g>;
  return <section className="air-operations" aria-label="Air operations" onKeyDown={event => {
    if (bindings.airOperations.includes(event.code) || event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); game?.setAirOperationsOpen(false); }
  }}>
    <header className="air-operations-header"><div><h2>Air operations</h2><span>{wing.total - wing.counts.lost} / {wing.total} aircraft · {wing.activeFlights} / {wing.maxActiveFlights} flights active</span></div>
      <button className="air-close" onClick={() => game?.setAirOperationsOpen(false)}>Back to sea <kbd>{bindingLabel(bindings, 'airOperations')}</kbd></button></header>
    <WingCounts wing={wing} selected={filter} onSelect={status => setFilter(current => current === status ? undefined : status)}/>
    <div className="air-operations-body">
      <div className="air-chart-area">
        <div className="air-chart-toolbar"><button onClick={e => { setView(fitAirChart([data.ship, ...ownContacts], size.width, size.height)); e.currentTarget.blur(); }}>Fit air wing</button>
          <button onClick={e => { setView(v => ({ ...v, x: data.ship.x, z: data.ship.z })); e.currentTarget.blur(); }}>Center carrier</button>
          <div className="air-chart-zoom"><button aria-label="Zoom out chart" onClick={() => setView(v => ({ ...v, radius: Math.min(40000, v.radius * 1.5) }))}>−</button><span>{(view.radius * 2 / 1000).toFixed(1)} km across</span><button aria-label="Zoom in chart" onClick={() => setView(v => ({ ...v, radius: Math.max(750, v.radius / 1.5) }))}>+</button></div>
        </div>
        <svg ref={map} className={`air-chart air-chart-${mode}`} viewBox={`0 0 ${size.width} ${size.height}`} tabIndex={0} role="group" aria-label="Tactical air chart. Drag or use arrow keys to pan, scroll to zoom."
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={event => { const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]; if (direction) { event.preventDefault(); event.stopPropagation(); setView(v => ({ ...v, x: v.x + direction[0] * v.radius * .2, z: v.z + direction[1] * v.radius * .2 })); } }}>
          <defs><pattern id="air-chart-grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="#688b9940"/></pattern></defs>
          <rect width="100%" height="100%" fill="url(#air-chart-grid)"/>
          {data.islands?.map(island => <polygon key={island.id} points={coastOutline(island).map(([x, z]) => point(x, z).join(',')).join(' ')} fill="#3f5a51" stroke="#a4b4a0" strokeWidth="1"/>)}
          {selected?.route.length ? <polyline className="air-route" points={selected.route.map(p => point(p[0], p[2]).join(',')).join(' ')}/> : null}
          {selected?.order.kind === 'patrol' && <circle className="air-patrol-area" cx={point(selected.order.point[0], selected.order.point[2])[0]} cy={point(selected.order.point[0], selected.order.point[2])[1]} r={850 * size.width / (view.radius * 2)}/>}
          {data.combat!.contacts.filter(c => !c.sunk).map(c => mapMark(c.id, c.x, c.z, `${c.name} · ${c.team}`, <>
            <path d="M0-12 5-3 5 11-5 11-5-3Z" transform={`rotate(${c.heading * 180 / Math.PI})`}/><text x="12" y="4">{c.id === data.ship.id ? `${c.name} · You` : c.name}</text>
          </>, () => { if (c.team === 'enemy') { if (mode === 'attack' && selected) issue({ kind: 'attack', targetId: c.id }); else game?.selectTarget(c.id); } }, c.team === 'enemy' ? 'air-hostile' : 'air-friendly'))}
          {data.combat!.airContacts?.filter(p => p.ownerId !== data.ship.id).map(p => <path key={p.id} transform={`translate(${point(p.x, p.z).join(' ')}) rotate(${p.heading * 180 / Math.PI})`} className={p.team === 'enemy' ? 'air-other air-hostile' : 'air-other air-friendly'} d="M0-5V5M-5 1 0-1 5 1"><title>{p.team} {roleLabel(p.role)} · {p.phase}</title></path>)}
          {detail && ownContacts.map(p => <path key={p.id} className="air-individual" transform={`translate(${point(p.x, p.z).join(' ')}) rotate(${p.heading * 180 / Math.PI})`} d="M0-6V6M-6 1 0-2 6 1"><title>{p.id.split('/').slice(1).join(' ')} · {p.phase}</title></path>)}
          {wing.groups.filter(f => f.airborne > 0).map(f => mapMark(f.id, f.position[0], f.position[2], `${f.name} · ${f.surviving} aircraft · ${mission(f)} · ${AIR_STATUS_LABELS[f.status]}`, <>
            {selected?.id === f.id && <circle className="air-selected-ring" r="20"/>}
            <path className="air-flight-symbol" transform={`rotate(${f.heading * 180 / Math.PI})`} d="M0-12V11M-13 3 0-4 13 3M-5 9H5"/>
            <text className="air-flight-label" x="24" y="0">{f.name} · {f.surviving}</text><text className="air-flight-state" x="24" y="16">{AIR_STATUS_LABELS[f.status]}</text>
          </>, () => { if (mode === 'escort' && selected) issue({ kind: 'escort', flightId: f.id }); else select(f); }, selected?.id === f.id ? 'air-selected' : 'air-friendly'))}
          <text className="air-north" x="18" y="27">N ↑</text>
        </svg>
        <div className="air-chart-hint"><span>{instruction}</span>{mode !== 'select' && <button onClick={() => setMode('select')}>Cancel order</button>}</div>
      </div>
      <aside className="air-roster" aria-label="Air wing roster">
        <section className="air-launch"><div className="air-roster-heading"><h3>Ready room</h3><span>{wing.onDeck} on deck · {wing.inHangar} in hangar</span></div>
          {wing.squadrons.map(s => <div className="air-launch-row" key={s.id}><div><strong>{s.name}</strong><span>{s.ready} ready · {s.total - s.lost} remaining</span></div><button disabled={!canLaunch || !s.ready || (s.role !== 'fighter' && !validTarget)} onClick={e => { game?.launchAircraft(s.id); setFilter(undefined); e.currentTarget.blur(); }}>Launch {Math.min(wing.flightSize, s.ready)}</button></div>)}
          {!wing.available && <p className="air-warning">{data.combat!.result !== 'active' ? 'Battle ended' : data.combat!.playerSunk ? 'Carrier lost' : 'Deck operations suspended · Check damage, list and trim'}</p>}
          {wing.activeFlights >= wing.maxActiveFlights && <p className="air-muted">All {wing.maxActiveFlights} flight slots are occupied. Recover a flight before launching another.</p>}
          {!validTarget && <p className="air-warning">Select an afloat surface target for bombers.</p>}
          <p className="air-muted">New strikes: {data.combat!.targetName} · Fighters defend carrier</p>
        </section>
        <section className="air-flight-list"><div className="air-roster-heading"><h3>{filter ? `${AIR_STATUS_LABELS[filter]} aircraft` : 'Flights'}</h3>{filter && <button onClick={() => setFilter(undefined)}>Show flights</button>}</div>
          {filter ? <ul className="air-plane-list">{filteredAircraft.map(p => <li key={p.id}><div><strong>{p.id.split('/').slice(1).join(' / ')}</strong><span>{p.lossReason ?? `${p.location} · ${p.phase} · ${Math.ceil(p.hp)}%`}</span></div><button disabled={!p.followable} onClick={() => game?.followAircraft(p.id)}>Follow</button></li>)}</ul> : <>
            {!wing.groups.length && <p className="air-empty">Your air wing is aboard. Launch a fighter patrol or select an enemy ship for your first strike.</p>}
            {wing.groups.map(f => <button className="air-flight-row" key={f.id} aria-pressed={selected?.id === f.id} onClick={e => { select(f); e.currentTarget.blur(); }}><span><strong>{f.name}</strong><span>{f.surviving} / {f.total} aircraft · {roleLabel(f.role)}</span></span><span className={`air-state air-state-${f.status}`}>{AIR_STATUS_LABELS[f.status]}</span><small>{mission(f)}</small></button>)}
          </>}
        </section>
        {selected && !filter && <section className="air-flight-detail" aria-label={`${selected.name} details`}><div className="air-roster-heading"><h3>{selected.name}</h3><span>{mission(selected)}</span></div>
          <dl><div><dt>Condition</dt><dd>{selected.hp}%</dd></div><div><dt>{selected.role === 'fighter' ? 'With ammunition' : 'Payloads aboard'}</dt><dd>{selected.armed} / {selected.surviving}</dd></div>
            {selected.airborne > 0 && <div><dt>Lowest endurance</dt><dd>{duration(selected.enduranceSeconds)}</dd></div>}
            {selected.etaSeconds !== undefined && <div><dt>{selected.status === 'returning' ? 'Flight to carrier ≈' : 'Flight to target ≈'}</dt><dd>{duration(selected.etaSeconds)}</dd></div>}
            {selected.queuePosition && <div><dt>First in recovery queue</dt><dd>#{selected.queuePosition} of {wing.recoveryCount}</dd></div>}
            {selected.rearmSeconds > 0 && <div><dt>Service remaining</dt><dd>{duration(selected.rearmSeconds)}</dd></div>}
          </dl>
          {selected.notice && <p className="air-warning">{selected.notice}</p>}
          <div className="air-orders" aria-label="Flight orders">{selected.role === 'fighter' ? <><button disabled={!canCommand || !selected.active} onClick={() => issue({ kind: 'defend' })}>Defend carrier</button><button aria-pressed={mode === 'patrol'} disabled={!canCommand || !selected.active} onClick={() => setMode('patrol')}>Patrol area</button><button aria-pressed={mode === 'escort'} disabled={!canCommand || !selected.active} onClick={() => setMode('escort')}>Escort flight</button></> : <button aria-pressed={mode === 'attack'} disabled={!canCommand || !selected.active || !selected.armed} onClick={() => setMode('attack')}>Assign strike target</button>}
            <button disabled={!canCommand || !selected.active} onClick={() => issue({ kind: 'return' })}>Return flight</button></div>
          <details><summary>Individual aircraft · {selectedAircraft.length}</summary><ul className="air-plane-list">{selectedAircraft.map(p => <li key={p.id}><div><strong>Aircraft {p.id.split('/').at(-1)} · {Math.ceil(p.hp)}%</strong><span>{p.lossReason ?? `${p.phase} · ${p.role === 'fighter' ? `${p.ammo} bursts` : p.payload ? 'Armed' : 'Released'}`}</span></div><button disabled={!p.followable} onClick={() => game?.followAircraft(p.id)}>Follow</button></li>)}</ul></details>
        </section>}
      </aside>
    </div>
    <footer className="air-operations-footer"><span role="status">{feedback || (wing.recoveryCount ? `${wing.recoveryCount} aircraft returning · Recovery takes priority near the deck` : 'Flight orders persist when you change the ship target or close this chart.')}</span><button disabled={!canCommand || !wing.activeFlights} onClick={e => { game?.recallAircraft(); setFeedback('All flights recalled'); e.currentTarget.blur(); }}>Recall all flights</button></footer>
  </section>;
}

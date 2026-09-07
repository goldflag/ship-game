import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import { AIR_STATUS_LABELS, type AirStatus, type AirWingTelemetry, type FlightSummary } from '../simulation/airTelemetry';
import type { AirOrder } from '../simulation/aircraft';
import { chartPoint, chartWorld } from './airChart';
import { actionAvailable, SQUADRON_ACTIONS, squadronTargetOrder, type SquadronAction, type SquadronTarget } from './airCommands';
import { Icon } from './Icons';
import './AirOperations.css';
import { AirMapNavigation } from './airMapNavigation';

export const duration = (seconds: number) => `${Math.floor(Math.max(0, Math.ceil(seconds)) / 60)}:${String(Math.max(0, Math.ceil(seconds)) % 60).padStart(2, '0')}`;
const roleLabel = (role: string) => role === 'fighter' ? 'Fighters' : role === 'dive-bomber' ? 'Dive bombers' : 'Torpedo bombers';

// Camera motion is rendered every frame; combat telemetry intentionally stays at 10 Hz.
// Move the overlay directly so camera motion never waits for a React telemetry render.
function useMapProjection(ref: RefObject<HTMLElement | SVGSVGElement | null>, game: Game | null, active: boolean) {
  useEffect(() => {
    if (!active || !game) return;
    const update = () => {
      ref.current?.querySelectorAll<HTMLElement | SVGElement>('[data-map-position]').forEach(element => {
        const [x, y, z] = JSON.parse(element.dataset.mapPosition!) as number[];
        const [left, top] = game.projectAirMap(x, z, y);
        if (element instanceof SVGElement) element.setAttribute('transform', `translate(${left} ${top})`);
        else { element.style.left = `${left}px`; element.style.top = `${top}px`; }
      });
      ref.current?.querySelectorAll<SVGPathElement>('[data-map-path]').forEach(element => {
        const points = JSON.parse(element.dataset.mapPath!) as number[][];
        element.setAttribute('d', `M${points.map(([x, y, z]) => game.projectAirMap(x, z, y).join(' ')).join('L')}${element.dataset.closed ? 'Z' : ''}`);
      });
    };
    return game.onCameraFrame(update);
  }, [ref, game, active]);
}
export const mission = (f: FlightSummary) => f.order.kind === 'attack' ? `Strike ${f.targetName ?? 'ship'}`
  : f.order.kind === 'intercept' ? `Intercept ${f.targetName ?? 'squadron'}` : f.order.kind === 'escort' ? `Escort ${f.targetName ?? 'squadron'}`
  : f.order.kind === 'patrol' ? 'Loiter at station' : f.order.kind === 'return' ? 'Return to carrier' : `Defend ${f.targetName ?? 'carrier'}`;

export function WingCounts({ wing, selected, onSelect }: { wing: AirWingTelemetry; selected?: AirStatus; onSelect?(status: AirStatus): void }) {
  return <div className="air-counts" aria-label="Whole air wing status">{(Object.keys(AIR_STATUS_LABELS) as AirStatus[]).map(status =>
    <button key={status} className={`air-count air-count-${status}`} aria-pressed={selected === status} onClick={e => { onSelect?.(status); e.currentTarget.blur(); }}>
      <strong>{wing.counts[status]}</strong><span>{AIR_STATUS_LABELS[status]}</span>
    </button>)}</div>;
}

function SquadronIcon({ role, size = 20 }: { role: FlightSummary['role']; size?: number }) {
  return <span className="air-role-icon" data-role={role} title={roleLabel(role)}><Icon name={role === 'fighter' ? 'fighter' : role === 'dive-bomber' ? 'bomb' : 'torpedo'} size={size}/></span>;
}

export function SquadronLabels({ data, game, onOrder, onTarget }: { data: Telemetry; game: Game | null; onOrder?(id: string, team: string): void; onTarget?(id: string, team: string): boolean }) {
  const labels = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!game) return;
    const update = () => {
      labels.current?.querySelectorAll<HTMLElement>('[data-flight-id]').forEach(element => {
        const point = game.projectSquadron(element.dataset.ownerId!, element.dataset.flightId!);
        element.style.display = point ? '' : 'none';
        if (point) { element.style.left = `${point.x}px`; element.style.top = `${point.y}px`; }
      });
    };
    update();
    return game.onCameraFrame(update);
  }, [game, data.squadronMarkers]);
  return <div ref={labels} className={`air-squadron-labels ${data.airOperationsOpen ? 'air-labels-map' : ''}`} aria-label="Squadron names and status">
    {data.squadronMarkers?.map(f => <button key={f.id} className={`air-squadron-tag ${f.team === 'enemy' ? 'air-hostile' : 'air-friendly'} ${data.selectedFlightId === f.id ? 'air-selected' : ''}`}
      data-flight-id={f.id} data-owner-id={f.ownerId} style={{ left: f.screen?.x, top: f.screen?.y, display: f.screen ? undefined : 'none' }} title={`${f.name} · ${roleLabel(f.role)} · ${mission(f)} · ${f.hp}% condition`}
      aria-label={`${f.name} · ${roleLabel(f.role)} · ${f.surviving} aircraft · ${f.activity}`}
      tabIndex={data.airOperationsOpen ? 0 : -1}
      onClick={e => { if (!onTarget?.(f.id, f.team) && f.ownerId === data.ship.id) game?.selectFlight(f.id); e.currentTarget.blur(); }}
      onContextMenu={e => { if (data.airOperationsOpen) { e.preventDefault(); onOrder?.(f.id, f.team); } }}>
      <SquadronIcon role={f.role}/><span><strong>{f.name} · {f.surviving}</strong><small>{f.activity}</small></span>
    </button>)}
  </div>;
}

/** Instruments over the actual 3D scene. M changes the camera, never opens a dialog. */
export function AirOperations({ data, game, bindings }: { data: Telemetry; game: Game | null; bindings: Keybindings }) {
  const wing = data.combat!.airWing!;
  const mapOpen = !!data.airOperationsOpen;
  const [pendingSelection, setPendingSelection] = useState<string>();
  const selected = wing.groups.find(f => f.id === (pendingSelection ?? data.selectedFlightId));
  useEffect(() => { if (pendingSelection === data.selectedFlightId) setPendingSelection(undefined); }, [pendingSelection, data.selectedFlightId]);
  const [feedback, setFeedback] = useState('');
  const [details, setDetails] = useState(false);
  const [armedAction, setArmedAction] = useState<SquadronAction>();
  const armed = useRef<SquadronAction | undefined>(undefined);
  const arm = (action?: SquadronAction) => { armed.current = action; setArmedAction(action); };
  const [size, setSize] = useState({ width: typeof window === 'undefined' ? 1280 : window.innerWidth, height: typeof window === 'undefined' ? 720 : window.innerHeight });
  const map = useRef<SVGSVGElement>(null);
  useMapProjection(map, game, mapOpen);
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; startX: number; startY: number } | null>(null);
  const navigation = useRef(new AirMapNavigation());
  const state = useRef({ data, selected, mapOpen, size }); state.current = { data, selected, mapOpen, size };
  const canCommand = data.combat!.result === 'active' && !data.combat!.playerSunk;
  const view = data.airMap ?? { x: data.ship.x, z: data.ship.z, radius: 8000 };
  const point = (x: number, z: number, altitude = 0) => game?.projectAirMap(x, z, altitude) ?? chartPoint(view, size.width, size.height, x, z, altitude);
  const waterPoint = (x: number, y: number, width: number, height: number) => game ? game.airMapWater(x, y) : chartWorld(view, width, height, x, y);
  const currentFlight = () => state.current.data.combat?.airWing?.groups.find(f => f.id === game?.selectedFlightId) ?? state.current.selected;
  const issue = (order: AirOrder) => {
    const flight = currentFlight();
    if (!flight) { setFeedback('Select a squadron below first.'); return; }
    const accepted = game?.commandSquadron(flight.id, order);
    if (accepted) arm();
    setFeedback(accepted ? `${flight.name} · ${flight.active ? 'Order received' : 'Launch ordered'}`
      : !canCommand ? 'Carrier unavailable · Battle ended or carrier lost.'
      : !flight.active && !wing.available ? 'Launch suspended · Check carrier damage, list and trim.'
      : !flight.active && wing.activeFlights >= wing.maxActiveFlights ? `All ${wing.maxActiveFlights} flight slots occupied · Recover a squadron to launch.`
      : flight.status === 'servicing' ? 'Squadron servicing · Wait for all survivors to be ready.'
      : 'Order unavailable · Check role, armament, endurance and the 30 km command range.');
  };
  const select = (f: FlightSummary) => { arm(); setFeedback(''); setDetails(false); setPendingSelection(f.id); game?.selectFlight(f.id); };
  const perform = (key: string) => {
    const flight = currentFlight();
    if (key === 'V') { if (flight) setDetails(v => !v); return; }
    if (!canCommand) return;
    if (key === 'X') { if (wing.activeFlights) { game?.recallAircraft(); arm(); setFeedback('All squadrons recalled'); } return; }
    if (!flight) { setFeedback('Select a squadron first.'); return; }
    if (key === 'R') { if (flight.active) issue({ kind: 'return' }); return; }
    const action = SQUADRON_ACTIONS.find(a => a.key === key);
    if (action && flight.surviving && actionAvailable(action, flight.role)) { arm(armed.current?.kind === action.kind ? undefined : action); setFeedback(''); }
  };
  const target = (contact: SquadronTarget) => {
    const order = squadronTargetOrder(armed.current?.kind, contact);
    if (order) issue(order);
    else setFeedback(`Choose ${armed.current?.target}.`);
  };
  const handlers = useRef({ select, perform }); handlers.current = { select, perform };
  useEffect(() => { row.current?.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected?.id]);
  useEffect(() => { if (!mapOpen) { arm(); setDetails(false); setFeedback(''); } }, [mapOpen]);
  useEffect(() => { if (feedback) { const timer = window.setTimeout(() => setFeedback(''), 4500); return () => window.clearTimeout(timer); } }, [feedback]);
  useEffect(() => {
    // Capture map shortcuts before the ship's battery/helm bindings; no stuck rudder on exit.
    const key = (event: KeyboardEvent) => {
      if (!state.current.mapOpen || document.querySelector('dialog[open]') || event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement;
      if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
      const index = /^Digit[1-9]$/.test(event.code) ? Number(event.code.at(-1)) - 1 : event.code === 'Digit0' ? 9 : -1;
      const pan = navigation.current.key(event.code, true);
      const actionKey = ['L', 'A', 'D', 'I', 'E', 'R', 'X', 'V'].find(k => event.code === `Key${k}`);
      const close = bindings.airOperations.includes(event.code);
      const handled = index >= 0 || !!pan || !!actionKey || event.code === 'Escape' || close;
      if (!handled) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!pan && !event.repeat) {
        if (close) game?.setAirOperationsOpen(false);
        else if (event.code === 'Escape') { if (armed.current) arm(); else game?.setAirOperationsOpen(false); }
        else if (index >= 0) { const f = state.current.data.combat?.airWing?.groups[index]; if (f) handlers.current.select(f); }
        else if (actionKey) handlers.current.perform(actionKey);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [game, bindings]);
  useEffect(() => {
    const element = map.current;
    if (!mapOpen || !element) return;
    const nav = navigation.current;
    nav.clear();
    const clear = () => nav.clear();
    const keyUp = (event: KeyboardEvent) => { nav.key(event.code, false); };
    const pointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (event.pointerType !== 'mouse' || event.buttons || !(target instanceof Element) || target.closest('button, input, textarea, select, dialog')) {
        nav.pointer = undefined; return;
      }
      const rect = element.getBoundingClientRect();
      nav.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const leave = (event: globalThis.PointerEvent) => { if (!event.relatedTarget) nav.pointer = undefined; };
    let previous = performance.now(), frame: number;
    const tick = (now: number) => {
      const dt = (now - previous) / 1000; previous = now;
      const focused = document.activeElement;
      if (document.hidden || document.querySelector('dialog[open]') || (focused instanceof HTMLElement && (focused.matches('input, textarea, select') || focused.isContentEditable))) nav.clear();
      else if (!drag.current) {
        const rect = element.getBoundingClientRect();
        const [dx, dy] = nav.step(dt, rect.width, rect.height);
        if (dx || dy) game?.panAirMap(dx, dy);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', clear);
    window.addEventListener('pointermove', pointer);
    window.addEventListener('pointerdown', clear);
    window.addEventListener('pointerout', leave);
    document.addEventListener('visibilitychange', clear);
    const resize = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setSize({ width, height }); });
    resize.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      game?.zoomAirMap(event.deltaY, event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame); nav.clear();
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', clear);
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('pointerdown', clear);
      window.removeEventListener('pointerout', leave);
      document.removeEventListener('visibilitychange', clear);
      resize.disconnect(); element.removeEventListener('wheel', wheel); drag.current = null;
    };
  }, [mapOpen, game]);
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-contact]')) return;
    event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start) return;
    start.moved ||= Math.hypot(event.clientX - start.startX, event.clientY - start.startY) > 4;
    if (start.moved) { const rect = event.currentTarget.getBoundingClientRect(); game?.panAirMap(event.clientX - start.x, event.clientY - start.y, event.clientX - rect.left, event.clientY - rect.top); }
    start.x = event.clientX; start.y = event.clientY;
  };
  const release = (event: PointerEvent<SVGSVGElement>) => {
    if (event.type === 'pointerup' && drag.current && !drag.current.moved && armed.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const water = waterPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
      if (water) target({ kind: 'water', point: [water[0], 420, water[1]] });
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const commandShip = (id: string, team: string) => target({ kind: 'ship', id, team });
  const commandFlight = (id: string, team: string) => target({ kind: 'squadron', id, team });
  const aircraft = selected ? wing.flights.filter(p => selected.aircraftIds.includes(p.id)) : [];
  return <>
    {mapOpen && <section className="air-battlefield" aria-label="Air operations battlefield">
      <svg ref={map} className="air-battlefield-map" data-action={armedAction?.kind} viewBox={`0 0 ${size.width} ${size.height}`} tabIndex={0} role="group" aria-label="Battlefield. Drag, hold arrow keys, or move the mouse to a screen edge to pan. Scroll to zoom, right-click to order the selected squadron."
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={release} onPointerCancel={release}
        onContextMenu={event => {
          event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
          const water = waterPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
          if (water) target({ kind: 'water', point: [water[0], 420, water[1]] });
        }}>
        <rect width="100%" height="100%" fill="transparent"/>
        {selected?.active && <path className="air-route" data-map-path={JSON.stringify([selected.position, [selected.destination[0], 0, selected.destination[2]]])} d={`M${point(selected.position[0], selected.position[2], selected.position[1]).join(' ')}L${point(selected.destination[0], selected.destination[2]).join(' ')}`}/>}
        {wing.groups.filter(f => f.active && f.order.kind === 'patrol').map(f => {
          const [x, y] = point(f.destination[0], f.destination[2]);
          const ringWorld = Array.from({ length: 48 }, (_, i) => { const angle = i * Math.PI / 24; return [f.destination[0] + Math.cos(angle) * 700, 0, f.destination[2] + Math.sin(angle) * 700]; });
          const ring = ringWorld.map(([x, y, z]) => point(x, z, y));
          return <g key={f.id} className={`air-station ${f.id === selected?.id ? 'air-selected' : ''}`}>
            <path data-map-path={JSON.stringify(ringWorld)} data-closed="true" d={`M${ring.map(p => p.join(' ')).join('L')}Z`} className="air-loiter-radius"/>
            <g data-map-position={JSON.stringify([f.destination[0], 0, f.destination[2]])} transform={`translate(${x} ${y})`}><path d="M-8 0H8M0-8V8"/><circle r="4"/><text x="11" y="15">{f.name}</text></g>
          </g>;
        })}
        {data.combat!.contacts.map(c => <g key={c.id} data-contact={c.sunk ? undefined : 'ship'} data-map-position={JSON.stringify([c.x, 0, c.z])} className={`air-map-ship ${c.team === 'enemy' ? 'air-hostile' : 'air-friendly'}${c.sunk ? ' air-map-ship-sunk' : ''}`} transform={`translate(${point(c.x, c.z).join(' ')})`}
          role={c.sunk ? undefined : 'button'} tabIndex={c.sunk ? undefined : 0} aria-label={c.sunk ? `${c.name}, sunk` : `${c.name} · ${c.team}. ${c.team === 'enemy' ? 'Right-click to strike' : 'Right-click to defend'}`}
          onClick={() => { if (c.sunk) return; if (armed.current) commandShip(c.id, c.team); else if (c.team === 'enemy') game?.selectTarget(c.id); }}
          onKeyDown={e => { if (!c.sunk && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commandShip(c.id, c.team); } }}
          onContextMenu={e => { if (c.sunk) return; e.preventDefault(); e.stopPropagation(); commandShip(c.id, c.team); }}>
          <title>{c.sunk ? `${c.name}, sunk` : `${c.name} · ${c.team === 'enemy' ? 'Bombers: strike ship' : 'Fighters: defend ship'}`}</title>
          <g className="air-map-ship-marker"><circle r="24" fill="transparent" stroke="none"/><path d="M0-13 6-3 6 11H-6V-3Z" transform={`rotate(${c.heading * 180 / Math.PI})`}/></g>
          <text x="13" y="0">{c.name}{c.id === data.ship.id ? ' · You' : ''}</text>{!c.sunk && <g className="air-map-ship-health" role="meter" aria-label={`${c.name}, hull condition`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.integrity * 100)}>
            <rect className="air-map-ship-health-track" x="13" y="5" width="104" height="5"/>
            <rect className="air-map-ship-health-fill" x="14" y="6" width={102 * Math.max(0, Math.min(1, c.integrity))} height="3"/>
            <text x="65" y="20" textAnchor="middle" dominantBaseline="central">{Math.round(c.integrity * 100)}%</text>
          </g>}
        </g>)}
      </svg>
      <header className="air-map-header"><h2>Air operations</h2>
        <button onClick={e => { game?.setAirOperationsOpen(false); e.currentTarget.blur(); }}>Return to ship <kbd>{bindingLabel(bindings, 'airOperations')}</kbd></button>
      </header>
      <nav className="air-map-tools" aria-label="Battlefield camera"><button onClick={e => { game?.fitAirMap(); e.currentTarget.blur(); }}>Fit battlefield</button><button onClick={e => { game?.centerAirMap(); e.currentTarget.blur(); }}>Center carrier</button>
        <button aria-label="Zoom out battlefield" onClick={e => { game?.zoomAirMap(220); e.currentTarget.blur(); }}>−</button><span>{(view.radius * 2 / 1000).toFixed(1)} km across</span><button aria-label="Zoom in battlefield" onClick={e => { game?.zoomAirMap(-220); e.currentTarget.blur(); }}>+</button>
      </nav>
    </section>}
    <SquadronLabels data={data} game={game} onOrder={commandFlight} onTarget={(id, team) => { if (!armed.current) return false; commandFlight(id, team); return true; }}/>
    {mapOpen && <section className="air-squadron-command air-command-map" aria-label="Squadron commands">
      {mapOpen && <>
        <nav className="air-selected-orders" aria-label="Squadron actions">
          {SQUADRON_ACTIONS.filter(a => !selected || actionAvailable(a, selected.role)).map(action => <button key={action.kind} disabled={!canCommand || !selected?.surviving} aria-pressed={armedAction?.kind === action.kind} aria-keyshortcuts={action.key.toLowerCase()} title={`${action.key} · ${action.label}, then click ${action.target}. Esc cancels.`} onClick={e => { perform(action.key); e.currentTarget.blur(); }}>{action.label}<kbd>{action.key}</kbd></button>)}
          <button aria-label="Return squadron" aria-keyshortcuts="r" disabled={!canCommand || !selected?.active} onClick={e => { perform('R'); e.currentTarget.blur(); }}>Return<kbd>R</kbd></button>
          <button aria-expanded={details} aria-keyshortcuts="v" disabled={!selected} onClick={e => { perform('V'); e.currentTarget.blur(); }}>Aircraft<kbd>V</kbd></button>
          <button aria-keyshortcuts="x" disabled={!canCommand || !wing.activeFlights} onClick={e => { perform('X'); e.currentTarget.blur(); }}>Recall all<kbd>X</kbd></button>
        </nav>
        {feedback && <p className="air-order-feedback" role="status">{feedback}</p>}
        {details && selected && <div className="air-aircraft-detail" aria-label={`${selected.name} aircraft`}><strong>{selected.name} · {mission(selected)} · {selected.hp}% condition</strong><p>{selected.armed} armed · Endurance {duration(selected.enduranceSeconds)}{selected.queuePosition ? ` · Recovery #${selected.queuePosition}` : ''}{selected.notice && ` · ${selected.notice}`}</p>
          {aircraft.map(p => <div key={p.id}><span>Aircraft {p.id.split('/').at(-1)} · {Math.ceil(p.hp)}% · {p.lossReason ?? p.phase}</span><button disabled={!p.followable} onClick={() => game?.followAircraft(p.id)}>Follow</button></div>)}
        </div>}
      </>}
      <div ref={row} className="air-squadron-row" role="group" aria-label="Select squadron">
        {wing.groups.map((f, i) => <button key={f.id} className={`air-squadron-box air-box-${f.status}`} aria-pressed={selected?.id === f.id}
          aria-label={`${f.name}, ${roleLabel(f.role)}, ${f.surviving} of ${f.total} aircraft, ${f.activity}${i < 10 ? `, map hotkey ${(i + 1) % 10}` : ''}`} title={`${roleLabel(f.role)} · ${f.active ? mission(f) : f.activity}`}
          onClick={e => { select(f); e.currentTarget.blur(); }}>
          <span className="air-box-heading"><strong>{f.name}</strong>{i < 10 && <kbd>{mapOpen ? (i + 1) % 10 : `${bindingLabel(bindings, 'airOperations')} → ${(i + 1) % 10}`}</kbd>}</span>
          <img className="air-box-aircraft" src={`/models/aircraft/${wing.flights.find(p => f.aircraftIds.includes(p.id))?.modelId}-thumbnail.png`} alt="" width="320" height="144" draggable={false}/>
          <span className="air-box-count">{f.surviving}<small>/{f.total}</small></span>
          <span className="air-box-status" title={`${f.activity}${f.rearmSeconds ? ` · ${duration(f.rearmSeconds)}` : ''}`}><SquadronIcon role={f.role} size={14}/><span>{f.rearmSeconds ? `Rearm ${duration(f.rearmSeconds)}` : f.activity}</span></span>
          <span className="air-box-strength" aria-hidden="true">{Array.from({ length: f.total }, (_, index) => <i key={index} className={index < f.surviving ? 'alive' : ''}/>)}</span>
        </button>)}
      </div>
    </section>}
  </>;
}

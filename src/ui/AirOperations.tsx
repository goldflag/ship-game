import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import { AIR_STATUS_LABELS, type AirStatus, type AirWingTelemetry, type FlightSummary } from '../simulation/airTelemetry';
import type { AirOrder } from '../simulation/aircraft';
import type { Vec3 } from '../ships/blueprint';
import { chartPoint, chartWorld } from './airChart';
import { actionAvailable, SQUADRON_ACTIONS, squadronTargetOrder, type SquadronAction, type SquadronTarget } from './airCommands';
import { Icon } from './Icons';
import './AirOperations.css';
import { AirMapNavigation } from './airMapNavigation';
import { duration, mission, roleIcon, roleLabel } from './airFormat';
import { AirWingManifest } from './AirWingManifest';
import { markerOpacity } from './fleetStats';
import { aircraftShortName } from './aircraftNames';
import { smoothMapPath } from '../game/smoothMapPath';
import { reportState } from './reconReports';
import { projectAirMarker, projectMapHeading } from './airMarkerProjection';

// Camera motion is rendered every frame; combat telemetry intentionally stays at 10 Hz.
// Move the overlay directly so camera motion never waits for a React telemetry render.
export function useMapProjection(ref: RefObject<HTMLElement | SVGSVGElement | null>, game: Game | null, active: boolean) {
  useEffect(() => {
    if (!active || !game) return;
    const update = () => {
      const markers = Array.from(ref.current?.querySelectorAll<HTMLElement | SVGElement>('[data-map-position]') ?? [], element => {
        const [x, y, z] = JSON.parse(element.dataset.mapPosition!) as number[];
        const point = projectAirMarker(game, element.dataset, [x, y, z]);
        const headings = Array.from(element.querySelectorAll<SVGElement>('[data-map-heading]'), glyph => {
          const heading = Number(glyph.dataset.mapHeading);
          return { glyph, angle: projectMapHeading(game, [x, y, z], heading) };
        });
        // A ship marker stands in for a hull too small to read; once the model
        // itself is legible on screen the marker fades and only the label stays.
        let fade: number | undefined;
        let close = false;
        if (element.dataset.mapFade && point) {
          // "length,heading[,start,end]": the span in metres along the heading and the on-screen pixel band over which the marker fades.
          const [length, heading, start, end] = element.dataset.mapFade.split(',').map(Number);
          const bow = game.projectAirMap(x + Math.sin(heading) * length / 2, z - Math.cos(heading) * length / 2, y);
          const stern = game.projectAirMap(x - Math.sin(heading) * length / 2, z + Math.cos(heading) * length / 2, y);
          if (bow && stern) {
            close = Math.hypot(bow[0] - stern[0], bow[1] - stern[1]) >= 14;
            fade = markerOpacity(Math.hypot(bow[0] - stern[0], bow[1] - stern[1]), Number.isFinite(start) ? start : undefined, Number.isFinite(end) ? end : undefined);
          }
        }
        return { element, point, headings, fade, close };
      });
      const paths = Array.from(ref.current?.querySelectorAll<SVGPathElement>('[data-map-path]') ?? [], element => {
        const points = JSON.parse(element.dataset.mapPath!) as Vec3[];
        return { element, path: game.projectAirMapPath(element.dataset.mapSmooth ? smoothMapPath(points, !!element.dataset.closed) : points, !!element.dataset.closed, !!element.dataset.mapFill) };
      });
      // Projection reads the viewport. Complete those reads before any overlay
      // writes, so one marker cannot force layout for the following marker.
      for (const { element, point, headings, fade, close } of markers) {
        element.style.display = point ? '' : 'none';
        if (!point) continue;
        const [left, top] = point;
        if (element instanceof SVGElement) element.setAttribute('transform', `translate(${left} ${top})`);
        else { element.style.left = `${left}px`; element.style.top = `${top}px`; }
        for (const { glyph, angle } of headings) if (angle !== undefined) glyph.setAttribute('transform', `rotate(${angle})`);
        for (const detail of element.querySelectorAll<SVGElement>('[data-map-detail]')) detail.style.display = close || element.classList.contains('selected') ? 'initial' : 'none';
        if (fade !== undefined) (element.querySelector<SVGElement | HTMLElement>('[data-map-glyph]') ?? element).style.opacity = String(fade);
      }
      for (const { element, path } of paths) element.setAttribute('d', path);
    };
    update();
    return game.onCameraFrame(update);
  }, [ref, game, active]);
}
export function WingCounts({ wing, selected, onSelect }: { wing: AirWingTelemetry; selected?: AirStatus; onSelect?(status: AirStatus): void }) {
  return <div className="air-counts" aria-label="Whole air wing status">{(Object.keys(AIR_STATUS_LABELS) as AirStatus[]).map(status =>
    <button key={status} className={`air-count air-count-${status}`} aria-pressed={selected === status} onClick={e => { onSelect?.(status); e.currentTarget.blur(); }}>
      <strong>{wing.counts[status]}</strong><span>{AIR_STATUS_LABELS[status]}</span>
    </button>)}</div>;
}

function SquadronIcon({ role, size = 20 }: { role: FlightSummary['role']; size?: number }) {
  return <span className="air-role-icon" data-role={role} title={roleLabel(role)}><Icon name={roleIcon(role)} size={size}/></span>;
}

export function SquadronLabels({ data, game, onOrder, onTarget, onSelect, onPointerDown }: { data: Telemetry; game: Game | null; onOrder?(id: string, team: string): void; onTarget?(id: string, team: string): boolean; onSelect?(id: string, additive?: boolean): void; onPointerDown?(event: PointerEvent<Element>): void }) {
  const labels = useRef<HTMLDivElement>(null);
  const reports = game?.simulation?.observationTracks ?? [];
  const observedPlanes = data.airOperationsOpen ? [] : (game?.simulation.observedAircraft ?? []).filter(p =>
    p.observers.includes(data.spectatedShipId ?? data.ship.id) && reports.some(r => r.id === p.id && reportState(r, game!.simulation.tick) === 'current'));
  useLayoutEffect(() => {
    if (!game) return;
    const update = () => {
      const projections = Array.from(labels.current?.querySelectorAll<HTMLElement>('[data-flight-id]') ?? [], element =>
        ({ element, point: game.projectSquadron(element.dataset.ownerId!, element.dataset.flightId!) }));
      for (const element of labels.current?.querySelectorAll<HTMLElement>('[data-aircraft-contact]') ?? []) {
        const contact = game.projectContact(element.dataset.aircraftContact!);
        projections.push({ element, point: contact ? { x: contact[0], y: contact[1] } : null });
      }
      for (const { element, point } of projections) {
        element.style.display = point ? '' : 'none';
        if (point) { element.style.left = `${point.x}px`; element.style.top = `${point.y}px`; }
      }
    };
    update();
    return game.onCameraFrame(update);
  }, [game, data.squadronMarkers, data.spectatedShipId, data.ship.id]);
  return <div ref={labels} className={`air-squadron-labels ${data.airOperationsOpen ? 'air-labels-map' : ''}`} aria-label="Squadron names and status">
    {observedPlanes.map(p => <span key={p.id} className="air-squadron-tag air-hostile" data-aircraft-contact={p.id} style={{ display: 'none' }}>
      <Icon name="aircraft" size={20}/><span><strong>{aircraftShortName(p.modelId) ?? 'Enemy aircraft'}</strong><small>{reports.find(r => r.id === p.id)?.classification ?? 'Aircraft'}</small></span>
    </span>)}
    {data.squadronMarkers?.map(f => <button key={f.id} className={`air-squadron-tag ${f.team === 'enemy' ? 'air-hostile' : 'air-friendly'} ${(data.selectedFlightIds ?? [data.selectedFlightId]).includes(f.id) ? 'air-selected' : ''}`}
      onPointerDown={onPointerDown} data-flight-id={f.id} data-owner-id={f.ownerId} style={{ left: f.screen?.x, top: f.screen?.y, display: f.screen ? undefined : 'none' }} title={`${f.name} · ${roleLabel(f.role)} · ${mission(f)} · ${f.hp}% condition`}
      aria-label={`${f.name} · ${roleLabel(f.role)} · ${f.surviving} aircraft · ${f.activity}`}
      tabIndex={data.airOperationsOpen ? 0 : -1}
      onClick={e => { if ((e.metaKey || e.ctrlKey || !onTarget?.(f.id, f.team)) && (f.ownerId === data.ship.id || (game?.fleetCommandMode && f.team === 'friendly'))) { if (onSelect) onSelect(f.id, e.metaKey || e.ctrlKey); else game?.selectFlight(f.id, e.metaKey || e.ctrlKey); } e.currentTarget.blur(); }}
      onContextMenu={e => { if (data.airOperationsOpen) { e.preventDefault(); if (!e.ctrlKey && !e.metaKey) onOrder?.(f.id, f.team); } }}>
      <SquadronIcon role={f.role}/><span><strong>{f.name} · {f.surviving}</strong><small>{f.activity}</small></span>
    </button>)}
  </div>;
}

/** Instruments over the actual 3D scene. M changes the camera, never opens a dialog. */
export function AirOperations({ data, game, bindings, instrumentsVisible = true }: { data: Telemetry; game: Game | null; bindings: Keybindings; instrumentsVisible?: boolean }) {
  const wing = data.combat!.airWing!;
  const mapOpen = !!data.airOperationsOpen;
  const [pendingSelection, setPendingSelection] = useState<string[]>();
  const selectedIds = pendingSelection ?? data.selectedFlightIds ?? (data.selectedFlightId ? [data.selectedFlightId] : []);
  const selectedFlights = selectedIds.flatMap(id => wing.groups.find(f => f.id === id) ?? []);
  const selected = selectedFlights[0];
  useEffect(() => {
    if (pendingSelection && JSON.stringify(pendingSelection) === JSON.stringify(data.selectedFlightIds ?? [])) setPendingSelection(undefined);
  }, [pendingSelection, data.selectedFlightIds]);
  const [feedback, setFeedback] = useState('');
  const [details, setDetails] = useState(false);
  const [armedAction, setArmedAction] = useState<SquadronAction>();
  const armed = useRef<SquadronAction | undefined>(undefined);
  const arm = (action?: SquadronAction) => { armed.current = action; setArmedAction(action); };
  const [size, setSize] = useState({ width: typeof window === 'undefined' ? 1280 : window.innerWidth, height: typeof window === 'undefined' ? 720 : window.innerHeight });
  const map = useRef<SVGSVGElement>(null);
  useMapProjection(map, game, mapOpen);
  const row = useRef<HTMLDivElement>(null);
  const suppressClickUntil = useRef(0);
  const drag = useRef<{ x: number; y: number; moved: boolean; startX: number; startY: number; orbit: boolean; box: boolean; additive: boolean; flightId?: string } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number }>();
  const navigation = useRef(new AirMapNavigation());
  const rotation = useRef(new AirMapNavigation());
  const state = useRef({ data, selected, selectedIds, mapOpen, size, instrumentsVisible }); state.current = { data, selected, selectedIds, mapOpen, size, instrumentsVisible };
  const canCommand = data.combat!.result === 'active' && !data.combat!.playerSunk;
  const view = data.airMap ?? { x: data.ship.x, z: data.ship.z, radius: 8000 };
  const point = (x: number, z: number, altitude = 0) => game ? game.projectAirMap(x, z, altitude) : chartPoint(view, size.width, size.height, x, z, altitude);
  const path = (points: Vec3[], closed = false) => game?.projectAirMapPath(points, closed) ?? `M${points.map(([x, y, z]) => (point(x, z, y) ?? [0, 0]).join(' ')).join('L')}${closed ? 'Z' : ''}`;
  const waterPoint = (x: number, y: number, width: number, height: number) => game ? game.airMapWater(x, y) : chartWorld(view, width, height, x, y);
  const currentFlights = () => {
    const ids = game ? game.selectedFlightIds : state.current.selectedIds;
    return ids.flatMap(id => state.current.data.combat?.airWing?.groups.find(f => f.id === id) ?? []);
  };
  const currentFlight = () => currentFlights()[0];
  const issue = (order: AirOrder) => {
    const flights = currentFlights();
    if (!flights.length) { setFeedback('Select a squadron below first.'); return; }
    const accepted = flights.filter(f => game?.commandSquadron(f.id, order));
    if (accepted.length) arm();
    const rejected = flights.filter(f => !accepted.includes(f));
    setFeedback(accepted.length ? `${accepted.length} squadron${accepted.length === 1 ? '' : 's'} · Order received${rejected.length ? ` · ${rejected.map(f => f.name).join(', ')} unable to accept: check role, readiness and flight slots.` : ''}`
      : !canCommand ? 'Carrier unavailable · Battle ended or carrier lost.'
      : !wing.available && flights.some(f => !f.active) ? 'Launch suspended · Check carrier damage, list and trim.'
      : wing.maxActiveFlights !== null && wing.activeFlights >= wing.maxActiveFlights && flights.some(f => !f.active) ? `All ${wing.maxActiveFlights} flight slots occupied · Recover a squadron to launch.`
      : 'Order unavailable · Check role, readiness, armament, endurance and the 30 km command range.');
  };
  const setSelection = (ids: string[]) => {
    arm(); setFeedback(''); setDetails(false);
    game?.selectFlights(ids); setPendingSelection(game ? [...game.selectedFlightIds] : ids);
  };
  const select = (f: FlightSummary, additive = false) => {
    const ids = game ? game.selectedFlightIds : state.current.selectedIds;
    setSelection(additive ? ids.includes(f.id) ? ids.filter(id => id !== f.id) : [...ids, f.id]
      : ids.length === 1 && ids[0] === f.id ? [] : [f.id]);
  };
  const perform = (key: string) => {
    const flight = currentFlight();
    if (key === 'V') { if (flight) setDetails(v => !v); return; }
    if (!canCommand) return;
    if (key === 'X') { if (wing.activeFlights) { game?.recallAircraft(); arm(); setFeedback('All squadrons recalled'); } return; }
    if (!flight) { setFeedback('Select a squadron first.'); return; }
    if (key === 'R') { issue({ kind: 'return' }); return; }
    const action = SQUADRON_ACTIONS.find(a => a.key === key);
    if (action && currentFlights().some(f => f.surviving && actionAvailable(action, f.role))) { arm(armed.current?.kind === action.kind ? undefined : action); setFeedback(''); }
  };
  const target = (contact: SquadronTarget) => {
    const order = squadronTargetOrder(armed.current?.kind, contact);
    if (order) issue(order);
    else setFeedback(`Choose ${armed.current?.target}.`);
  };
  const handlers = useRef({ select, perform }); handlers.current = { select, perform };
  useEffect(() => { row.current?.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected?.id]);
  useEffect(() => { if (!mapOpen || !instrumentsVisible) { drag.current = null; setSelectionBox(undefined); arm(); setDetails(false); setFeedback(''); } }, [mapOpen, instrumentsVisible]);
  useEffect(() => { if (feedback) { const timer = window.setTimeout(() => setFeedback(''), 4500); return () => window.clearTimeout(timer); } }, [feedback]);
  useEffect(() => {
    // Capture map shortcuts before the ship's battery/helm bindings; no stuck rudder on exit.
    const key = (event: KeyboardEvent) => {
      if (!state.current.mapOpen || document.querySelector('dialog[open]') || event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement;
      if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
      const index = /^Digit[1-9]$/.test(event.code) ? Number(event.code.at(-1)) - 1 : event.code === 'Digit0' ? 9 : -1;
      const pan = navigation.current.key(event.code, !event.shiftKey);
      rotation.current.key(event.code, event.shiftKey);
      const actionKey = ['L', 'A', 'D', 'I', 'E', 'R', 'X', 'V'].find(k => event.code === `Key${k}`);
      const close = bindings.airOperations.includes(event.code);
      const handled = index >= 0 || !!pan || !!actionKey || event.code === 'Escape' || close || event.code === 'ShiftLeft' || event.code === 'ShiftRight';
      if (!handled) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!pan && !event.repeat) {
        if (close) game?.setAirOperationsOpen(false);
        else if (event.code === 'Escape') { if (armed.current) arm(); else game?.setAirOperationsOpen(false); }
        else if (state.current.instrumentsVisible && index >= 0) { const f = state.current.data.combat?.airWing?.groups[index]; if (f) handlers.current.select(f); }
        else if (state.current.instrumentsVisible && actionKey) handlers.current.perform(actionKey);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [game, bindings]);
  useEffect(() => {
    const element = map.current;
    if (!mapOpen || !element) return;
    const nav = navigation.current;
    const orbit = rotation.current;
    const clear = () => { nav.clear(); orbit.clear(); };
    const beginPointer = () => { clear(); suppressClickUntil.current = 0; };
    const cancelDrag = () => { clear(); drag.current = null; setSelectionBox(undefined); };
    clear();
    const keyUp = (event: KeyboardEvent) => { nav.key(event.code, false); orbit.key(event.code, false); if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') orbit.clear(); };
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
      if (document.hidden || document.querySelector('dialog[open]') || (focused instanceof HTMLElement && (focused.matches('input, textarea, select') || focused.isContentEditable))) clear();
      else if (!drag.current) {
        const rect = element.getBoundingClientRect();
        const [dx, dy] = nav.step(dt, rect.width, rect.height);
        if (dx || dy) game?.panAirMap(dx, dy);
        const [rx, ry] = orbit.step(dt, rect.width, rect.height);
        if (rx || ry) game?.orbitAirMap(rx * .35, ry * .35);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('pointermove', pointer);
    window.addEventListener('pointerdown', beginPointer);
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
      cancelAnimationFrame(frame); clear();
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('pointerdown', beginPointer);
      window.removeEventListener('pointerout', leave);
      document.removeEventListener('visibilitychange', clear);
      resize.disconnect(); element.removeEventListener('wheel', wheel); drag.current = null;
    };
  }, [mapOpen, game]);
  const pointerDown = (event: PointerEvent<Element>) => {
    if ((event.button !== 0 && event.button !== 1) || ((event.target as Element).closest('[data-contact]') && !event.shiftKey && !event.metaKey && !event.ctrlKey)) return;
    const element = map.current;
    if (!element) return;
    event.preventDefault();
    element.focus(); element.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, orbit: event.button === 1 || (!event.shiftKey && (event.metaKey || event.ctrlKey)), box: event.button === 0 && event.shiftKey && instrumentsVisible, additive: event.metaKey || event.ctrlKey, flightId: (event.target as Element).closest<HTMLElement>('[data-flight-id]')?.dataset.flightId };
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start) return;
    start.moved ||= Math.hypot(event.clientX - start.startX, event.clientY - start.startY) > 4;
    if (start.moved) {
      if (start.box) {
        const rect = event.currentTarget.getBoundingClientRect();
        const sx = size.width / rect.width, sy = size.height / rect.height;
        setSelectionBox({ x: (Math.min(start.startX, event.clientX) - rect.left) * sx, y: (Math.min(start.startY, event.clientY) - rect.top) * sy,
          width: Math.abs(event.clientX - start.startX) * sx, height: Math.abs(event.clientY - start.startY) * sy });
      } else if (start.orbit) game?.orbitAirMap(event.clientX - start.x, event.clientY - start.y);
      else { const rect = event.currentTarget.getBoundingClientRect(); game?.panAirMap(event.clientX - start.x, event.clientY - start.y, event.clientX - rect.left, event.clientY - rect.top); }
    }
    start.x = event.clientX; start.y = event.clientY;
  };
  const release = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (event.type === 'pointerup' && start && !start.moved && start.flightId) {
      const flight = wing.groups.find(f => f.id === start.flightId);
      if (flight) select(flight, start.additive);
      suppressClickUntil.current = performance.now() + 250;
    }
    if (start?.moved) suppressClickUntil.current = performance.now() + 250;
    if (event.type === 'pointerup' && start?.box && start.moved) {
      const rect = event.currentTarget.getBoundingClientRect();
      const left = Math.min(start.startX, event.clientX), right = Math.max(start.startX, event.clientX);
      const top = Math.min(start.startY, event.clientY), bottom = Math.max(start.startY, event.clientY);
      const ids = wing.groups.filter(f => {
        const p = game?.projectSquadron(data.ship.id, f.id);
        if (!p || !f.surviving) return false;
        const x = rect.left + p.x * rect.width / size.width, y = rect.top + p.y * rect.height / size.height;
        return x >= left && x <= right && y >= top && y <= bottom;
      }).map(f => f.id);
      setSelection(start.additive ? [...new Set([...(game?.selectedFlightIds ?? selectedIds), ...ids])] : ids);
    }
    setSelectionBox(undefined);
    if (event.type === 'pointerup' && drag.current && !drag.current.moved && !drag.current.orbit && !drag.current.box && armed.current && instrumentsVisible) {
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
      <svg ref={map} className="air-battlefield-map" data-action={armedAction?.kind} viewBox={`0 0 ${size.width} ${size.height}`} tabIndex={0} role="group" aria-label="Battlefield. Drag, hold arrow keys, or move the mouse to a screen edge to pan. Scroll to zoom. Shift-drag to select squadrons. Command/Ctrl-click to add or remove squadrons. Command/Ctrl-drag, middle-drag or Shift+arrow keys to change angle. Right-click to order selected squadrons when instruments are visible."
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={release} onPointerCancel={release}
        onContextMenu={event => {
          event.preventDefault(); if (!instrumentsVisible || event.ctrlKey || event.metaKey || performance.now() < suppressClickUntil.current) return; const rect = event.currentTarget.getBoundingClientRect();
          const water = waterPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
          if (water) target({ kind: 'water', point: [water[0], 420, water[1]] });
        }}>
        <rect width="100%" height="100%" fill="transparent"/>
        {instrumentsVisible && <>
        {selectedFlights.filter(f => f.active).map(selected => <path key={selected.id} className="air-route" data-map-path={JSON.stringify([selected.position, [selected.destination[0], 0, selected.destination[2]]])} d={path([selected.position, [selected.destination[0], 0, selected.destination[2]]])}/>)}
        {wing.groups.filter(f => f.active && f.order.kind === 'patrol').map(f => {
          const station = point(f.destination[0], f.destination[2]);
          const [x, y] = station ?? [0, 0];
          const ringWorld = Array.from({ length: 48 }, (_, i): Vec3 => { const angle = i * Math.PI / 24; return [f.destination[0] + Math.cos(angle) * 700, 0, f.destination[2] + Math.sin(angle) * 700]; });
          return <g key={f.id} className={`air-station ${selectedIds.includes(f.id) ? 'air-selected' : ''}`}>
            <path data-map-path={JSON.stringify(ringWorld)} data-closed="true" d={path(ringWorld, true)} className="air-loiter-radius"/>
            <g style={{ display: station ? undefined : 'none' }} data-map-position={JSON.stringify([f.destination[0], 0, f.destination[2]])} transform={`translate(${x} ${y})`}><path d="M-8 0H8M0-8V8"/><circle r="4"/><text x="11" y="15">{f.name}</text></g>
          </g>;
        })}
        {data.combat!.contacts.map(c => <g key={c.id} data-contact={c.sunk ? undefined : 'ship'} data-map-position={JSON.stringify([c.x, 0, c.z])} className={`air-map-ship ${c.team === 'enemy' ? 'air-hostile' : 'air-friendly'}${c.sunk ? ' air-map-ship-sunk' : ''}`} style={{ display: point(c.x, c.z) ? undefined : 'none' }} transform={`translate(${(point(c.x, c.z) ?? [0, 0]).join(' ')})`}
          role={c.sunk ? undefined : 'button'} tabIndex={c.sunk ? undefined : 0} aria-label={c.sunk ? `${c.name}, sunk` : `${c.name} · ${c.team}. ${c.team === 'enemy' ? 'Right-click to strike' : 'Right-click to defend'}`}
          onClick={() => { if (c.sunk || performance.now() < suppressClickUntil.current) return; if (armed.current) commandShip(c.id, c.team); else if (c.team === 'enemy') game?.selectTarget(c.id); }}
          onKeyDown={e => { if (!c.sunk && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commandShip(c.id, c.team); } }}
          onContextMenu={e => { if (c.sunk) return; e.preventDefault(); e.stopPropagation(); if (!e.ctrlKey && !e.metaKey && performance.now() >= suppressClickUntil.current) commandShip(c.id, c.team); }}>
          <title>{c.sunk ? `${c.name}, sunk` : `${c.name} · ${c.team === 'enemy' ? 'Bombers: strike ship' : 'Fighters: defend ship'}`}</title>
          <g className="air-map-ship-marker"><circle r="24" fill="transparent" stroke="none"/><path d="M0-13 6-3 6 11H-6V-3Z" transform={`rotate(${(c.heading - (view.bearing ?? 0)) * 180 / Math.PI})`}/></g>
          <text x="13" y="0">{c.name}{c.id === data.ship.id ? ' · You' : ''}</text>{!c.sunk && <g className="air-map-ship-health" role="meter" aria-label={`${c.name}, hull condition`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.integrity * 100)}>
            <rect className="air-map-ship-health-track" x="13" y="5" width="80" height="5"/>
            <rect className="air-map-ship-health-fill" x="14" y="6" width={78 * Math.max(0, Math.min(1, c.integrity))} height="3"/>
            <text x="53" y="20" textAnchor="middle" dominantBaseline="central">{Math.round(c.integrity * 100)}%</text>
          </g>}
        </g>)}
        </>}
        {selectionBox && <rect className="air-selection-box" {...selectionBox}/>}
      </svg>
      {instrumentsVisible && <>
      <header className="air-map-header"><h2>Air operations</h2><p className="air-selection-hint">Shift-drag select · ⌘/Ctrl-click add · ⌘/Ctrl-drag rotate{selectedFlights.length > 1 ? ` · ${selectedFlights.length} selected` : ''}</p>
        <button onClick={e => { game?.setAirOperationsOpen(false); e.currentTarget.blur(); }}>Return to ship <kbd>{bindingLabel(bindings, 'airOperations')}</kbd></button>
      </header>
      </>}
    </section>}
    {instrumentsVisible && <SquadronLabels data={{ ...data, selectedFlightId: selected?.id, selectedFlightIds: selectedIds }} game={game} onPointerDown={e => { if (mapOpen && (e.shiftKey || e.metaKey || e.ctrlKey || e.button === 1)) pointerDown(e); }} onSelect={(id, additive) => { if (performance.now() < suppressClickUntil.current) return; const f = wing.groups.find(f => f.id === id); if (f) select(f, additive); }} onOrder={commandFlight} onTarget={(id, team) => { if (performance.now() < suppressClickUntil.current) return true; if (!armed.current || id === currentFlight()?.id) return false; commandFlight(id, team); return true; }}/>}
    {mapOpen && instrumentsVisible && <section className="air-squadron-command air-command-map" aria-label="Squadron commands">
      {mapOpen && <>
        <nav className="air-selected-orders" aria-label="Squadron actions">
          {SQUADRON_ACTIONS.filter(a => !selected || selectedFlights.some(f => actionAvailable(a, f.role))).map(action => <button key={action.kind} disabled={!canCommand || !selectedFlights.some(f => f.surviving)} aria-pressed={armedAction?.kind === action.kind} aria-keyshortcuts={action.key.toLowerCase()} title={`${action.key} · ${action.label}, then click ${action.target}. Esc cancels.`} onClick={e => { perform(action.key); e.currentTarget.blur(); }}>{action.label}<kbd>{action.key}</kbd></button>)}
          <button aria-label="Return squadron" aria-keyshortcuts="r" disabled={!canCommand || !selectedFlights.some(f => f.active)} onClick={e => { perform('R'); e.currentTarget.blur(); }}>Return<kbd>R</kbd></button>
          <button aria-expanded={details} aria-keyshortcuts="v" disabled={!selected} onClick={e => { perform('V'); e.currentTarget.blur(); }}>Aircraft<kbd>V</kbd></button>
          <button aria-keyshortcuts="x" disabled={!canCommand || !wing.activeFlights} onClick={e => { perform('X'); e.currentTarget.blur(); }}>Recall all<kbd>X</kbd></button>
        </nav>
        {feedback && <p className="air-order-feedback" role="status">{feedback}</p>}
        {details && selected && <div className="air-aircraft-detail" aria-label={`${selected.name} aircraft`}><strong>{selected.name} · {mission(selected)} · {selected.hp}% condition</strong><p>{selected.armed} armed{selected.enduranceSeconds !== null && ` · Endurance ${duration(selected.enduranceSeconds)}`}{selected.queuePosition ? ` · Recovery #${selected.queuePosition}` : ''}{selected.notice && ` · ${selected.notice}`}</p>
          {aircraft.map(p => <div key={p.id}><span>Aircraft {p.id.split('/').at(-1)} · {Math.ceil(p.hp)}% · {p.lossReason ?? p.phase}</span><button disabled={!p.followable} onClick={() => game?.followAircraft(p.id)}>Follow</button></div>)}
        </div>}
      </>}
      <div ref={row} className="air-squadron-row" role="group" aria-label="Select squadron">
        {wing.groups.map((f, i) => <button key={f.id} className={`air-squadron-box air-box-${f.status}`} aria-pressed={selectedIds.includes(f.id)}
          aria-label={`${f.name}, ${roleLabel(f.role)}, ${f.surviving} of ${f.total} aircraft, ${f.activity}${i < 10 ? `, map hotkey ${(i + 1) % 10}` : ''}`} title={`${roleLabel(f.role)} · ${f.active ? mission(f) : f.activity}`}
          onClick={e => { select(f, e.metaKey || e.ctrlKey); e.currentTarget.blur(); }}>
          <span className="air-box-heading"><strong>{f.name}</strong>{i < 10 && <kbd>{mapOpen ? (i + 1) % 10 : `${bindingLabel(bindings, 'airOperations')} → ${(i + 1) % 10}`}</kbd>}</span>
          <img className="air-box-aircraft" src={`/models/aircraft/${wing.flights.find(p => f.aircraftIds.includes(p.id))?.modelId}-thumbnail.png`} alt="" width="320" height="144" draggable={false}/>
          <span className="air-box-count">{f.surviving}<small>/{f.total}</small></span>
          <span className="air-box-status" title={`${f.activity}${f.rearmSeconds ? ` · ${duration(f.rearmSeconds)}` : ''}`}><SquadronIcon role={f.role} size={14}/><span>{f.rearmSeconds ? `Rearm ${duration(f.rearmSeconds)}` : f.activity}</span></span>
          <span className="air-box-strength" aria-hidden="true">{Array.from({ length: f.total }, (_, index) => <i key={index} className={index < f.surviving ? 'alive' : ''}/>)}</span>
        </button>)}
      </div>
    </section>}
    {mapOpen && instrumentsVisible && <AirWingManifest wing={wing} selectedIds={selectedIds} onSelect={select}/>}
  </>;
}

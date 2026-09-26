import { Select, SelectOption } from './components';
import { useEffect, useRef, useState, type SVGProps, type PointerEvent as ReactPointerEvent } from 'react';
import type { Telemetry } from '../game/types';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { SearchAltitude } from '../multiplayer/generated/SearchAltitude';
import type { SearchPolicy } from '../multiplayer/generated/SearchPolicy';
import type { Vec3 } from '../ships/blueprint';
import { AirGroupService } from './CarrierDeck';
import { ENGINE_LABELS, KNOTS_PER_MPS } from '../game/session/motion';
import { SquadronLabels, useMapProjection } from './AirOperations';
import { AirMapNavigation } from './airMapNavigation';
import { fleetAirCourse } from './fleetAirCourse';
import { actionAvailable, SQUADRON_ACTIONS, type SquadronAction, type SquadronTarget } from './airCommands';
import { duration, mission } from './airFormat';
import { Icon } from './Icons';
import { SimulationSpeed } from './SimulationSpeed';
import { ReconnaissanceCoverage, ReconnaissanceLegend } from './Reconnaissance';
import { reportState, reportPosition, reportName, conditionReport, observationAge } from './reconReports';
import { resolveShip } from '../ships/localShips';
import type { FleetFormation } from './fleetFormations';
import { FORMATIONS, formationLabel } from './formationStations';
import type { Formation } from '../multiplayer/generated/Formation';
import { reportedAircraftType } from './fleetStats';
import { PLANE_GLYPHS } from './planeGlyphs';
import { loadLabel } from './airIntent';
import { AmmoBelt, InboundBadge, OrdnanceMark } from './AirArmamentMarks';
import { SHIP_GLYPHS, shipClassFromReport, shipClassOf } from './shipGlyphs';
import { EnemyFleet, EnemyRoster, bearingLabel, rangeLabel } from './EnemyFleet';
import { DEFAULT_MAP, oceanMap } from '../maps/catalog';
import { OwnFleetCard } from './OwnFleet';
import { FlightLine } from './FlightLine';
import { OrderWheel, type WheelItem } from './OrderWheel';
import './FleetCommand.css';
import { PlaneHealth } from './PlaneHealth';
import {
  advancePendingRoutes,
  boxSelect,
  circlePoints,
  fleetDragMode,
  fleetView,
  fleetWaterAction,
  FORMATION_HINT,
  LOITER_RADIUS_M,
  nextNotice,
  reportGesture,
  sendAirOrder,
  sendAutonomous,
  sendDeckService,
  sendEscort,
  sendFocus,
  sendHold,
  sendReturn,
  sendRoute,
  sendSearch,
  setGroupFormation,
  shipGesture,
  standingOrder,
  toggleWeapons,
  type ArmedOrder,
  type Contact,
  type FleetDesk,
  type PendingRoute,
  type ShipGesture,
} from './fleet/fleetView';

export { applyGroupFormation, FORMATION_HINT, standingOrder, stationEscorts } from './fleet/fleetView';
import type { CombatTelemetry } from '../game/session/telemetry';
import { airborne } from '../game/airWing';
import { isDeveloperConsoleKey } from './devConsoleCommands';
import { deadlineCaption, ObjectiveReadout } from './ObjectiveReadout';

const SPEEDS = [8, 12, 16, 20, 24, 28, 30];
/** Orders aimed at water preview a line from the unit to the cursor while armed. */
const previewArmed = (armed?: ArmedOrder) =>
  armed === 'move' || armed === 'search' || (typeof armed === 'object' && armed.target === 'water');
const reportAge = (track: ContactTrack, tick: number) => observationAge(track.lastObservedTick, tick);
const reportUncertainty = (track: ContactTrack) =>
  track.uncertaintyM >= 1000 ? `${(track.uncertaintyM / 1000).toFixed(1)} km` : `${Math.round(track.uncertaintyM)} m`;
const WEAPONS = ['guns', 'aa', 'torpedoes'] as const;
const weaponLabel = { guns: 'Guns', aa: 'AA', torpedoes: 'Torpedoes' } as const;

/** Orders live at the cursor: a wheel beside the selected ship, a bar beside
 * selected air groups, a popover on a report. Chrome stays at the edges. Every
 * actual order still travels through Rust. The chart holds only what is in hand:
 * the armed order, the hovered unit and the pending previews; everything it
 * shows comes from the fleet view, everything it does goes through the desk. */
export function FleetCommand({
  data,
  desk,
  bindings,
  instrumentsVisible = true,
}: {
  data: Telemetry;
  desk: FleetDesk;
  bindings: Keybindings;
  instrumentsVisible?: boolean;
}) {
  const combat = data.combat!;
  const mapOpen = !!data.airOperationsOpen;
  /** A custom battle reads this chart from a helm it still holds: no captain to follow, a way back to the ship. */
  const visiting = !!data.helmChart;
  const { issue, chart } = desk;
  const view = fleetView(desk.frame, {
    combat,
    selectedShipIds: data.selectedShipIds ?? [],
    selectedFlightIds: desk.selectedFlightIds,
    controlGroups: desk.controlGroups,
    mapOpen,
    spectatedShipId: data.spectatedShipId,
    controlledShipId: data.controlledShipId,
  });
  const {
    tick,
    ships,
    nameFor,
    observations,
    boundary,
    orders,
    formations,
    wings,
    flights,
    selected,
    selectedFlights,
    ownPlanes,
    observedModels,
    clusters,
    strikes,
    threats,
    subject,
    recipients,
    lead,
    actionable,
    selectedGroup,
  } = view;
  const ids = data.selectedShipIds ?? [];
  const healthMarker = (c: ContactTrack, x: number, y: number) => {
    const hp = view.healthOf(c);
    return hp === undefined ? null : (
      <g className="fleet-command-enemy-health" aria-label={`${reportName(c)} · ${Math.round(hp * 100)}% HP`}>
        <rect className="fleet-command-hull-track" x={x} y={y} width="40" height="3" />
        <rect className="fleet-command-hull-fill" x={x} y={y} width={40 * hp} height="3" />
        <text x={x + 45} y={y + 5}>
          {Math.round(hp * 100)}% HP
        </text>
      </g>
    );
  };
  const [coveragePoint, setCoveragePoint] = useState<[number, number]>();
  const coverageTick = view.coverageTickAt(coveragePoint);
  const [airOpen, setAirOpen] = useState(false);
  const [filter, setFilter] = useState<'ships' | 'aircraft'>('ships');
  const [speedKn, setSpeedKn] = useState(20);
  const [search, setSearch] = useState<{ radiusM: number; altitude: SearchAltitude; policy: SearchPolicy }>({
    radiusM: 4000,
    altitude: 'medium',
    policy: 'report',
  });
  const [armed, setArmed] = useState<ArmedOrder>();
  const [feedback, setFeedback] = useState(() => view.notices.at(-1)?.text ?? '');
  const [contactId, setContactId] = useState<string>();
  const [hoverId, setHoverId] = useState<string>();
  const [hoverFlightId, setHoverFlightId] = useState<string>();
  const [deckOpen, setDeckOpen] = useState<string>();
  useEffect(() => {
    if (!airOpen) setDeckOpen(undefined);
  }, [airOpen]);
  const map = useRef<SVGSVGElement>(null);
  const anchors = useRef<HTMLDivElement>(null);
  const nav = useRef(new AirMapNavigation());
  const drag = useRef<
    | {
        x: number;
        y: number;
        lastX: number;
        lastY: number;
        mode: 'pan' | 'orbit' | 'select';
        pointerId: number;
        additive: boolean;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number }>();
  const ignoreClick = useRef(false);
  const seenNotices = useRef(view.notices.length);
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [movePoint, setMovePoint] = useState<[number, number]>();
  const [pendingRoutes, setPendingRoutes] = useState<Record<string, PendingRoute>>({});
  useMapProjection(map, chart, mapOpen);
  useMapProjection(anchors, chart, mapOpen);
  const leadRoute = view.leadRoute(pendingRoutes);
  const moveOrigin = view.moveOrigin(shiftHeld, leadRoute);
  const selectedContact = view.enemies.find((c) => c.id === contactId);
  const selectedReport = observations.find((c) => c.id === contactId);
  const selectedStrike = selectedReport?.kind === 'aircraft' ? view.strikeOf(selectedReport.id) : undefined;
  const interceptor = selectedReport?.kind === 'aircraft' ? view.interceptorFor(reportPosition(selectedReport, tick)) : undefined;
  const current = useRef({ data, armed, filter, view, actionable, contactId, airOpen, instrumentsVisible });
  current.current = { data, armed, filter, view, actionable, contactId, airOpen, instrumentsVisible };
  /** A unit chosen from a list may be off the chart; bring it into view without touching zoom. */
  const reveal = (x: number, z: number) => {
    if (map.current && !chart.projectAirMap(x, z)) chart.centerAirMapOn(x, z);
  };
  const selectShips = (shipIds: string[]) => {
    setFilter('ships');
    issue({ kind: 'select-ships', ids: shipIds });
    issue({ kind: 'select-flights', ids: [] });
    setContactId(undefined);
    setArmed(undefined);
  };
  const selectShip = (id: string, additive: boolean) => {
    selectShips(additive ? (ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id]) : [id]);
    const ship = ships.find((s) => s.id === id);
    if (ship && !additive) reveal(ship.x, ship.z);
  };
  const selectFormation = (f: FleetFormation) => {
    selectShips(f.shipIds);
    const leader = ships.find((s) => s.id === f.leaderId);
    if (leader) reveal(leader.x, leader.z);
  };
  const selectAir = (id: string, additive = false) => {
    setFilter('aircraft');
    issue({ kind: 'select-flight', id, additive });
    issue({ kind: 'select-ships', ids: [] });
    setContactId(undefined);
    setArmed(undefined);
    const flight = flights.find((f) => f.id === id);
    if (flight && !additive) reveal(flight.position[0], flight.position[2]);
  };
  const issueAir = (target: SquadronTarget) => {
    const held = current.current;
    if (held.armed === 'search') {
      setFeedback('Choose water for the center of the search area.');
      return;
    }
    const { note, sent } = sendAirOrder(held.view, issue, typeof held.armed === 'object' ? held.armed : undefined, target);
    setFeedback(note);
    if (sent) setArmed(undefined);
  };
  const escort = (leaderId: string) => {
    setFeedback(sendEscort(view, issue, leaderId));
    setArmed(undefined);
  };
  const chooseFormation = (next: Formation) => {
    if (selectedGroup && actionable) setArmed(undefined);
    setFeedback(setGroupFormation(view, desk, next));
  };
  const move = (point: [number, number], appendRequested: boolean) => {
    const { note, pending } = sendRoute(view, issue, point, speedKn, appendRequested, leadRoute);
    if (!lead) {
      setFeedback(note);
      return;
    }
    if (pending) setPendingRoutes((routes) => ({ ...routes, [lead.id]: pending }));
    if (recipients.length > 1) setArmed(undefined);
    // One destination is one order: the chart hands the selection back so the next
    // click is a fresh choice. Shift keeps the ships in hand to extend the route.
    setShiftHeld(appendRequested);
    if (appendRequested) {
      setArmed('move');
      setMovePoint(point);
    } else {
      setMovePoint(undefined);
      selectShips([]);
    }
    setFeedback(note);
  };
  /** Leave the move flow without ordering anything, and hand back the selection with it. */
  const cancelMove = () => {
    setMovePoint(undefined);
    selectShips([]);
  };
  const hold = () => {
    setFeedback(sendHold(view, issue));
    setArmed(undefined);
  };
  const autonomous = () => {
    setFeedback(sendAutonomous(view, issue));
    setArmed(undefined);
  };
  const apply = (gesture: ShipGesture) => {
    if (gesture.act === 'feedback') setFeedback(gesture.text);
    else if (gesture.act === 'air') issueAir(gesture.target);
    else if (gesture.act === 'escort') escort(gesture.leaderId);
    else if (gesture.act === 'select-ship') selectShip(gesture.id, gesture.additive);
    else if (gesture.act === 'focus') {
      setFeedback(sendFocus(view, issue, gesture.targetId));
      setArmed(undefined);
    } else {
      selectShips([]);
      setContactId(gesture.id);
      if (gesture.target) issue({ kind: 'select-target', id: gesture.id });
    }
  };
  const targetShip = (ship: Pick<Contact, 'id' | 'team'>, right: boolean, additive: boolean) =>
    apply(shipGesture(current.current.view, ship, { right, additive, armed }));
  const selectReport = (report: ContactTrack, right = false) => apply(reportGesture(current.current.view, report, { right, armed }));
  const issueSearch = (point: [number, number]) => {
    const { note, sent } = sendSearch(view, issue, point, search);
    setFeedback(note);
    if (sent) setArmed(undefined);
  };
  const water = (event: { clientX: number; clientY: number; shiftKey: boolean }, right: boolean) => {
    const rect = map.current?.getBoundingClientRect();
    if (!rect || !actionable || !instrumentsVisible) return;
    const point = chart.airMapWater(event.clientX - rect.left, event.clientY - rect.top);
    if (!point) return;
    const kind = typeof armed === 'object' ? 'squadron' : armed === 'move' || armed === 'search' ? armed : armed ? 'other' : undefined;
    const action = fleetWaterAction(kind, { right, shift: event.shiftKey, flights: selectedFlights.length > 0, lead: !!lead });
    if (action === 'search') issueSearch(point);
    else if (action === 'air') issueAir({ kind: 'water', point: [point[0], 0, point[1]] });
    else if (action === 'cancel-move') cancelMove();
    else if (action === 'move') move(point, event.shiftKey);
    else if (action === 'clear') {
      selectShips([]);
      issue({ kind: 'select-flights', ids: [] });
    }
  };
  const arm = (order: ArmedOrder) => {
    if (!mapOpen) issue({ kind: 'fleet-command' });
    setArmed(order);
    setFeedback('');
    if (previewArmed(order)) setMovePoint(pointer.current ? chart.airMapWater(pointer.current.x, pointer.current.y) : undefined);
    if (order === 'search') map.current?.focus();
  };
  const adjustSpeed = (direction: number) =>
    setSpeedKn((v) => SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(v) + direction))]);
  const cycleFormation = () =>
    chooseFormation(FORMATIONS[(FORMATIONS.findIndex((f) => f.id === (selectedGroup?.formation ?? 'column')) + 1) % FORMATIONS.length].id);
  const airAction = (key: string) => {
    const held = current.current;
    if (!held.view.selectedFlights.length || !held.actionable) return;
    if (key === 'R') {
      setFeedback(sendReturn(held.view, issue));
      return;
    }
    if (key === 'S') {
      if (boundary) arm('search');
      return;
    }
    const action = SQUADRON_ACTIONS.find((a) => a.key === key);
    if (action && held.view.airReady(action)) arm(action);
  };
  const shipAction = (key: string) => {
    const chosen = current.current.view.selected;
    const helmChart = !!current.current.data.helmChart;
    if (key === 'V') {
      if (chosen[0] && !helmChart) issue({ kind: 'follow-ship', id: chosen[0].id });
      return;
    }
    if (key === 'T') {
      if (chosen[0] && current.current.actionable && !(helmChart && chosen[0].id === current.current.data.controlledShipId))
        issue({ kind: 'take-fleet-helm', id: chosen[0].id });
      return;
    }
    if (!chosen.length || !current.current.actionable) return;
    if (key === 'A') {
      if (helmChart) autonomous();
      return;
    }
    if (key === 'G') arm('move');
    else if (key === 'H') hold();
    else if (key === 'E') arm('escort');
    else if (key === 'F') arm('focus');
    else if (key === 'C') cycleFormation();
  };
  // Esc closes what is open, innermost first; the battle menu is the last resort.
  const escape = () => {
    if (armed) setArmed(undefined);
    else if (deckOpen) setDeckOpen(undefined);
    else if (contactId) {
      setContactId(undefined);
      issue({ kind: 'select-target', id: '' });
    } else if (airOpen) setAirOpen(false);
    else if (selected.length || selectedFlights.length) selectShips([]);
    else issue({ kind: 'menu' });
  };
  /** With the flight line up the digit keys pick air groups in line order, as the boxes are numbered. */
  const selectFlightAt = (index: number) => {
    const flight = flights[index];
    if (flight) selectAir(flight.id);
  };
  const handlers = useRef({ airAction, shipAction, adjustSpeed, selectFormation, selectFlightAt, formations, escape });
  handlers.current = { airAction, shipAction, adjustSpeed, selectFormation, selectFlightAt, formations, escape };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') setShiftHeld(true);
      if (document.querySelector('dialog[open]') || event.altKey || isDeveloperConsoleKey(event)) return;
      const element = event.target as HTMLElement;
      if (
        element?.matches('input, textarea, select') ||
        element?.closest('[role=combobox], [role=listbox]') ||
        element?.isContentEditable ||
        (element?.closest('button, [role=button]') && event.code === 'Space')
      )
        return;
      const held = current.current;
      const showing = held.instrumentsVisible;
      const digit = showing && /^Digit[1-9]$/.test(event.code) ? Number(event.code.at(-1)) : 0;
      const mapActive = !!held.data.airOperationsOpen;
      const toggle = bindings.airOperations.includes(event.code);
      const plain = !event.ctrlKey && !event.metaKey;
      const letter = plain && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : '';
      const speed =
        showing && plain && ['Equal', 'NumpadAdd'].includes(event.code)
          ? 1
          : showing && plain && ['Minus', 'NumpadSubtract'].includes(event.code)
            ? -1
            : 0;
      const angle = mapActive && event.shiftKey && /^Arrow/.test(event.code);
      if (angle)
        chart.orbitAirMap(
          event.code === 'ArrowLeft' ? -12 : event.code === 'ArrowRight' ? 12 : 0,
          event.code === 'ArrowUp' ? 12 : event.code === 'ArrowDown' ? -12 : 0,
        );
      const pan = !angle && mapActive && plain && /^Arrow/.test(event.code) && nav.current.key(event.code, true);
      const shipKey =
        showing &&
        ['G', 'H', 'E', 'F', 'C', 'V', 'T', ...(held.data.helmChart ? ['A'] : [])].includes(letter) &&
        held.view.selected.length > 0 &&
        !held.view.selectedFlights.length;
      const airKey = showing && ['L', 'A', 'D', 'I', 'E', 'R', 'S'].includes(letter) && held.view.selectedFlights.length > 0;
      const handled =
        toggle ||
        event.code === 'Space' ||
        (showing && !mapActive && letter === 'T' && !!held.data.spectatedShipId) ||
        (mapActive && (digit || pan || angle || event.code === 'Escape' || shipKey || airKey || speed));
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (toggle) {
        if (mapActive) issue({ kind: 'follow-ship', id: desk.selectedShipIds[0] ?? desk.frame.ship.id });
        else issue({ kind: 'fleet-command' });
      } else if (event.code === 'Space') issue({ kind: 'tactical-pause' });
      else if (showing && !mapActive && letter === 'T') {
        if (held.data.spectatedShipId && held.actionable) issue({ kind: 'take-fleet-helm', id: held.data.spectatedShipId });
      } else if (digit && held.airOpen) handlers.current.selectFlightAt(digit - 1);
      else if (digit) {
        const f = handlers.current.formations.find((f) => f.index === digit);
        if (f) handlers.current.selectFormation(f);
      } else if (event.code === 'Escape') {
        if (showing) handlers.current.escape();
        else issue({ kind: 'menu' });
      } else if (speed) handlers.current.adjustSpeed(speed);
      else if (airKey) handlers.current.airAction(letter);
      else if (shipKey) handlers.current.shipAction(letter);
    };
    const keyup = (event: KeyboardEvent) => {
      setShiftHeld(event.shiftKey);
      nav.current.key(event.code, false);
    };
    const clear = () => {
      setShiftHeld(false);
      nav.current.clear();
      drag.current = undefined;
      setBox(undefined);
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
      nav.current.clear();
    };
  }, [desk, bindings]);
  useEffect(() => {
    if (!mapOpen) {
      setShiftHeld(false);
      nav.current.clear();
      drag.current = undefined;
      setBox(undefined);
      setArmed(undefined);
      setHoverId(undefined);
      return;
    }
    let previous = performance.now(),
      frame = 0;
    const animate = (now: number) => {
      const dt = (now - previous) / 1000;
      previous = now;
      const rect = map.current?.getBoundingClientRect();
      if (rect && !drag.current && !document.querySelector('dialog[open]')) {
        const [dx, dy] = nav.current.step(dt, rect.width, rect.height);
        if (dx || dy) chart.panAirMap(dx, dy);
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [mapOpen, chart]);
  useEffect(() => {
    if (!mapOpen) return;
    // Camera frames include keyboard, wheel, fit and reset navigation, even when
    // the pointer is stationary. Preview and click use the same water projection.
    return chart.onCameraFrame(() => {
      if (!pointer.current) return;
      const point = chart.airMapWater(pointer.current.x, pointer.current.y);
      setCoveragePoint((previous) => (previous?.[0] === point?.[0] && previous?.[1] === point?.[1] ? previous : point));
      if (!previewArmed(current.current.armed)) return;
      setMovePoint((previous) => (previous?.[0] === point?.[0] && previous?.[1] === point?.[1] ? previous : point));
    });
  }, [chart, mapOpen]);
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      // SVG handles in-chart releases first; this catches short gestures released
      // over a panel before they acquired pointer capture.
      drag.current = undefined;
      setBox(undefined);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);
  useEffect(() => {
    if (!instrumentsVisible) {
      nav.current.clear();
      drag.current = undefined;
      setBox(undefined);
      setArmed(undefined);
    }
  }, [instrumentsVisible]);
  const startDrag = (event: ReactPointerEvent<Element>) => {
    if (event.button === 2) return;
    // The middle button turns the camera; a plain left drag pans the water.
    const mode = fleetDragMode(
      event.button,
      event.shiftKey,
      event.ctrlKey || event.metaKey || event.altKey,
      !!armed || !instrumentsVisible,
    );
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      mode,
      pointerId: event.pointerId,
      additive: event.ctrlKey || event.metaKey,
      moved: false,
    };
  };
  const dragMap = (event: ReactPointerEvent<SVGSVGElement>) => {
    setShiftHeld(event.shiftKey);
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setCoveragePoint(chart.airMapWater(pointer.current.x, pointer.current.y));
    if (previewArmed(armed)) setMovePoint(chart.airMapWater(pointer.current.x, pointer.current.y));
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    if (!event.buttons) {
      drag.current = undefined;
      setBox(undefined);
      return;
    }
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) > 5) {
      d.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (d.moved && d.mode === 'pan') chart.panAirMap(event.clientX - d.lastX, event.clientY - d.lastY);
    else if (d.moved && d.mode === 'orbit') chart.orbitAirMap(event.clientX - d.lastX, event.clientY - d.lastY);
    else if (d.moved && !armed)
      setBox({
        x: Math.min(d.x, event.clientX) - rect.left,
        y: Math.min(d.y, event.clientY) - rect.top,
        width: Math.abs(event.clientX - d.x),
        height: Math.abs(event.clientY - d.y),
      });
    d.lastX = event.clientX;
    d.lastY = event.clientY;
  };
  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    setBox(undefined);
    if (!d?.moved) return;
    ignoreClick.current = event.button === 0;
    if (d.mode !== 'select' || armed || !instrumentsVisible) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inside = (x: number, y: number) =>
      x + rect.left >= Math.min(d.x, event.clientX) &&
      x + rect.left <= Math.max(d.x, event.clientX) &&
      y + rect.top >= Math.min(d.y, event.clientY) &&
      y + rect.top <= Math.max(d.y, event.clientY);
    const scaleX = rect.width / event.currentTarget.clientWidth,
      scaleY = rect.height / event.currentTarget.clientHeight;
    const selection = boxSelect(
      view,
      filter,
      (position) => {
        const p = chart.projectAirMap(position[0], position[2], position[1]);
        return !!p && inside(p[0] * scaleX, p[1] * scaleY);
      },
      d.additive ? { shipIds: desk.selectedShipIds, flightIds: desk.selectedFlightIds } : undefined,
    );
    if (selection.kind === 'ships') selectShips(selection.ids);
    else {
      issue({ kind: 'select-flights', ids: selection.ids });
      issue({ kind: 'select-ships', ids: [] });
      setFilter('aircraft');
      setContactId(undefined);
      setArmed(undefined);
    }
  };
  useEffect(() => {
    setPendingRoutes((routes) => advancePendingRoutes(routes, view));
  }, [desk, data]);
  useEffect(() => {
    const notice = nextNotice(view, seenNotices.current);
    seenNotices.current = notice.seen;
    if (notice.text !== undefined) setFeedback(notice.text);
  }, [desk, data]);
  const weaponsRow = recipients.length > 0 && (
    <div className="fleet-command-weapons" role="group" aria-label="Weapons policy">
      {WEAPONS.map((kind) => {
        const free = view.weaponsFree(kind);
        return (
          <button key={kind} disabled={!actionable} aria-pressed={free} onClick={() => toggleWeapons(view, issue, kind)}>
            <i />
            {weaponLabel[kind]} {free ? 'free' : 'held'}
          </button>
        );
      })}
    </div>
  );

  if (!mapOpen) {
    const helm = !!subject && data.controlledShipId === subject.id;
    return (
      <div className={`fleet-command ${helm ? 'fleet-command-helm-mode' : 'fleet-command-follow'}`}>
        <section className="fleet-command-panel" aria-label={helm ? 'Fleet helm controls' : 'Following ship'}>
          <h2>
            {helm ? 'At the helm' : 'Following'} <span>{subject?.name}</span>
            <small>{helm ? 'You steer' : 'Captain in command'}</small>
          </h2>
          {subject && <p>{view.standingOrderOf(subject.id)}</p>}
          <div className="fleet-command-panel-actions">
            <SimulationSpeed desk={desk} data={data} bindings={bindings} />
            {helm ? (
              <button onClick={() => issue({ kind: 'follow-ship', id: data.controlledShipId! })}>Give back helm</button>
            ) : (
              <button
                disabled={!actionable || !subject || subject.physicalLost}
                onClick={() => subject && issue({ kind: 'take-fleet-helm', id: subject.id })}
              >
                Take helm <kbd>T</kbd>
              </button>
            )}
            <button onClick={() => issue({ kind: 'fleet-command' })}>
              <Icon name="compass" size={14} />
              Fleet command <kbd>M</kbd>
            </button>
          </div>
          {!helm && weaponsRow}
          {feedback && (
            <p className="fleet-command-feedback" role="status">
              {feedback}
            </p>
          )}
        </section>
        {data.tacticalPaused && (
          <p className="fleet-command-paused" role="status">
            Tactical pause · Both fleets stopped · {desk.frame.queuedOrderCount ?? 0} orders queued for resume
          </p>
        )}
      </div>
    );
  }

  const origin = view.origin;
  /** The map's bearing: contact bearings read true. */
  const chartBearing = oceanMap(data.mapId ?? DEFAULT_MAP).bearing;
  const lineOpen = airOpen && wings.length > 0;
  /** The hull the player still steers while reading the chart from the helm. */
  const ownHelm = visiting && !combat.playerSunk ? ships.find((s) => s.id === data.controlledShipId && !s.physicalLost) : undefined;
  const ownShips = ownHelm
    ? view.ownShips.map((s) =>
        s.id === ownHelm.id
          ? {
              ...s,
              you: true,
              order: orders[s.id]?.movement.type === 'autonomous' || !orders[s.id] ? 'Your helm' : `Your helm · ${s.order}`,
            }
          : s,
      )
    : view.ownShips;
  const wheelItems: WheelItem[] = [
    { kind: 'move', label: 'Move', sub: armed === 'move' ? 'G · armed' : 'G', armed: armed === 'move', disabled: !actionable },
    { kind: 'hold', label: 'Hold', sub: 'H', disabled: !actionable },
    { kind: 'escort', label: 'Escort', sub: 'E', armed: armed === 'escort', disabled: !actionable },
    { kind: 'focus', label: 'Focus fire', sub: 'F', armed: armed === 'focus', disabled: !actionable },
    // Only a custom battle's captains fight on their own, so only there is handing a ship back an order.
    ...(visiting ? [{ kind: 'auto', label: 'Auto', sub: 'A', disabled: !actionable }] : []),
    { kind: 'speed', label: `${speedKn} kn`, sub: '+ / −' },
  ];
  /** How the selected group sails. One group at a time: the stations are a table for
   * the whole body, so a partial selection has nothing coherent to re-station. */
  const formationPicker = (
    <div className="fleet-command-formations" role="group" aria-label="Formation">
      <span>
        Formation<kbd>C</kbd>
      </span>
      <div>
        {FORMATIONS.map((entry) => (
          <button
            key={entry.id}
            title={selectedGroup ? entry.hint : FORMATION_HINT}
            disabled={!actionable || !selectedGroup}
            aria-pressed={!!selectedGroup && selectedGroup.formation === entry.id}
            onClick={() => chooseFormation(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {!selectedGroup && <small>{FORMATION_HINT}</small>}
    </div>
  );
  const armedHint =
    typeof armed === 'object'
      ? `Choose ${armed.target}`
      : armed === 'search'
        ? 'Choose the area center on water, or pan with arrow keys and press Enter at chart center'
        : armed === 'move'
          ? 'Choose water · Shift adds a waypoint · Right-click cancels'
          : armed === 'escort'
            ? 'Choose a friendly leader'
            : armed === 'focus'
              ? 'Choose an enemy contact'
              : '';
  // Near the right edge the wheel opens to port of the unit instead of running under it.
  const flipAt = (x: number, z: number) => {
    if (!map.current) return '';
    const point = chart.projectAirMap(x, z);
    return point
      ? `${point[0] > map.current.clientWidth - 560 ? 'flip' : ''} ${point[1] > map.current.clientHeight - 420 ? 'flip-up' : ''}`
      : '';
  };
  const chip = (name: string) => (
    <div className="fleet-command-wheel-chip">
      <strong>{name}</strong>
      <span>{armedHint}</span>
      <button onClick={() => setArmed(undefined)}>
        Cancel<kbd>Esc</kbd>
      </button>
    </div>
  );
  const onWheel = (kind: string, shift: boolean) => {
    if (kind === 'move') arm('move');
    else if (kind === 'hold') hold();
    else if (kind === 'auto') autonomous();
    else if (kind === 'escort') arm('escort');
    else if (kind === 'focus') arm('focus');
    else if (kind === 'speed') adjustSpeed(shift ? -1 : 1);
  };
  const airItems: WheelItem[] = [
    ...SQUADRON_ACTIONS.filter((a) => selectedFlights.some((f) => actionAvailable(a, f.role))).map((a) => ({
      kind: a.kind,
      label: a.label,
      sub: typeof armed === 'object' && armed.kind === a.kind ? `${a.key} · armed` : a.key,
      armed: typeof armed === 'object' && armed.kind === a.kind,
      disabled: !actionable || !view.airReady(a),
    })),
    { kind: 'return', label: 'Return', sub: 'R', disabled: !actionable || !selectedFlights.some((f) => f.active) },
    ...(boundary
      ? [
          {
            kind: 'search',
            label: 'Search',
            sub: armed === 'search' ? 'S · armed' : 'S',
            armed: armed === 'search',
            disabled: !actionable || !view.searchReady(search.policy),
          },
        ]
      : []),
  ];
  const onAirWheel = (kind: string) => {
    if (kind === 'return') airAction('R');
    else if (kind === 'search') arm('search');
    else {
      const action = SQUADRON_ACTIONS.find((a) => a.kind === kind);
      if (action) arm(action);
    }
  };
  const flightCentroid = view.flightCentroid;
  const planesOf = view.planesOf;
  const service = (groups: readonly { id: string }[], action: Parameters<typeof sendDeckService>[2]) => {
    const note = sendDeckService(issue, groups, action);
    setArmed(undefined);
    setFeedback(note);
  };
  const selectedTrackCluster =
    selectedReport?.kind === 'aircraft' ? clusters.find((c) => c.trackIds.includes(selectedReport.id)) : undefined;

  const chartInteraction: SVGProps<SVGSVGElement> = {
    onKeyDown: (e) => {
      if (instrumentsVisible && armed === 'search' && e.key === 'Enter') {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        water({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, shiftKey: false }, false);
      }
    },
    onMouseDown: (e) => {
      if (e.button === 1) e.preventDefault();
    },
    onAuxClick: (e) => e.preventDefault(),
    onPointerDown: startDrag,
    onPointerMove: dragMap,
    onPointerUp: endDrag,
    onPointerCancel: () => {
      drag.current = undefined;
      setBox(undefined);
    },
    onClick: (e) => {
      if (ignoreClick.current) {
        ignoreClick.current = false;
        return;
      }
      water(e, false);
    },
    onContextMenu: (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return;
      water(e, true);
    },
    onWheel: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      chart.zoomAirMap(e.deltaY, e.clientX - r.left, e.clientY - r.top);
    },
  };
  // H hides instruments, not the surface receiving map camera gestures.
  if (!instrumentsVisible)
    return (
      <div className="fleet-command fleet-command-map">
        <svg ref={map} className="fleet-command-chart" tabIndex={0} aria-label="Fleet command chart" {...chartInteraction} />
      </div>
    );

  return (
    <div
      onClickCapture={(e) => {
        if (armed !== 'move' || !(e.target as Element).closest('.fleet-command-chart, .air-squadron-labels')) return;
        e.stopPropagation();
        if (ignoreClick.current) {
          ignoreClick.current = false;
          return;
        }
        water(e, false);
      }}
      className={`fleet-command fleet-command-map${lineOpen ? ' air-open' : ''}`}
    >
      <svg
        ref={map}
        className="fleet-command-chart"
        tabIndex={0}
        aria-label="Fleet command chart"
        data-armed={armed ? true : undefined}
        {...chartInteraction}
      >
        <defs>
          <marker id="fleet-command-intent-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4 0 8Z" />
          </marker>
          <marker
            id="fleet-command-intent-arrow-selected"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
          >
            <path d="M0 0L8 4 0 8Z" />
          </marker>
        </defs>
        {armed === 'search' && (
          <svg x="50%" y="50%" width="1" height="1" overflow="visible" className="fleet-command-search-center" aria-hidden="true">
            <path d="M-12 0H12M0-12V12" />
          </svg>
        )}
        <ReconnaissanceCoverage coverage={desk.frame.reconCoverage} tick={tick} />
        {boundary && (
          <path
            className="fleet-command-boundary"
            data-map-path={JSON.stringify(circlePoints(0, 0, boundary.radiusM))}
            data-closed="true"
          />
        )}
        {boundary && (
          <path
            className="fleet-command-boundary-warning"
            data-map-path={JSON.stringify(circlePoints(0, 0, boundary.radiusM - boundary.warningMarginM))}
            data-closed="true"
          />
        )}
        {formations.map((f) => {
          const bracket = view.bracketOf(f);
          if (!bracket) return null;
          const { members, points, all } = bracket;
          return (
            <g key={`formation-${f.index}`} className={`fleet-command-bracket ${all ? 'selected' : ''}`}>
              {members.length > 1 && <path data-map-smooth="true" data-map-path={JSON.stringify(points)} data-closed="true" />}
              <g
                className="fleet-command-bracket-label"
                data-map-position={JSON.stringify(members.length > 1 ? points[0] : [members[0].x, 0, members[0].z])}
                role="button"
                tabIndex={0}
                aria-label={`Select ${f.name} · ${f.index}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectFormation(f);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    selectFormation(f);
                  }
                }}
              >
                <rect
                  className="fleet-command-bracket-key"
                  x={members.length > 1 ? 0 : -30}
                  y={members.length > 1 ? -24 : -32}
                  width="16"
                  height="16"
                  rx="2"
                />
                <text className="fleet-command-bracket-index" x={members.length > 1 ? 8 : -22} y={members.length > 1 ? -12 : -20}>
                  {f.index}
                </text>
                {members.length > 1 && (
                  <text className="fleet-command-bracket-name" x="22" y="-12">
                    {f.name} · {members.length} ships
                  </text>
                )}
              </g>
            </g>
          );
        })}
        {observations
          .filter((c) => c.kind === 'surface' && c.id === contactId && !c.visibleCondition?.sinking)
          .map((c) => (
            <path
              key={`area-${c.id}`}
              className={`fleet-command-uncertainty ${c.status}`}
              data-map-path={JSON.stringify(circlePoints(c.estimatedPosition[0], c.estimatedPosition[2], c.uncertaintyM))}
              data-closed="true"
            />
          ))}
        {flights
          .filter((f) => f.active || f.airborne > 0)
          .map((f) => {
            const on = desk.selectedFlightIds.includes(f.id),
              carrier = ships.find((s) => s.id === f.ownerId);
            const from: Vec3 = f.airborne > 0 ? f.position : carrier ? [carrier.x, 0, carrier.z] : f.position;
            const patrol = f.order.kind === 'patrol',
              searchArea = f.order.kind === 'search-area' ? f.order : undefined;
            const { path, station, contactId: destinationContact } = fleetAirCourse(f, from, observations, tick);
            return (
              <g
                key={`air-${f.id}`}
                className={`fleet-command-air-course ${on ? 'selected' : ''} ${f.airborne === 0 ? 'planned' : ''}`}
                aria-label={`${f.name} course`}
              >
                {path.length > 1 && (
                  <path className="fleet-command-air-route" data-map-smooth="true" data-map-path={JSON.stringify(path)} />
                )}
                {destinationContact && (
                  <g
                    className="fleet-command-air-target"
                    data-contact-marker={destinationContact}
                    data-map-position={JSON.stringify(station)}
                  >
                    <circle r="7" />
                    <path d="M-11 0H11M0-11V11" />
                  </g>
                )}
                {patrol && (
                  <>
                    <path
                      className="fleet-command-loiter"
                      data-map-path={JSON.stringify(circlePoints(station[0], station[2], LOITER_RADIUS_M))}
                      data-closed="true"
                    />
                    <g className="fleet-command-air-target" data-map-position={JSON.stringify(station)}>
                      <circle r="7" />
                      <path d="M-11 0H11M0-11V11" />
                    </g>
                  </>
                )}
                {searchArea && (
                  <path
                    className="fleet-command-search-area"
                    data-map-path={JSON.stringify(circlePoints(searchArea.center[0], searchArea.center[1], searchArea.radiusM))}
                    data-closed="true"
                  />
                )}
              </g>
            );
          })}
        {selectedFlights.flatMap(
          (f) =>
            f.search?.trail.slice(1).flatMap((sample, i) => {
              const age = (tick - sample.tick) / 60;
              return age <= 90
                ? [
                    <path
                      key={`trail-${f.id}-${sample.tick}`}
                      className="fleet-command-search-trail"
                      opacity={Math.max(0.15, 1 - age / 90)}
                      data-map-path={JSON.stringify([f.search!.trail[i].position, sample.position])}
                    />,
                  ]
                : [];
            }) ?? [],
        )}
        {view.afloat.map((s) => {
          const { points, waypoints, blocked, movement, escortLink } = view.courseOf(s, pendingRoutes[s.id]);
          if (escortLink && hoverId !== s.id) return null;
          return (
            <g
              key={`route-${s.id}`}
              data-route-owner={s.id}
              aria-label={`${s.name} ${blocked ? 'route blocked · Reassign destination' : 'course'}`}
              className={`fleet-command-course ${blocked ? 'blocked' : ''} ${ids.includes(s.id) || hoverId === s.id ? 'selected' : ''}`}
            >
              <path
                className={
                  movement?.type === 'escort'
                    ? 'fleet-command-escort-link'
                    : movement?.type === 'hold-area'
                      ? 'fleet-command-hold-ring'
                      : 'fleet-command-route'
                }
                data-map-smooth="true"
                data-map-path={JSON.stringify(points)}
              />
              {movement?.type === 'escort' && points.length > 1 && (
                <g
                  className="fleet-command-escort-station"
                  data-map-position={JSON.stringify(points[1])}
                  aria-label={`${s.name} escort station`}
                >
                  <circle r="5" />
                  <text x="8" y="14">
                    station
                  </text>
                </g>
              )}
              {waypoints.map((point, i) => (
                <g
                  key={i}
                  className="fleet-command-waypoint"
                  data-map-position={JSON.stringify(point)}
                  aria-label={`${s.name} waypoint ${i + 1}`}
                >
                  <circle r="8" />
                  <path d="M-12 0H12M0-12V12" />
                  <text x="12" y="-10">
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
        {armed === 'move' && movePoint && recipients.length > 0 && (
          <g className="fleet-command-move-preview" aria-label="Move preview">
            <path data-map-path={JSON.stringify([moveOrigin, [movePoint[0], 0, movePoint[1]]])} />
            <g data-map-position={JSON.stringify([movePoint[0], 0, movePoint[1]])}>
              <circle r="9" />
              <path d="M-14 0H14M0-14V14" />
              <text x="16" y="-8">
                {speedKn} kn · Shift adds a waypoint
              </text>
            </g>
          </g>
        )}
        {previewArmed(armed) && armed !== 'move' && movePoint && selectedFlights.length > 0 && (
          <g className="fleet-command-move-preview air" aria-label="Air order preview">
            {selectedFlights.map((f) => (
              <path key={f.id} data-map-path={JSON.stringify([f.position, [movePoint[0], 0, movePoint[1]]])} />
            ))}
            {armed === 'search' && (
              <path data-map-path={JSON.stringify(circlePoints(movePoint[0], movePoint[1], search.radiusM))} data-closed="true" />
            )}
            {armed !== 'search' && (
              <path data-map-path={JSON.stringify(circlePoints(movePoint[0], movePoint[1], LOITER_RADIUS_M))} data-closed="true" />
            )}
            <g data-map-position={JSON.stringify([movePoint[0], 0, movePoint[1]])}>
              <circle r="9" />
              <path d="M-14 0H14M0-14V14" />
              <text x="16" y="-8">
                {armed === 'search' ? `Search · ${search.radiusM / 1000} km` : 'Loiter here'}
              </text>
            </g>
          </g>
        )}
        {combat.contacts
          .filter((c) => !c.physicalLost)
          .map((s) => {
            const { own, status, warn, kn, side, label, hp, definition, glyph } = view.markerOf(s);
            return (
              <g
                key={s.id}
                data-map-position={JSON.stringify([s.x, 0, s.z])}
                data-ship-marker={s.id}
                data-map-fade={`${definition.hull.length},${s.heading}`}
                className={`fleet-command-marker ${s.team} ${ids.includes(s.id) || s.id === contactId ? 'selected' : ''} ${hoverId === s.id ? 'hovered' : ''} ${warn ? 'warn' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${nameFor(s.id) === 'assigned leader' ? s.name : nameFor(s.id)} · ${s.team}${own && status === 'blocked' ? ' · Route blocked · Reassign destination' : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    targetShip(s, false, e.shiftKey);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ignoreClick.current) {
                    ignoreClick.current = false;
                    return;
                  }
                  targetShip(s, false, e.shiftKey || e.ctrlKey || e.metaKey);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return;
                  targetShip(s, true, false);
                }}
              >
                <circle r="18" className="fleet-command-hitbox" />
                {hoverId === s.id && <circle r="22" className="fleet-command-hover-ring" />}
                <g data-map-glyph="true" data-map-heading={s.heading}>
                  <path className="fleet-command-hull" d={glyph.hull} />
                  <path className="fleet-command-mark" d={glyph.mark} />
                </g>
                {own && status === 'blocked' && (
                  <g className="fleet-command-route-alert" transform={`translate(${side === 'port' ? -130 : 14} 23)`}>
                    <title>Route blocked · Reassign destination</title>
                    <Icon name="warning" size={14} />
                    <text x="18" y="11">
                      Route blocked
                    </text>
                  </g>
                )}
                <text x={label.x} y={label.y} textAnchor={label.anchor}>
                  {own ? nameFor(s.id) : s.name}
                </text>
                {own && (
                  <>
                    <rect className="fleet-command-hull-track" x={label.barX} y={label.barY} width="40" height="3" />
                    <rect
                      className="fleet-command-hull-fill"
                      x={side === 'port' ? -14 - 40 * hp : label.barX}
                      y={label.barY}
                      width={40 * hp}
                      height="3"
                    />
                    <text className="fleet-command-marker-order" x={label.x} y={label.orderY} textAnchor={label.anchor}>
                      {Math.round(s.integrity * 100)}% · {kn} kn
                      {status === 'straggling'
                        ? ' · straggling'
                        : status === 'evading-aircraft' || status === 'evading-torpedo'
                          ? ' · evading'
                          : ''}
                    </text>
                    <InboundBadge
                      strikes={threats.filter((t) => t.intent.shipId === s.id)}
                      x={side === 'above' ? -20 : label.barX}
                      y={side === 'above' ? 30 : label.orderY + 14}
                    />
                  </>
                )}
                {!own && (
                  <text className="fleet-command-marker-order" x="14" y="11">
                    {s.status === 'operational' ? 'contact' : s.status.replaceAll('-', ' ')}
                  </text>
                )}
              </g>
            );
          })}
        {observations
          .filter((c) => c.kind === 'surface')
          .map((c) => {
            const glyph =
                SHIP_GLYPHS[c.identifiedPresetId ? shipClassOf(resolveShip(c.identifiedPresetId)) : shipClassFromReport(c.classification)],
              [rvx, , rvz] = c.velocity,
              heading = Math.atan2(rvx, -rvz);
            return (
              <g
                key={c.id}
                data-map-position={JSON.stringify(reportPosition(c, tick))}
                data-contact-marker={c.id}
                data-contact-kind="surface"
                data-map-fade={`${c.identifiedPresetId ? resolveShip(c.identifiedPresetId).hull.length : 180},${heading}`}
                data-report-state={reportState(c, tick)}
                className={`fleet-command-marker ${c.affiliation === 'hostile' ? 'enemy' : 'unidentified'} report ${c.status} ${contactId === c.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${reportName(c)} · ${c.status} · observed ${reportAge(c, tick)} · uncertainty ${reportUncertainty(c)}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    selectReport(c);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ignoreClick.current) {
                    ignoreClick.current = false;
                    return;
                  }
                  selectReport(c);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return;
                  selectReport(c, true);
                }}
              >
                <title>{`${reportName(c)} · ${reportState(c, tick).replaceAll('-', ' ')} · ${reportAge(c, tick)}`}</title>
                <circle r="18" className="fleet-command-hitbox" />
                <g data-map-glyph="true" data-map-heading={heading}>
                  <path className="fleet-command-hull" d={glyph.hull} />
                  <path className="fleet-command-mark" d={glyph.mark} />
                </g>
                <text x="16" y="-3">
                  {reportName(c)}
                </text>
                <text className="fleet-command-marker-order" x="16" y="11">
                  {c.affiliation === 'unknown'
                    ? 'affiliation unknown'
                    : reportState(c, tick) === 'current'
                      ? c.visibleCondition?.sinking ||
                        c.visibleCondition?.fire ||
                        c.visibleCondition?.heavySmoke ||
                        c.visibleCondition?.listing
                        ? conditionReport(c, tick).split(' · ')[0].toLowerCase()
                        : ''
                      : `${reportState(c, tick).replaceAll('-', ' ')} · ${reportAge(c, tick)}`}
                </text>
                {healthMarker(c, 16, 18)}
              </g>
            );
          })}
        {threats.map((t) => {
          const ship = ships.find((s) => s.id === t.intent.shipId);
          if (!ship) return null;
          const dx = ship.x - t.cluster.position[0],
            dz = ship.z - t.cluster.position[2],
            range = Math.hypot(dx, dz),
            short = Math.min(range * 0.5, 150);
          return (
            <path
              key={`intent-${t.cluster.id}`}
              className={`fleet-command-intent ${t.cluster.trackIds.includes(contactId ?? '') ? 'selected' : ''}`}
              data-intent-target={ship.id}
              aria-hidden="true"
              data-map-path={JSON.stringify([t.cluster.position, [ship.x - (dx / range) * short, 0, ship.z - (dz / range) * short]])}
              markerEnd={`url(#fleet-command-intent-arrow${t.cluster.trackIds.includes(contactId ?? '') ? '-selected' : ''})`}
            />
          );
        })}
        {ownPlanes.map((p) => {
          const flight = flights.find((f) => f.id === p.flightId),
            on = !!flight && desk.selectedFlightIds.includes(flight.id),
            unarmed = p.role === 'fighter' ? p.ammo <= 0 : !p.payload;
          return (
            <g
              key={p.id}
              data-map-position={JSON.stringify(p.position)}
              data-plane={p.id}
              data-map-fade={`13,${p.heading},6,14`}
              className={`fleet-command-plane friendly ${on ? 'selected' : ''} ${p.hp < 50 ? 'hurt' : ''} ${unarmed ? 'unarmed' : ''} ${hoverFlightId && hoverFlightId === p.flightId ? 'hovered' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (ignoreClick.current) {
                  ignoreClick.current = false;
                  return;
                }
                if (flight) selectAir(flight.id, e.shiftKey || e.ctrlKey || e.metaKey);
              }}
            >
              <circle r="8" className="fleet-command-hitbox" />
              <g data-map-glyph="true" data-map-heading={p.heading}>
                <path d={PLANE_GLYPHS[p.role]} transform="scale(.9)" />
                <OrdnanceMark role={p.role} carrying={p.payload} />
              </g>
              {p.role === 'fighter' && <AmmoBelt bursts={p.ammo} />}
              {hoverFlightId && hoverFlightId === p.flightId && (
                <text
                  className={`fleet-command-plane-tag ${(p.role === 'fighter' && p.ammo <= 0) || (p.role !== 'fighter' && !p.payload) ? 'spent' : p.role === 'fighter' && p.ammo <= 4 ? 'low' : ''}`}
                  x="13"
                  y="-11"
                >
                  {(flight?.aircraftIds.indexOf(p.id) ?? -1) + 1 || '·'} ·{' '}
                  {p.role === 'fighter'
                    ? p.ammo > 0
                      ? `${p.ammo} bursts`
                      : 'guns empty'
                    : p.payload
                      ? p.role === 'dive-bomber'
                        ? 'bomb'
                        : 'torpedo'
                      : 'released'}
                </text>
              )}
              <PlaneHealth hp={p.hp / 100} name={flight?.name ?? 'Aircraft'} />
            </g>
          );
        })}
        {observations
          .filter((c) => c.kind === 'aircraft')
          .map((c) => {
            const position = reportPosition(c, tick),
              [vx, , vz] = c.velocity,
              damaged = c.visibleCondition?.fire || c.visibleCondition?.heavySmoke,
              type = reportedAircraftType(c, observedModels).type,
              load = view.payloadOf(c);
            return (
              <g
                key={c.id}
                data-map-position={JSON.stringify(position)}
                data-track={c.id}
                data-contact-kind="aircraft"
                data-map-fade={`13,${Math.atan2(vx, -vz)},6,14`}
                data-report-state={reportState(c, tick)}
                className={`fleet-command-plane ${c.affiliation === 'hostile' ? 'enemy' : 'unidentified'} ${c.status} ${contactId === c.id ? 'selected' : ''} ${load === false ? 'unarmed' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${reportName(c)} · ${c.status} · observed ${reportAge(c, tick)}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    selectReport(c);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (ignoreClick.current) {
                    ignoreClick.current = false;
                    return;
                  }
                  selectReport(c);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return;
                  selectReport(c, true);
                }}
              >
                <title>{`${reportName(c)} · ${reportState(c, tick).replaceAll('-', ' ')} · ${reportAge(c, tick)}`}</title>
                <circle r="8" className="fleet-command-hitbox" />
                <g data-map-glyph="true" data-map-heading={Math.atan2(vx, -vz)}>
                  <path d={PLANE_GLYPHS[type]} transform="scale(.9)" />
                  <OrdnanceMark role={type} carrying={load} />
                  {damaged && <path className="fleet-command-smoke" d="M0 6q-3 6 -1 12" />}
                </g>
                <PlaneHealth hp={view.healthOf(c)} name={reportName(c)} />
              </g>
            );
          })}
        {clusters.map((cluster) => (
          <g
            key={cluster.id}
            data-contact-group={JSON.stringify(cluster.trackIds)}
            data-map-position={JSON.stringify(cluster.position)}
            className={`fleet-command-cluster ${cluster.stale ? 'stale' : ''} ${cluster.trackIds.includes(contactId ?? '') ? 'selected' : ''}`}
            aria-hidden="true"
          >
            <text x="20" y="-2">
              {cluster.label}
              {cluster.model ? ` · ${cluster.model}` : ''}
            </text>
            <text className="fleet-command-marker-order" x="20" y="11">
              {cluster.stale
                ? `last known · ${observationAge(cluster.lastObservedTick, tick)}`
                : (({ strike }) =>
                    [
                      strike && loadLabel(strike),
                      strike?.intent && `for ${strike.intent.name}`,
                      cluster.smoking && `${cluster.smoking} smoking`,
                    ]
                      .filter(Boolean)
                      .join(' · '))({ strike: strikes.find((s) => s.cluster.id === cluster.id) })}
            </text>
          </g>
        ))}
      </svg>
      <div ref={anchors} className="fleet-command-anchors">
        {lead && !selectedFlights.length && (
          <div className={`fleet-command-wheel-anchor ${flipAt(lead.x, lead.z)}`} data-map-position={JSON.stringify([lead.x, 0, lead.z])}>
            {armed ? (
              chip(recipients.length > 1 ? `${recipients.length} ships` : lead.name)
            ) : (
              <div className="fleet-command-wheel-block">
                <div className="fleet-command-wheel-title">
                  <strong>{recipients.length > 1 ? `${recipients.length} ships` : lead.name}</strong>
                  <small>
                    {recipients.length > 1
                      ? recipients.map((s) => s.name).join(' · ')
                      : `${Math.round(lead.integrity * 100)}% · ${view.speedKnOf(lead.id)} kn · ${view.standingOrderOf(lead.id)}`}
                  </small>
                </div>
                <div className="fleet-command-wheel-row">
                  <OrderWheel items={wheelItems} hull={lead.integrity} onSelect={onWheel} label="Order wheel" />
                  <div className="fleet-command-wheel-actions">
                    {!visiting && (
                      <button onClick={() => issue({ kind: 'follow-ship', id: lead.id })}>
                        <Icon name="camera" size={13} />
                        Follow<kbd>V</kbd>
                      </button>
                    )}
                    {!(visiting && lead.id === data.controlledShipId) && (
                      <button disabled={!actionable} onClick={() => issue({ kind: 'take-fleet-helm', id: lead.id })}>
                        Take helm<kbd>T</kbd>
                      </button>
                    )}
                  </div>
                </div>
                {formationPicker}
                {weaponsRow}
              </div>
            )}
          </div>
        )}
        {view.stragglerTags.map(
          ({ leader, straggler, ship }) =>
            ship && (
              <div
                key={`straggler-${straggler.shipId}`}
                className="fleet-command-straggler"
                data-map-position={JSON.stringify([ship.x, 0, ship.z])}
                role="group"
                aria-label={`${ship.name} straggling`}
              >
                <span>
                  {ship.name} straggling · {(straggler.availableSpeedMps * KNOTS_PER_MPS).toFixed(0)} kn available ·{' '}
                  {(straggler.gapM / 1000).toFixed(1)} km from station
                </span>
                {(['slow-for-stragglers', 'leave-stragglers'] as const).map((policy) => (
                  <button
                    key={policy}
                    disabled={!actionable}
                    aria-pressed={orders[leader.id]?.formationPolicy === policy}
                    onClick={() => {
                      issue({ kind: 'formation-policy', shipId: leader.id, policy });
                      setFeedback(`${leader.name} · Formation policy queued`);
                    }}
                  >
                    {policy === 'slow-for-stragglers' ? 'Slow for stragglers' : 'Leave behind'}
                  </button>
                ))}
              </div>
            ),
        )}
        {selectedFlights.length > 0 && flightCentroid && (
          <div
            className={`fleet-command-wheel-anchor ${flipAt(flightCentroid[0], flightCentroid[2])}`}
            data-map-position={JSON.stringify(flightCentroid)}
          >
            {armed ? (
              chip(selectedFlights.length === 1 ? selectedFlights[0].name : `${selectedFlights.length} air groups`)
            ) : (
              <div className="fleet-command-wheel-block air">
                <div className="fleet-command-wheel-title">
                  <strong>{selectedFlights.length === 1 ? selectedFlights[0].name : `${selectedFlights.length} air groups`}</strong>
                  <small>
                    {selectedFlights.reduce((n, f) => n + f.surviving, 0)}/{selectedFlights.reduce((n, f) => n + f.total, 0)} ·{' '}
                    {selectedFlights.reduce((n, f) => n + f.armed, 0)} armed ·{' '}
                    {selectedFlights.length === 1
                      ? selectedFlights[0].active
                        ? mission(selectedFlights[0])
                        : selectedFlights[0].activity
                      : [...new Set(selectedFlights.map((f) => f.carrierName))].join(', ')}
                    {selectedFlights[0].enduranceSeconds !== null && selectedFlights.length === 1
                      ? ` · ${duration(selectedFlights[0].enduranceSeconds)}`
                      : ''}
                  </small>
                </div>
                <div className="fleet-command-wheel-row">
                  <OrderWheel
                    items={airItems}
                    hull={selectedFlights.reduce((n, f) => n + f.hp, 0) / selectedFlights.length / 100}
                    hubLabel={String(selectedFlights.reduce((n, f) => n + f.surviving, 0))}
                    onSelect={onAirWheel}
                    label="Air order wheel"
                  />
                  <div className="fleet-command-wheel-actions">
                    <button
                      onClick={() => {
                        setAirOpen(true);
                        setFilter('aircraft');
                      }}
                    >
                      Deck
                      <Icon name="chevron" size={12} style={{ transform: 'rotate(-90deg)' }} />
                    </button>
                    <button
                      onClick={() =>
                        issue({ kind: 'follow-aircraft', id: planesOf(selectedFlights[0]).find((p) => airborne(p))?.id ?? '' })
                      }
                      disabled={!planesOf(selectedFlights[0]).some((p) => airborne(p))}
                    >
                      <Icon name="camera" size={13} />
                      Follow lead
                    </button>
                  </div>
                </div>
                {!lineOpen && (
                  <div className="fleet-command-planes">
                    {selectedFlights.map((f) => (
                      <div
                        key={f.id}
                        className="fleet-command-plane-row"
                        onMouseEnter={() => setHoverFlightId(f.id)}
                        onMouseLeave={() => setHoverFlightId(undefined)}
                      >
                        <b>{f.name}</b>
                        <span className="fleet-command-plane-bars">
                          {planesOf(f).map((p) => (
                            <i
                              key={p.id}
                              className={p.hp <= 0 || ['lost', 'withdrawn'].includes(p.phase) ? 'lost' : p.hp < 50 ? 'hurt' : ''}
                              style={{ ['--hp' as string]: `${Math.max(0, Math.min(100, p.hp))}%` }}
                              title={`${p.id.split('/').at(-1)} · ${Math.ceil(p.hp)}% · ${p.lossReason ?? p.phase}${p.role === 'fighter' ? (p.ammo > 0 ? ' · armed' : ' · no ammunition') : p.payload ? ' · armed' : ' · no payload'}`}
                            />
                          ))}
                        </span>
                        <span>
                          {f.surviving}/{f.total}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {boundary && !lineOpen && (
                  <div className="fleet-command-buttons fleet-command-search">
                    <label>
                      Radius
                      <Select value={search.radiusM} onValueChange={(v) => setSearch((s) => ({ ...s, radiusM: Number(v) }))}>
                        {[2000, 4000, 6000].map((v) => (
                          <SelectOption key={v} value={v}>
                            {v / 1000} km
                          </SelectOption>
                        ))}
                      </Select>
                    </label>
                    <label>
                      Altitude
                      <Select value={search.altitude} onValueChange={(v) => setSearch((s) => ({ ...s, altitude: v as SearchAltitude }))}>
                        <SelectOption value="low">Low · 200 m</SelectOption>
                        <SelectOption value="medium">Medium · 850 m</SelectOption>
                        <SelectOption value="high">High · 1,500 m</SelectOption>
                      </Select>
                    </label>
                    <label>
                      On contact
                      <Select value={search.policy} onValueChange={(v) => setSearch((s) => ({ ...s, policy: v as SearchPolicy }))}>
                        <SelectOption value="report">Report only</SelectOption>
                        <SelectOption value="shadow">Shadow and report</SelectOption>
                        <SelectOption value="strike">Search and strike</SelectOption>
                      </Select>
                    </label>
                  </div>
                )}
                {!lineOpen && <AirGroupService flights={selectedFlights} enabled={actionable} command={service} />}
                {selectedFlights.some((f) => f.notice) && (
                  <p className="fleet-command-notice" role="status">
                    {selectedFlights
                      .filter((f) => f.notice)
                      .map((f) => `${f.name} · ${f.notice}`)
                      .join(' / ')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {selectedContact && (
          <div
            className="fleet-command-popover-anchor"
            {...(selectedReport
              ? { 'data-map-position': JSON.stringify(reportPosition(selectedReport, tick)), 'data-contact-marker': selectedReport.id }
              : { 'data-map-position': JSON.stringify([selectedContact.x, 0, selectedContact.z]) })}
          >
            <section className="fleet-command-popover" aria-label="Contact report">
              <strong>{selectedTrackCluster ? selectedTrackCluster.label : selectedContact.name}</strong>
              {selectedReport ? (
                <p>
                  {selectedReport.affiliation === 'hostile' ? 'Hostile' : 'Affiliation unknown'} ·{' '}
                  {reportState(selectedReport, tick).replaceAll('-', ' ')} ·{' '}
                  {bearingLabel(selectedContact.x - origin.x, selectedContact.z - origin.z, chartBearing)} ·{' '}
                  {rangeLabel(selectedContact.x - origin.x, selectedContact.z - origin.z)}
                  {selectedReport.visibleCondition?.sinking ? '' : ` · ±${reportUncertainty(selectedReport)}`}
                </p>
              ) : (
                <p>
                  Hostile · {bearingLabel(selectedContact.x - origin.x, selectedContact.z - origin.z, chartBearing)} ·{' '}
                  {rangeLabel(selectedContact.x - origin.x, selectedContact.z - origin.z)}
                </p>
              )}
              {selectedReport && (
                <p>
                  Reported by{' '}
                  {selectedReport.sources
                    .map((source) => ships.find((s) => s.id === source.observerId)?.name ?? 'Friendly aircraft')
                    .filter((name, i, names) => names.indexOf(name) === i)
                    .join(', ') || 'Fleet lookouts'}
                  , observed {reportAge(selectedReport, tick)}.{' '}
                  {selectedReport.kind === 'surface'
                    ? conditionReport(selectedReport, tick).split(' · ')[0]
                    : 'Heading and speed are estimates from your observers.'}
                </p>
              )}
              {selectedReport && view.healthOf(selectedReport) !== undefined && (
                <p>{Math.round(view.healthOf(selectedReport)! * 100)}% HP remaining</p>
              )}
              {selectedStrike && (
                <p className="fleet-command-strike">
                  {[
                    `${selectedStrike.cluster.count} seen`,
                    loadLabel(selectedStrike),
                    selectedStrike.intent
                      ? `heading for ${selectedStrike.intent.name} · ${rangeLabel(selectedStrike.intent.rangeM, 0)} · release in ${duration(selectedStrike.intent.releaseSeconds)}`
                      : selectedStrike.cluster.type !== 'fighter' &&
                        !selectedStrike.cluster.stale &&
                        !!loadLabel(selectedStrike) &&
                        'no own ship on its course',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <p className="fleet-command-popover-hint">
                {selectedReport?.visibleCondition?.sinking
                  ? 'Loss confirmed by an observer. This report is no longer a target.'
                  : selectedReport?.status === 'stale'
                    ? 'Search the reported area to reacquire this contact.'
                    : selectedReport?.kind === 'aircraft'
                      ? 'Select a fighter group and Intercept to engage.'
                      : 'Right-click with ships selected to focus fire, or with bombers selected to strike.'}
              </p>
              <div className="fleet-command-buttons">
                {selectedReport?.kind === 'aircraft' && interceptor && (
                  <button
                    disabled={!actionable || selectedReport.status === 'stale'}
                    onClick={() => {
                      if (issue({ kind: 'squadron', flightId: interceptor.id, order: { kind: 'intercept', flightId: selectedReport.id } }))
                        setFeedback(`${interceptor.name} · Intercept order queued`);
                      else setFeedback(`${interceptor.name} is not available to intercept.`);
                    }}
                  >
                    <Icon name="aircraft" size={13} />
                    Intercept · {interceptor.name}
                  </button>
                )}
                <button
                  disabled={!actionable || (!selectedFlights.length && !flights.some((f) => f.role !== 'fighter' || true))}
                  onClick={() => {
                    if (!current.current.view.selectedFlights.length) {
                      setFeedback('Select air groups first, then search here.');
                      return;
                    }
                    arm('search');
                  }}
                >
                  <Icon name="target" size={13} />
                  Search here<kbd>S</kbd>
                </button>
                <button
                  onClick={() => {
                    setContactId(undefined);
                    issue({ kind: 'select-target', id: '' });
                  }}
                >
                  Close<kbd>Esc</kbd>
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
      <div className="fleet-command-recon">
        <ReconnaissanceLegend coverage={desk.frame.reconCoverage} />
        {desk.frame.reconCoverage && (
          <span>
            {coverageTick === undefined ? 'Point at water for search age' : `Here: observed ${observationAge(coverageTick, tick)}`}
          </span>
        )}
      </div>
      {box && <div className="fleet-command-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}
      <SquadronLabels
        data={data}
        desk={desk}
        onPointerDown={(e) => {
          if (e.button === 0 && e.shiftKey && !armed) {
            startDrag(e);
            map.current?.setPointerCapture(e.pointerId);
            e.preventDefault();
          }
        }}
        onSelect={(id, additive) => {
          if (ignoreClick.current) {
            ignoreClick.current = false;
            return;
          }
          selectAir(id, additive);
        }}
        onTarget={(id, team) => {
          if (armed === 'search') {
            setFeedback('Choose water for the center of the search area.');
            return true;
          }
          if (typeof armed !== 'object') return false;
          issueAir({ kind: 'squadron', id, team });
          return true;
        }}
        onOrder={(id, team) => issueAir({ kind: 'squadron', id, team })}
      />
      <header className="fleet-command-top">
        <div>
          {(visiting || combat.objective) && combat.remainingSeconds !== null ? (
            <time aria-label="Time remaining">
              {duration(combat.remainingSeconds)}
              <small>{deadlineCaption(combat)}</small>
            </time>
          ) : (
            <time>{duration(tick / 60)}</time>
          )}
          <ObjectiveReadout combat={combat} />
          <SimulationSpeed desk={desk} data={data} bindings={bindings} />
        </div>
        <nav aria-label="Fleet views">
          <button
            aria-pressed={filter === 'ships'}
            onClick={() => {
              setFilter('ships');
              setAirOpen(false);
              issue({ kind: 'select-flights', ids: [] });
              setArmed(undefined);
            }}
          >
            <Icon name="ship" size={14} />
            Ships
          </button>
          {wings.length > 0 && (
            <button
              aria-pressed={filter === 'aircraft'}
              aria-expanded={airOpen}
              onClick={() => {
                setFilter('aircraft');
                setAirOpen(!airOpen);
              }}
            >
              <Icon name="aircraft" size={14} />
              Aircraft
            </button>
          )}
          <button onClick={() => chart.fitAirMap()} title="Fit reported fleet">
            <Icon name="expand" size={14} />
            Fit
          </button>
          <button onClick={() => chart.resetAirMapAngle()} title="Reset camera angle">
            <Icon name="compass" size={14} />
            North up
          </button>
          {!desk.frame.networked && (
            <button onClick={() => issue({ kind: 'tactical-pause' })} aria-pressed={data.tacticalPaused}>
              <Icon name={data.tacticalPaused ? 'play' : 'pause'} size={14} />
              {data.tacticalPaused ? 'Resume' : 'Pause'} <kbd>Space</kbd>
            </button>
          )}
          <button onClick={() => issue({ kind: 'menu' })} aria-label="Battle menu">
            <Icon name="settings" size={16} />
          </button>
          {visiting && (
            <button className="fleet-command-return" onClick={() => issue({ kind: 'follow-ship', id: desk.frame.ship.id })}>
              {combat.playerSunk ? 'Leave chart' : 'Return to helm'} <kbd>{bindingLabel(bindings, 'airOperations')}</kbd>
            </button>
          )}
        </nav>
      </header>
      <OwnFleetCard
        flat={visiting}
        formations={formations}
        ships={ownShips}
        selectedIds={ids}
        hoverId={hoverId}
        onHover={setHoverId}
        onSelectShip={selectShip}
        onSelectFormation={selectFormation}
        airOpen={airOpen}
        {...(wings.length > 0
          ? {
              aircraft: view.ownWing,
              onOpenAir: () => {
                setAirOpen(true);
                setFilter('aircraft');
              },
            }
          : {})}
      />
      {visiting ? (
        <EnemyRoster
          ships={combat.contacts
            .filter((c) => c.team === 'enemy')
            .map((c) => ({
              id: c.id,
              name: c.name,
              shipId: c.shipId,
              x: c.x,
              z: c.z,
              integrity: c.integrity,
              status: c.status,
              lost: c.physicalLost,
              engagedBy: Object.values(orders).filter((o) => o?.targetId === c.id).length,
            }))}
          origin={origin}
          chartBearing={chartBearing}
          selectedId={contactId}
          onSelect={(id) => targetShip({ id, team: 'enemy' }, false, false)}
          comparison={view.comparison}
          tonnageAfloatKg={combat.afloatKg[1]}
        />
      ) : (
        <EnemyFleet
          tracks={observations}
          clusters={clusters}
          strikes={strikes}
          tick={tick}
          origin={origin}
          chartBearing={chartBearing}
          selectedId={contactId}
          onSelect={selectReport}
          nameOf={reportName}
          comparison={view.comparison}
        />
      )}
      {data.tacticalPaused && (
        <p className="fleet-command-paused" role="status">
          Tactical pause · Both fleets stopped · {desk.frame.queuedOrderCount ?? 0} orders queued for resume
        </p>
      )}
      {ownHelm && !lineOpen && (
        <p className="fleet-command-own-helm" aria-label="Your ship">
          <strong>{ownHelm.name}</strong>
          <b>
            {Math.abs(data.ship.speed * KNOTS_PER_MPS).toFixed(1)}
            <small> kts</small>
          </b>
          <span>
            {ENGINE_LABELS[data.order]} ·{' '}
            {!data.rudderOrder
              ? 'rudder amidships'
              : `${Math.abs(data.rudderOrder) === 1 ? 'full' : 'half'} ${data.rudderOrder < 0 ? 'port' : 'starboard'} rudder`}{' '}
            ·{' '}
            {orders[ownHelm.id]?.movement.type === 'autonomous' || !orders[ownHelm.id]
              ? 'holds your last orders while the chart is open'
              : `${view.standingOrderOf(ownHelm.id)} until you touch the helm`}
          </span>
        </p>
      )}
      <div className="fleet-command-ticker" role="status">
        {feedback && <p>{feedback}</p>}
        {view.receipts.map((r) => (
          <p key={r.sequence} data-state={r.state}>
            {ships.find((s) => s.id === r.shipId)?.name ?? r.shipId} · {r.command.replaceAll('-', ' ')} {r.state}
            {r.message ? ` · ${r.message}` : ''}
          </p>
        ))}
      </div>
      {lineOpen && (
        <FlightLine
          carriers={wings.map(({ owner, wing }) => ({
            id: owner.motion.id,
            name: nameFor(owner.motion.id),
            hull: ships.find((s) => s.id === owner.motion.id)?.integrity ?? 0,
            kn: Math.round(Math.abs((owner.motion.speed ?? 0) * KNOTS_PER_MPS)),
            order: view.standingOrderOf(owner.motion.id),
            wing,
          }))}
          flights={flights}
          planesOf={planesOf}
          selectedIds={desk.selectedFlightIds}
          hoverId={hoverFlightId}
          armed={typeof armed === 'object' ? armed.kind : armed === 'search' ? 'search' : undefined}
          actionable={actionable}
          hasBoundary={!!boundary}
          search={{
            radius: search.radiusM,
            altitude: search.altitude,
            policy: search.policy,
            setRadius: (radiusM) => setSearch((s) => ({ ...s, radiusM })),
            setAltitude: (altitude) => setSearch((s) => ({ ...s, altitude })),
            setPolicy: (policy) => setSearch((s) => ({ ...s, policy })),
          }}
          onHover={setHoverFlightId}
          onSelect={selectAir}
          onVerb={onAirWheel}
          onFollowLead={(f) => issue({ kind: 'follow-aircraft', id: planesOf(f).find((p) => airborne(p))?.id ?? '' })}
          canFollow={(f) => planesOf(f).some((p) => airborne(p))}
          onCentre={(f) => chart.centerAirMapOn(f.position[0], f.position[2])}
          onService={service}
          onDeckPolicy={(id, policy) => {
            if (issue({ kind: 'deck-policy', carrierId: id, policy })) setFeedback(`${nameFor(id)} · Deck policy order queued`);
          }}
          onPrioritize={(id, request) => {
            if (issue({ kind: 'deck-priority', carrierId: id, requestId: request }))
              setFeedback(`${nameFor(id)} · Next deck task requested`);
          }}
          onCancelTask={(id, request) => {
            if (issue({ kind: 'deck-cancel', carrierId: id, requestId: request })) setFeedback(`${nameFor(id)} · Deck cancellation queued`);
          }}
          deckOpen={deckOpen}
          onToggleDeck={setDeckOpen}
          onClose={() => setAirOpen(false)}
        />
      )}
    </div>
  );
}

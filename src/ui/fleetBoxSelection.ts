import type { Vec3 } from '../ships/blueprint';

interface Candidate { id: string; position: Vec3 }
/** Select a flight when any of its displayed planes is enclosed. The active tab
 * breaks ties only when the box contains both ships and aircraft. */
export function fleetBoxSelection(ships: readonly Candidate[], planes: readonly (Candidate & { flightId: string })[],
  preferred: 'ships' | 'aircraft', contains: (position: Vec3) => boolean): { kind: 'ships' | 'aircraft'; ids: string[] } {
  const shipIds = ships.filter(s => contains(s.position)).map(s => s.id);
  const flightIds = [...new Set(planes.filter(p => contains(p.position)).map(p => p.flightId))];
  const kind = flightIds.length && (!shipIds.length || preferred === 'aircraft') ? 'aircraft' : shipIds.length ? 'ships' : preferred;
  return { kind, ids: kind === 'aircraft' ? flightIds : shipIds };
}

export function fleetDragMode(button: number, shift: boolean, orbit: boolean, armed: boolean): 'select' | 'orbit' | 'pan' {
  return button === 0 && shift && !armed ? 'select' : button === 1 || orbit ? 'orbit' : 'pan';
}

export type FleetWaterAction = 'search' | 'air' | 'cancel-move' | 'move' | 'clear';
/** What a click on open water does on the fleet chart. A destination spends the
 * selection: a plain click sends the ships and hands them back, Shift keeps them in
 * hand to extend the route, and the right button leaves the move without ordering. */
export function fleetWaterAction(armed: 'move' | 'search' | 'squadron' | 'other' | undefined,
  o: { right: boolean; shift: boolean; flights: boolean; lead: boolean }): FleetWaterAction | undefined {
  if (o.flights && armed === 'search') return 'search';
  if (o.flights && (o.right || armed === 'squadron')) return 'air';
  if (armed === 'move') return o.right ? 'cancel-move' : 'move';
  if (o.right || (!armed && o.shift && o.lead && !o.flights)) return 'move';
  return armed ? undefined : 'clear';
}

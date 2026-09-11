import type { FlightSummary } from '../simulation/airTelemetry';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { Vec3 } from '../ships/blueprint';
import { reportPosition } from './reconReports';

/** Command-map lines show the assigned objective. Pilot approach/evade waypoints
 * are steering inputs, not replacement strike targets. */
export function fleetAirCourse(flight: FlightSummary, from: Vec3, reports: readonly ContactTrack[], tick: number) {
  const order = flight.order;
  const report = flight.status !== 'returning' && (order.kind === 'strike' || order.kind === 'intercept-contact')
    ? reports.find(c => c.id === order.contactId) : undefined;
  const station: Vec3 = report ? reportPosition(report, tick) : [flight.destination[0], 0, flight.destination[2]];
  const path: Vec3[] = report || order.kind === 'patrol' ? [from, station] : flight.route.length > 1 ? flight.route
    : flight.airborne === 0 && order.kind !== 'return' ? [from, station] : [];
  return { path, station, contactId: report?.id };
}

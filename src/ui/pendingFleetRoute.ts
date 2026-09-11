import type { OrderReceipt } from '../game/session/commandQueue';
import type { Vec3 } from '../ships/blueprint';

export interface PendingRoute {
  points: Vec3[];
  receipt: OrderReceipt;
  acceptedTick?: number;
}

/** An acknowledgement can precede its worker snapshot. Keep the queued path
 * through that interval, then let the next authoritative frame own the path. */
export function advancePendingRoute(route: PendingRoute, tick: number): PendingRoute | undefined {
  if (route.receipt.state === 'rejected' || route.receipt.state === 'superseded') return;
  if (route.receipt.state !== 'accepted') return route;
  if (route.acceptedTick === undefined) return { ...route, acceptedTick: tick };
  return tick > route.acceptedTick ? undefined : route;
}

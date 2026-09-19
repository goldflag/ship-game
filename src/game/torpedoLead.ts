import type { Vec3 } from '../ships/blueprint';
import type { FleetActor, ShipState } from './session/elements';
import { radians, wrapAngle } from './geometry';
import { torpedoIntercept } from './torpedoAim';
import { torpedoPreviewSectors, type TorpedoSector } from './TorpedoPreview';

/** A hull as the player currently knows it: enough to lead, nothing hidden. */
export interface LeadContact { id: string; position: Vec3; velocity: Vec3; lengthM?: number }
export interface TorpedoLead {
  contactId: string;
  /** Where the contact is now and where a torpedo launched now would meet it. */
  from: Vec3; point: Vec3; seconds: number;
  /** Signed turn of the sight onto the lead; positive is clockwise, to the right. */
  swing: number;
  onSolution: boolean;
}
export interface TorpedoAimState {
  sectors: TorpedoSector[];
  /** The launcher the sight readout describes: a ready one on course where possible. */
  solution?: { origin: Vec3; status: TorpedoSector['status']; distance: number; runSeconds: number; range: number };
  lead?: TorpedoLead;
}

const courseTo = (from: Vec3, to: Vec3) => Math.atan2(to[0] - from[0], from[2] - to[2]);
const MAX_SWING = radians(60);

/** The lead nearest the sight. A contact the torpedo cannot reach, or one far
 * off the sight, offers no lead rather than dragging the post across the view. */
export function torpedoLead(origin: Vec3, aim: Vec3, contacts: readonly LeadContact[], speedMps: number, rangeM: number): TorpedoLead | undefined {
  const course = courseTo(origin, aim);
  let best: TorpedoLead | undefined;
  for (const contact of contacts) {
    const point = torpedoIntercept(origin, contact.position, contact.velocity, speedMps);
    if (!point) continue;
    const distance = Math.hypot(point[0] - origin[0], point[2] - origin[2]);
    if (distance > rangeM) continue;
    const swing = wrapAngle(courseTo(origin, point) - course);
    if (Math.abs(swing) > MAX_SWING || (best && Math.abs(best.swing) <= Math.abs(swing))) continue;
    // A straight runner passes this far abeam of the meeting point.
    const miss = distance * Math.sin(Math.abs(swing));
    best = { contactId: contact.id, from: contact.position, point, seconds: distance / speedMps, swing, onSolution: miss <= Math.max(12, (contact.lengthM ?? 120) * .3) };
  }
  return best;
}

export function torpedoAimState(actor: FleetActor, pose: ShipState, aim: Vec3, contacts: readonly LeadContact[], weaponGroupId?: string): TorpedoAimState {
  const sectors = torpedoPreviewSectors(actor, aim, pose, weaponGroupId);
  const chosen = sectors.find(s => s.course && s.status === 'ready') ?? sectors.find(s => s.course) ?? sectors.find(s => !['disabled', 'empty'].includes(s.status));
  if (!chosen || !aim.every(Number.isFinite)) return { sectors };
  const distance = Math.hypot(aim[0] - chosen.origin[0], aim[2] - chosen.origin[2]);
  return {
    sectors,
    solution: { origin: chosen.origin, status: chosen.status, distance, runSeconds: distance / chosen.speed, range: chosen.range },
    lead: torpedoLead(chosen.origin, aim, contacts, chosen.speed, chosen.range),
  };
}

export const runClock = (seconds: number) => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;

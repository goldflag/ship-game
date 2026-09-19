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
  /** Course and run from the launcher to the meeting point. */
  course: number; distance: number;
  /** Every course that meets the hull, as signed turns from `course` to her two ends. */
  window: [number, number];
  onSolution: boolean;
}
export interface TorpedoAimState {
  sectors: TorpedoSector[];
  /** The launcher the sight readout describes: a ready one on course where possible. */
  solution?: { origin: Vec3; status: TorpedoSector['status']; distance: number; runSeconds: number; range: number; speed: number; reload: number };
  lead?: TorpedoLead;
  /** Why the contact under the sight offers no lead. */
  unreachable?: 'beyond-run' | 'inside-arming';
}

const courseTo = (from: Vec3, to: Vec3) => Math.atan2(to[0] - from[0], from[2] - to[2]);
const MAX_SWING = radians(60);

const NEAR_SIGHT = radians(15);
/** How much of the hull counts: a torpedo crossing the last tenth of her length is a coin toss. */
const HULL_SHARE = .9;

function leadWindow(origin: Vec3, contact: LeadContact, course: number, distance: number, speedMps: number): [number, number] {
  const length = contact.lengthM ?? 120, speed = Math.hypot(contact.velocity[0], contact.velocity[2]);
  const least = Math.atan2(Math.max(12, length * .1), distance);
  // A contact with no way on shows no heading: allow for her lying across the course.
  if (speed < .5) { const half = Math.max(least, Math.atan2(length * .3, distance)); return [-half, half]; }
  const reach = length * HULL_SHARE / 2 / speed;
  const turns = [reach, -reach].map(along => {
    const end = torpedoIntercept(origin, [contact.position[0] + contact.velocity[0] * along, 0, contact.position[2] + contact.velocity[2] * along], contact.velocity, speedMps);
    return end ? wrapAngle(courseTo(origin, end) - course) : 0;
  });
  return [Math.min(...turns, -least), Math.max(...turns, least)];
}

/** The lead nearest the sight. A contact the torpedo cannot reach, or one far
 * off the sight, offers no lead rather than dragging the wedge across the view. */
export function torpedoLead(origin: Vec3, aim: Vec3, contacts: readonly LeadContact[], speedMps: number, rangeM: number, armingM = 0): TorpedoLead | undefined {
  return leadOrReason(origin, aim, contacts, speedMps, rangeM, armingM).lead;
}

function leadOrReason(origin: Vec3, aim: Vec3, contacts: readonly LeadContact[], speedMps: number, rangeM: number, armingM: number): Pick<TorpedoAimState, 'lead' | 'unreachable'> {
  const sight = courseTo(origin, aim);
  let best: TorpedoLead | undefined, unreachable: TorpedoAimState['unreachable'], nearest = NEAR_SIGHT;
  for (const contact of contacts) {
    const point = torpedoIntercept(origin, contact.position, contact.velocity, speedMps);
    if (!point) continue;
    const distance = Math.hypot(point[0] - origin[0], point[2] - origin[2]);
    const course = courseTo(origin, point), swing = wrapAngle(course - sight);
    if (distance > rangeM || distance < armingM) {
      if (Math.abs(swing) < nearest) { nearest = Math.abs(swing); unreachable = distance > rangeM ? 'beyond-run' : 'inside-arming'; }
      continue;
    }
    if (Math.abs(swing) > MAX_SWING || (best && Math.abs(best.swing) <= Math.abs(swing))) continue;
    const window = leadWindow(origin, contact, course, distance, speedMps);
    best = { contactId: contact.id, from: contact.position, point, seconds: distance / speedMps, swing, course, distance, window, onSolution: -swing >= window[0] && -swing <= window[1] };
  }
  return best ? { lead: best } : { unreachable };
}

export function torpedoAimState(actor: FleetActor, pose: ShipState, aim: Vec3, contacts: readonly LeadContact[], weaponGroupId?: string): TorpedoAimState {
  const sectors = torpedoPreviewSectors(actor, aim, pose, weaponGroupId);
  const chosen = sectors.find(s => s.course && s.status === 'ready') ?? sectors.find(s => s.course) ?? sectors.find(s => !['disabled', 'empty'].includes(s.status));
  if (!chosen || !aim.every(Number.isFinite)) return { sectors };
  const distance = Math.hypot(aim[0] - chosen.origin[0], aim[2] - chosen.origin[2]);
  return {
    sectors,
    solution: { origin: chosen.origin, status: chosen.status, distance, runSeconds: distance / chosen.speed, range: chosen.range, speed: chosen.speed, reload: chosen.reload },
    ...leadOrReason(chosen.origin, aim, contacts, chosen.speed, chosen.range, chosen.arming),
  };
}

export const runClock = (seconds: number) => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;

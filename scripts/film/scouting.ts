/** Reading the scout's log when cueing shots: when something first happened, and where things were. */
import type { EventKind } from '../../src/multiplayer/generated/EventKind';
import type { Scout, ScoutEvent, ScoutSample } from './types';

/** The battle second of the first `kind` event matching `where`, or undefined. */
export function first(scout: Scout, kind: EventKind, where: (event: ScoutEvent) => boolean = () => true): number | undefined {
  const event = scout.events.find(entry => entry.kind === kind && where(entry));
  return event && event.tick / 60;
}

/** The once-a-second sample nearest battle second `seconds`. */
export function sampleAt(scout: Scout, seconds: number): ScoutSample | undefined {
  return scout.samples.reduce<ScoutSample | undefined>((best, sample) =>
    !best || Math.abs(sample.tick / 60 - seconds) < Math.abs(best.tick / 60 - seconds) ? sample : best, undefined);
}

/** The first second at which an aircraft is in `phase`, or undefined. */
export function phaseFrom(scout: Scout, aircraftId: string, phase: string): number | undefined {
  const sample = scout.samples.find(entry => entry.aircraft.some(plane => plane.id === aircraftId && plane.phase === phase));
  return sample && sample.tick / 60;
}

/** `seconds` less a lead-in, never before the battle's first second. */
export const before = (seconds: number | undefined, lead: number) => seconds === undefined ? undefined : Math.max(1, seconds - lead);

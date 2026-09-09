import type { DeckServiceAction } from '../game/session/BattleSession';
import type { AirWingTelemetry, FlightSummary } from '../simulation/airTelemetry';
import { duration } from './airFormat';

const services: { action: DeckServiceAction; label: string; available: 'canRaise' | 'canStow' | 'canRearm' | 'canRepair'; hint: string }[] = [
  { action: 'raise', label: 'Bring up', available: 'canRaise', hint: 'Bring the group from the hangar when deck space is available' },
  { action: 'stow', label: 'Send below', available: 'canStow', hint: 'Send landed group members to the hangar; later arrivals follow' },
  { action: 'rearm', label: 'Rearm', available: 'canRearm', hint: 'Restock the group on deck; damage is retained' },
  { action: 'repair', label: 'Repair below', available: 'canRepair', hint: 'Send landed group members below for repair; later arrivals follow' },
];
const taskLabel = (action: string) => services.find(s => s.action === action)?.label ?? 'Launch';

export function AirGroupService({ flights, enabled, command }: {
  flights: FlightSummary[]; enabled: boolean; command: (flights: FlightSummary[], action: DeckServiceAction) => void;
}) {
  const managed = flights.filter(f => f.deck);
  if (!managed.length) return null;
  return <div className="fleet-command-service">
    <div className="fleet-command-buttons" aria-label="Selected air group service">{services.map(service => {
      const eligible = managed.filter(f => f.deck![service.available]);
      return <button key={service.action} disabled={!enabled || !eligible.length} title={service.hint}
        onClick={() => command(eligible, service.action)}>{service.label}{managed.length > 1 && ` (${eligible.length})`}</button>;
    })}</div>
    <p>{managed.reduce((n, f) => n + f.deck!.onDeck, 0)} on deck · {managed.reduce((n, f) => n + f.deck!.inHangar, 0)} in hangar · {managed.reduce((n, f) => n + f.airborne, 0)} airborne</p>
    {managed.filter(f => f.rearmSeconds > 0).map(f => <p key={f.id}>{f.name} · Current service {duration(f.rearmSeconds)} remaining</p>)}
    {[...new Set(managed.map(f => f.deck!.reason).filter(Boolean))].map(reason => <p key={reason}>{reason}</p>)}
  </div>;
}

export function CarrierDeck({ name, wing, enabled, cancel }: {
  name: string; wing: AirWingTelemetry; enabled: boolean; cancel: (id: number) => void;
}) {
  const deck = wing.deck;
  const current = wing.groups.find(f => f.aircraftIds.includes(deck?.currentPlaneId ?? ''));
  const waiting = deck?.queue.length ? deck.queue.every(r => r.action === 'raise') && deck.occupied >= deck.capacity
    ? 'Waiting for deck space' : 'Handling tasks queued' : 'Deck crew ready';
  return <article className="fleet-command-deck" aria-label={`${name} flight deck`}>
    <strong>{name}</strong>
    <p>Deck {wing.onDeck}/{wing.deckCapacity} · Hangar {wing.inHangar}</p>
    <p>Airborne {wing.groups.reduce((n, f) => n + f.airborne, 0)} · Recovering {wing.recoveryCount}</p>
    {deck && <>
      <p className="fleet-command-deck-task" data-suspended={deck.suspended || undefined}>{deck.suspended ? 'Deck operations suspended' : deck.task ?? waiting}{current && ` · ${current.name}`}</p>
      {deck.stepRemainingSeconds !== undefined && <p>Current aircraft · {duration(deck.stepRemainingSeconds)} remaining</p>}
      {wing.groups.filter(f => f.rearmSeconds > 0).map(f => <p key={f.id}>{f.name} · Service {duration(f.rearmSeconds)} remaining</p>)}
      {deck.notice && <p>{deck.notice}</p>}
      {deck.queue.length > 0 && <ol aria-label={`${name} handling queue`}>{deck.queue.map(request => {
        const flight = wing.groups.find(f => f.id === request.flightId);
        const label = `${taskLabel(request.action)} · ${flight?.name ?? 'Air group'}`;
        return <li key={request.id}><div><span>{label}</span>{request.automatic && <small>Automatic deck clearance</small>}</div>
          {!request.automatic && <button disabled={!enabled} aria-label={`Cancel ${label} on ${name}`} title="An aircraft already moving finishes at a safe position" onClick={() => cancel(request.id)}>Cancel</button>}
        </li>;
      })}</ol>}
    </>}
  </article>;
}

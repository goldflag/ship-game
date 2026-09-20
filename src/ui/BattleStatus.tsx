import { Button, Select, SelectOption } from './components';
import { useState, type ReactNode } from 'react';
import { Icon } from './Icons';
import type { FleetDesk } from './fleet/fleetDesk';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import type { CombatTelemetry } from '../game/session/telemetry';
import type { FleetOrderState } from '../multiplayer/generated/FleetOrderState';
import { resolveShip } from '../ships/localShips';
import { shipClassOf, type ShipClass } from './shipGlyphs';

type Contact = CombatTelemetry['contacts'][number];
export const contactLabel = (contact: Contact) =>
  contact.controller === 'player' && contact.team === 'friendly'
    ? `${contact.name} (You)`
    : `${contact.name} #${contact.id.split('-').at(-1)}`;
const lost = (contact: Contact) => contact.physicalLost;
const condition = (contact: Contact) => contact.status.replaceAll('-', ' ');
const damaged = (contact: Contact) => contact.integrity < 0.995 || contact.status !== 'operational';

/** Heaviest first, so the gauges and the roster read like an order of battle. */
const CLASSES: readonly { id: ShipClass; code: string; plural: string }[] = [
  { id: 'battleship', code: 'BB', plural: 'Battleships' },
  { id: 'carrier', code: 'CV', plural: 'Carriers' },
  { id: 'cruiser', code: 'CA', plural: 'Cruisers' },
  { id: 'destroyer', code: 'DD', plural: 'Destroyers' },
  { id: 'submarine', code: 'SS', plural: 'Submarines' },
  { id: 'auxiliary', code: 'AX', plural: 'Auxiliaries' },
];
/** A big fleet folds any class of more than this many hulls into one roster line. */
const FOLD_FLEET = 10,
  FOLD_CLASS = 4;
const classOf = (contact: Contact): ShipClass => {
  try {
    return shipClassOf(resolveShip(contact.shipId));
  } catch {
    return 'auxiliary';
  }
};
const byClass = (contacts: readonly Contact[]) =>
  CLASSES.map((entry) => ({ ...entry, ships: contacts.filter((c) => classOf(c) === entry.id) })).filter((group) => group.ships.length);
const tonnes = (kg: number) => `${Math.round(kg / 1000).toLocaleString()} t`;
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** What a captain is doing, in a word: the focus target first, then how the ship moves. */
function orderWord(order: FleetOrderState | undefined, nameOf: (id: string) => string | undefined): string {
  if (!order || order.manual) return '';
  const target = order.targetId && nameOf(order.targetId);
  if (target) return `Attack ${target}`;
  const task = order.movement;
  return task.type === 'autonomous'
    ? 'Auto'
    : task.type === 'hold'
      ? 'Stop'
      : task.type === 'hold-area'
        ? 'Hold'
        : task.type === 'escort'
          ? `Escort ${nameOf(task.leaderId) ?? ''}`.trim()
          : 'Move';
}

/** One gauge per hull: the fill is the hull left, a capital ship stands taller, a loss is hollow. */
function Gauges({ contacts }: { contacts: readonly Contact[] }) {
  return (
    <span className="fleet-tally-gauges" aria-hidden="true">
      {byClass(contacts).map((group) => (
        <span key={group.id}>
          {group.ships.map((ship) => (
            <i
              key={ship.id}
              className={`${group.id === 'battleship' || group.id === 'carrier' ? 'capital' : ''} ${lost(ship) ? 'lost' : ship.integrity < 0.5 ? 'low' : ''}`}
            >
              <b style={{ height: `${lost(ship) ? 0 : Math.round(Math.max(0, Math.min(1, ship.integrity)) * 100)}%` }} />
            </i>
          ))}
        </span>
      ))}
    </span>
  );
}

function Roster({
  team,
  combat,
  desk,
  open,
  onToggle,
}: {
  team: Contact['team'];
  combat: CombatTelemetry;
  desk: FleetDesk | null;
  open: ReadonlySet<string>;
  onToggle(key: string): void;
}) {
  const contacts = combat.contacts.filter((contact) => contact.team === team);
  const name = team === 'friendly' ? 'Friendly' : 'Enemy';
  const nameOf = (id: string) => {
    const contact = combat.contacts.find((c) => c.id === id);
    return contact && contact.name;
  };
  const row = (contact: Contact, code: string) => {
    const hull = Math.round(contact.integrity * 100),
      label = contactLabel(contact);
    const state = lost(contact)
      ? 'Lost'
      : contact.status !== 'operational'
        ? condition(contact)
        : team === 'friendly'
          ? orderWord(desk?.frame.fleetOrders?.[contact.id], nameOf)
          : '';
    const cells = (
      <>
        <span className="fleet-roster-class">{code}</span>
        <span className="fleet-roster-name">
          {label}
          {team === 'enemy' && combat.targetId === contact.id && <em>Target</em>}
        </span>
        <span className="fleet-roster-state">{state}</span>
        <span className="fleet-roster-bar">
          <i style={{ width: `${lost(contact) ? 0 : hull}%` }} />
        </span>
        <span className="fleet-roster-hull" aria-label={`${label} hull ${hull} percent`}>
          {hull}%
        </span>
      </>
    );
    return (
      <li key={contact.id} className={lost(contact) ? 'fleet-roster-lost' : ''}>
        {team === 'enemy' ? (
          <button
            className="fleet-roster-row"
            title={condition(contact)}
            aria-pressed={combat.targetId === contact.id}
            onClick={(event) => {
              desk?.issue({ kind: 'select-target', id: contact.id });
              event.currentTarget.blur();
            }}
          >
            {cells}
          </button>
        ) : (
          <div className="fleet-roster-row" title={condition(contact)}>
            {cells}
          </div>
        )}
      </li>
    );
  };
  return (
    <div className={`fleet-roster fleet-roster-${team}`} id={`fleet-roster-${team}`}>
      <h3>
        <span>{name}</span>
        <span>{team === 'enemy' ? 'click to designate' : 'order · hull'}</span>
      </h3>
      <ul aria-label={`${name} ships`}>
        {byClass(contacts).flatMap((group) => {
          const key = `${team}:${group.id}`;
          if (contacts.length <= FOLD_FLEET || group.ships.length <= FOLD_CLASS) return group.ships.map((ship) => row(ship, group.code));
          const afloat = group.ships.filter((ship) => !lost(ship)),
            hurt = afloat.filter(damaged).length;
          const mean = afloat.length ? Math.round((afloat.reduce((sum, ship) => sum + ship.integrity, 0) / afloat.length) * 100) : 0;
          return [
            <li key={key}>
              <button
                className="fleet-roster-row fleet-roster-fold"
                aria-expanded={open.has(key)}
                onClick={(event) => {
                  onToggle(key);
                  event.currentTarget.blur();
                }}
              >
                <span className="fleet-roster-class">{group.code}</span>
                <span className="fleet-roster-name">
                  {group.plural} {afloat.length}/{group.ships.length}
                </span>
                <span className="fleet-roster-state">
                  {hurt ? `${hurt} damaged` : 'all sound'} · {open.has(key) ? 'hide' : 'show'}
                </span>
                <span className="fleet-roster-bar">
                  <i style={{ width: `${mean}%` }} />
                </span>
                <span className="fleet-roster-hull">{mean}%</span>
              </button>
            </li>,
            ...(open.has(key) ? group.ships.map((ship) => row(ship, group.code)) : []),
          ];
        })}
      </ul>
    </div>
  );
}

function Side({ team, combat, desk }: { team: Contact['team']; combat: CombatTelemetry; desk: FleetDesk | null }) {
  const contacts = combat.contacts.filter((contact) => contact.team === team);
  const active = contacts.filter((contact) => !lost(contact));
  const name = team === 'friendly' ? 'Friendly' : 'Enemy';
  if (team === 'enemy' && combat.afloatKg[1] === null)
    return (
      <div className="fleet-tally-side fleet-tally-enemy fleet-tally-unknown">
        <span>
          Enemy strength <strong>Unknown</strong>
        </span>
        <small>
          {desk?.frame.observationTracks?.filter((c) => c.kind === 'surface').length ?? 0} surface reports · Search on the fleet map
        </small>
      </div>
    );
  return (
    <div
      className={`fleet-tally-side fleet-tally-${team}`}
      role="group"
      aria-label={`${name} fleet: ${active.length} of ${contacts.length} afloat, ${active.filter(damaged).length} damaged, ${contacts.length - active.length} lost`}
    >
      <span className="fleet-tally-count">
        <strong>{active.length}</strong>/{contacts.length}
      </span>
      <Gauges contacts={contacts} />
    </div>
  );
}

/** The battle at a glance: the clock, both fleets hull by hull and who holds the tonnage.
 * A free cursor (Ctrl, or before the sea is clicked) unfolds the roster; orders live on the fleet chart. */
export function BattleStatus({
  combat,
  desk,
  children,
  spectatedShipId,
  bindings,
  pointerLocked = false,
}: {
  combat: CombatTelemetry;
  desk: FleetDesk | null;
  children?: ReactNode;
  spectatedShipId?: string;
  bindings?: Keybindings;
  pointerLocked?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const teammates = combat.contacts.filter((contact) => contact.team === 'friendly' && contact.controller !== 'player' && !lost(contact));
  const [friendlyKg, enemyKg] = combat.afloatKg;
  const share = friendlyKg !== null && enemyKg !== null && friendlyKg + enemyKg > 0 ? friendlyKg / (friendlyKg + enemyKg) : undefined;
  const seconds = combat.remainingSeconds ?? (desk?.frame.tick ?? 0) / 60;
  const caption =
    combat.result === 'active'
      ? combat.remainingSeconds === null
        ? 'elapsed · no time limit'
        : 'remaining'
      : combat.outcome?.reason === 'time-limit'
        ? 'Time limit reached'
        : combat.outcome?.reason === 'forfeit'
          ? 'Battle forfeited'
          : combat.outcome?.reason === 'abandoned'
            ? 'Battle abandoned'
            : combat.outcome?.reason === 'infrastructure'
              ? 'Battle interrupted'
              : 'Fleet destroyed';
  return (
    <section className="fleet-battle" aria-label="Battle status">
      {combat.result !== 'active' && (
        <h2>
          {combat.outcome?.reason === 'infrastructure'
            ? 'Battle interrupted'
            : combat.outcome?.reason === 'abandoned'
              ? 'Battle abandoned'
              : combat.result === 'victory'
                ? 'Victory'
                : combat.result === 'defeat'
                  ? 'Defeat'
                  : 'Draw'}
        </h2>
      )}
      <div
        className="fleet-tally-clock"
        aria-label={`${combat.remainingSeconds === null ? 'Time elapsed' : 'Time remaining'} ${clock(seconds)}`}
      >
        <strong>{clock(seconds)}</strong>
        <span>{caption}</span>
      </div>
      <div className="fleet-tally-sides" aria-label="Team status">
        {(['friendly', 'enemy'] as const).map((team) => (
          <Side key={team} team={team} combat={combat} desk={desk} />
        ))}
      </div>
      {share !== undefined && (
        <div
          className="fleet-tally-balance"
          role="img"
          aria-label={`Tonnage afloat: friendly ${tonnes(friendlyKg!)}, enemy ${tonnes(enemyKg!)}`}
        >
          <i style={{ width: `${share * 100}%` }} />
          <b style={{ width: `${(1 - share) * 100}%` }} />
        </div>
      )}
      <p className="fleet-tally-tons">
        <span>{friendlyKg === null ? 'Unknown' : `${tonnes(friendlyKg)} afloat`}</span>
        <span>{enemyKg === null ? 'Unknown' : tonnes(enemyKg)}</span>
      </p>
      {(desk?.frame.networked || desk?.frame.connectionStatus || desk?.frame.phase === 'cancelled') && (
        <p className="fleet-network-status" role="status">
          {desk.frame.connectionStatus ||
            (desk.frame.phase === 'loading'
              ? 'Waiting for both fleets to load'
              : desk.frame.phase === 'countdown'
                ? 'Both fleets ready — battle starting'
                : desk.frame.phase === 'cancelled'
                  ? 'Battle cancelled before starting'
                  : '')}
        </p>
      )}
      <p className="fleet-tally-keys">
        {desk?.can.fleetChart && (
          <button
            onClick={(event) => {
              desk.issue({ kind: 'fleet-command' });
              event.currentTarget.blur();
            }}
            title="Order your fleet from the chart. Your ship keeps its engine and rudder orders."
            aria-keyshortcuts={!combat.airWing ? (bindings?.airOperations[0] ?? undefined) : undefined}
          >
            {bindings && !combat.airWing && <kbd>{bindingLabel(bindings, 'airOperations')}</kbd>}Fleet chart
          </button>
        )}
        {pointerLocked && (
          <span>
            <kbd>Ctrl</kbd>Roster
          </span>
        )}
      </p>
      {!pointerLocked && (
        <div className="fleet-rosters">
          {(['friendly', 'enemy'] as const)
            .filter((team) => team === 'friendly' || combat.afloatKg[1] !== null)
            .map((team) => (
              <Roster key={team} team={team} combat={combat} desk={desk} open={open} onToggle={toggle} />
            ))}
        </div>
      )}
      {combat.result !== 'active' && <small>Esc to return to port</small>}
      {combat.result === 'active' && combat.playerSunk && <small>Your ship is sinking · Allies still fighting</small>}
      {combat.playerSunk && (
        <div className="fleet-spectator" aria-label="Teammate spectating">
          {teammates.length ? (
            <>
              <label htmlFor="spectated-ship">Spectating teammate</label>
              <div className="fleet-spectator-controls">
                <Button
                  variant="icon"
                  disabled={teammates.length < 2}
                  onClick={(event) => {
                    desk?.issue({ kind: 'cycle-spectator', direction: -1 });
                    event.currentTarget.blur();
                  }}
                  aria-label="Spectate previous teammate"
                  title="Previous teammate · Left arrow"
                  aria-keyshortcuts="ArrowLeft"
                >
                  <Icon name="chevron" size={16} style={{ transform: 'rotate(90deg)' }} />
                </Button>
                <Select
                  id="spectated-ship"
                  value={spectatedShipId ?? ''}
                  onValueChange={(value) => desk?.issue({ kind: 'spectate', id: value })}
                >
                  {!spectatedShipId && (
                    <SelectOption value="" disabled>
                      Choose teammate
                    </SelectOption>
                  )}
                  {teammates.map((contact) => (
                    <SelectOption key={contact.id} value={contact.id}>
                      {contactLabel(contact)}
                    </SelectOption>
                  ))}
                </Select>
                <Button
                  variant="icon"
                  disabled={teammates.length < 2}
                  onClick={(event) => {
                    desk?.issue({ kind: 'cycle-spectator', direction: 1 });
                    event.currentTarget.blur();
                  }}
                  aria-label="Spectate next teammate"
                  title="Next teammate · Right arrow"
                  aria-keyshortcuts="ArrowRight"
                >
                  <Icon name="chevron" size={16} style={{ transform: 'rotate(-90deg)' }} />
                </Button>
              </div>
              {desk?.can.transferHelm && (
                <Button
                  onClick={(event) => {
                    desk.issue({ kind: 'helm-wheel', reason: 'sunk' });
                    event.currentTarget.blur();
                  }}
                  aria-keyshortcuts={bindings?.helmWheel[0] ?? undefined}
                >
                  Take a helm{bindings && <kbd>{bindingLabel(bindings, 'helmWheel')}</kbd>}
                </Button>
              )}
              <small>← / → switch teammates · Hold Ctrl for cursor</small>
              <small>Click sea to look around · Scroll to zoom</small>
            </>
          ) : (
            <small role="status">No teammates remaining to spectate</small>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

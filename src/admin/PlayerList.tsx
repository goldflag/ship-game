import type { KeyboardEvent } from 'react';
import { Button, Input, Select, SelectOption } from '../ui/components';
import { PortIcon } from '../ui/PortIcon';
import { formatDate, formatXp, pageCount, pageRange, type AdminPlayer, type SearchField } from './adminModel';

export type ListState = { status: 'loading' | 'ready'; players: AdminPlayer[]; total: number } | { status: 'error'; error: string; players: AdminPlayer[]; total: number };
export interface PlayerListProps {
  /** The search box as typed. */
  search: string;
  /** The search the list answers, once the typing settles. */
  applied: string;
  field: SearchField;
  list: ListState;
  page: number;
  pageSize: number;
  selectedId?: string;
  /** The signed-in admin, marked "you" in the list. */
  selfId: string;
  onSearch(text: string): void;
  onField(field: SearchField): void;
  onPage(page: number): void;
  onSelect(player: AdminPlayer): void;
  onRetry(): void;
}

export function RoleBadge({ role }: { role: AdminPlayer['role'] }) {
  return <span className="admin-role-badge" data-role={role}>{role === 'admin' ? 'Admin' : 'Player'}</span>;
}

/** Up and down walk the rows; Home and End reach either end. */
function walk(event: KeyboardEvent<HTMLUListElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.admin-player')];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();
  rows[next]?.focus();
}

/** Every account, newest first: search by email or name, a page at a time. */
export function PlayerList({ search, applied, field, list, page, pageSize, selectedId, selfId, onSearch, onField, onPage, onSelect, onRetry }: PlayerListProps) {
  const { players, total } = list;
  const pages = pageCount(pageSize, total);
  const query = applied.trim();
  // One row takes Tab (the selected player, else the first); arrows walk the rest.
  const tabStop = players.some(player => player.id === selectedId) ? selectedId : players[0]?.id;
  return <section className="admin-players" aria-labelledby="admin-players-title">
    <header className="admin-pane-head">
      <h2 id="admin-players-title">Players</h2>
      <span className="admin-count" aria-live="polite">{list.status === 'error' ? '\u00a0' : `${formatXp(total)} ${query ? 'found' : total === 1 ? 'account' : 'accounts'}`}</span>
    </header>
    <div className="admin-search" role="search">
      <Select id="admin-search-field" aria-label="Search by" value={field} onValueChange={value => onField(value as SearchField)}>
        <SelectOption value="email">Email</SelectOption>
        <SelectOption value="name">Name</SelectOption>
      </Select>
      <span className="admin-search-box">
        <PortIcon name="search" size={15}/>
        <Input type="search" value={search} aria-label={`Search players by ${field}`} spellCheck={false} autoComplete="off"
          placeholder={field === 'email' ? 'Part of an email' : 'Part of a name, case as typed'} onChange={event => onSearch(event.target.value)}/>
      </span>
    </div>
    <div className="admin-players-scroll" aria-busy={list.status === 'loading'}>
      {list.status === 'error' ? <div className="admin-empty" role="alert">
        <p className="admin-error">{list.error}</p>
        <Button onClick={onRetry}>Retry</Button>
      </div> : !players.length ? <p className="admin-empty">
        {list.status === 'loading' ? 'Loading players…' : query ? `No player’s ${field} contains “${query}”.` : 'No accounts yet.'}
      </p> : <ul className="admin-player-list" aria-label="Players" onKeyDown={walk}>
        {players.map(player => <li key={player.id}>
          <button type="button" className="admin-player" aria-pressed={player.id === selectedId} tabIndex={player.id === tabStop ? 0 : -1} onClick={() => onSelect(player)}>
            <span className="admin-player-name">
              <strong>{player.name || <i>No display name</i>}</strong>
              {player.id === selfId && <small>you</small>}
            </span>
            {player.role === 'admin' ? <RoleBadge role="admin"/> : <span/>}
            <span className="admin-player-email">{player.email}</span>
            <time dateTime={player.createdAt?.toISOString()}>{formatDate(player.createdAt)}</time>
          </button>
        </li>)}
      </ul>}
    </div>
    <footer className="admin-pager">
      <span>{list.status === 'error' ? '' : pageRange(page, pageSize, total)}{list.status === 'loading' && players.length ? ' · updating…' : ''}</span>
      <Button variant="icon" aria-label="Previous page" disabled={page === 0 || list.status === 'loading'} onClick={() => onPage(page - 1)}><PortIcon name="left" size={16}/></Button>
      <Button variant="icon" aria-label="Next page" disabled={page >= pages - 1 || list.status === 'loading'} onClick={() => onPage(page + 1)}><PortIcon name="right" size={16}/></Button>
    </footer>
  </section>;
}

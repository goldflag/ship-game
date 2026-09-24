import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../assetUrl';
import type { AdminProgressAction } from '../progression/rules';
import { Button } from '../ui/components';
import { Icon } from '../ui/Icons';
import { AdminRequestError, listPlayers, progressRequest, setPlayerRole } from './adminApi';
import { actionMessage, PAGE_SIZE, playerLabel, SEARCH_DEBOUNCE_MS, type AdminPlayer, type PlayerRole, type SearchField } from './adminModel';
import { PlayerList, type ListState } from './PlayerList';
import { PlayerPanel } from './PlayerPanel';
import type { ResearchState } from './ResearchPanel';

export interface AdminAccount { id: string; name: string; email: string }
type Notice = { tone: 'done' | 'error'; text: string };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AdminHeader({ account, onSignOut, signOutError }: { account: AdminAccount; onSignOut(): void; signOutError?: string }) {
  return <header className="admin-bar">
    <div className="admin-brand">
      <Icon name="anchor" size={18}/>
      <span>Fleet Command</span><span aria-hidden="true">·</span><strong>Admin</strong>
    </div>
    <div className="admin-account">
      {signOutError && <span className="admin-field-error" role="alert">{signOutError}</span>}
      <span className="admin-account-who">Signed in as <b>{account.email}</b></span>
      <Button onClick={onSignOut}><Icon name="power" size={15}/>Sign out</Button>
      <a className="admin-link" href={assetUrl('')}>Back to the game<Icon name="arrow" size={15}/></a>
    </div>
  </header>;
}

/** The signed-in admin's console: the player list on the left, the selected player on the right. */
export function AdminConsole({ account, onSignOut, onSessionLost, signOutError }: { account: AdminAccount; onSignOut(): void; onSessionLost?(): void; signOutError?: string }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [field, setField] = useState<SearchField>('email');
  const [page, setPage] = useState(0), [reload, setReload] = useState(0);
  const [list, setList] = useState<ListState>({ status: 'loading', players: [], total: 0 });
  const [selected, setSelected] = useState<AdminPlayer>();
  const [research, setResearch] = useState<ResearchState>({ status: 'loading' });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<Notice>();
  const [roleBusy, setRoleBusy] = useState(false), [roleNotice, setRoleNotice] = useState<Notice>();
  const [profileLoad, setProfileLoad] = useState(0);
  /** The player whose answers still count: a late reply for someone else is dropped. */
  const current = useRef<string>(undefined);
  const lost = useRef(onSessionLost);
  lost.current = onSessionLost;
  /** A 401 means the session ended: the gate re-checks it and falls back to sign-in. */
  const failed = (error: unknown) => {
    if (error instanceof AdminRequestError && error.status === 401) lost.current?.();
    return message(error);
  };

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let live = true;
    setList(previous => ({ status: 'loading', players: previous.players, total: previous.total }));
    listPlayers({ search: query, field, page, pageSize: PAGE_SIZE }).then(
      ({ players, total }) => { if (live) setList({ status: 'ready', players, total }); },
      error => { if (live) setList({ status: 'error', error: failed(error), players: [], total: 0 }); },
    );
    return () => { live = false; };
  }, [query, field, page, reload]);
  useEffect(() => {
    const id = selected?.id;
    current.current = id;
    if (!id) return;
    setResearch({ status: 'loading' });
    progressRequest(id).then(
      profile => { if (current.current === id) setResearch({ status: 'ready', profile }); },
      error => { if (current.current === id) setResearch({ status: 'error', error: failed(error) }); },
    );
  }, [selected?.id, profileLoad]);

  const select = (player: AdminPlayer) => {
    if (player.id === selected?.id) return;
    setSelected(player); setResearch({ status: 'loading' }); setNotice(undefined); setRoleNotice(undefined); setBusy(false);
  };
  const act = async (action: AdminProgressAction): Promise<boolean> => {
    const player = selected;
    if (!player || busy) return false;
    setBusy(true); setNotice(undefined);
    try {
      const profile = await progressRequest(player.id, action);
      if (current.current !== player.id) return false;
      setResearch({ status: 'ready', profile });
      setNotice({ tone: 'done', text: actionMessage(action, playerLabel(player)) });
      return true;
    } catch (error) {
      if (current.current === player.id) setNotice({ tone: 'error', text: failed(error) });
      return false;
    } finally {
      if (current.current === player.id) setBusy(false);
    }
  };
  const changeRole = async (role: PlayerRole) => {
    const player = selected;
    if (!player || roleBusy) return;
    setRoleBusy(true); setRoleNotice(undefined);
    try {
      await setPlayerRole(player.id, role);
      const next = { ...player, role };
      setList(previous => ({ ...previous, players: previous.players.map(entry => (entry.id === player.id ? next : entry)) }));
      if (current.current === player.id) {
        setSelected(next);
        setRoleNotice({ tone: 'done', text: role === 'admin' ? `${playerLabel(player)} is now an admin.` : `${playerLabel(player)} is no longer an admin.` });
      }
    } catch (error) {
      if (current.current === player.id) setRoleNotice({ tone: 'error', text: failed(error) });
    } finally {
      setRoleBusy(false);
    }
  };

  return <div className="admin-app">
    <AdminHeader account={account} onSignOut={onSignOut} signOutError={signOutError}/>
    <main className="admin-main">
      <PlayerList search={search} applied={query} field={field} list={list} page={page} pageSize={PAGE_SIZE} selectedId={selected?.id} selfId={account.id}
        onSearch={setSearch} onField={next => { setField(next); setPage(0); }} onPage={setPage} onSelect={select} onRetry={() => setReload(value => value + 1)}/>
      <section className="admin-detail" aria-label="Selected player">
        {selected
          ? <PlayerPanel player={selected} self={selected.id === account.id}
            role={{ busy: roleBusy, notice: roleNotice, onRole: role => void changeRole(role) }}
            research={{ research, busy, notice, onAction: act, onRetry: () => setProfileLoad(value => value + 1) }}/>
          : <div className="admin-placeholder">
            <h2>No player selected</h2>
            <p>Choose a player on the left to see their account, change their role, grant XP or gift ships.</p>
          </div>}
      </section>
    </main>
  </div>;
}

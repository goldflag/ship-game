import { useEffect, useState } from 'react';
import { Button } from '../ui/components';
import { PortIcon } from '../ui/PortIcon';
import { formatDate, playerLabel, type AdminPlayer, type PlayerRole } from './adminModel';
import { RoleBadge } from './PlayerList';
import { ResearchPanel, type ResearchPanelProps } from './ResearchPanel';

const COPY = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>
</svg>;

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('');
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 1600); return () => clearTimeout(timer); }, [copied]);
  const copy = () => {
    if (!navigator.clipboard) { setCopied('failed'); return; }
    navigator.clipboard.writeText(id).then(() => setCopied('done'), () => setCopied('failed'));
  };
  return <span className="admin-copy">
    <code>{id}</code>
    <Button variant="icon" aria-label="Copy account id" title="Copy account id" onClick={copy}>{copied === 'done' ? <PortIcon name="check" size={14}/> : COPY}</Button>
    <span className="admin-copy-note" role="status">{copied === 'done' ? 'Copied' : copied === 'failed' ? 'Select and copy it instead' : ''}</span>
  </span>;
}

export interface RoleControl {
  busy: boolean;
  notice?: { tone: 'done' | 'error'; text: string };
  onRole(role: PlayerRole): void;
}
export interface PlayerPanelProps {
  player: AdminPlayer;
  /** The selected player is the signed-in admin. */
  self: boolean;
  role: RoleControl;
  research: Omit<ResearchPanelProps, 'player'>;
}

/** The selected player: who they are, their role, and their research. */
export function PlayerPanel({ player, self, role, research }: PlayerPanelProps) {
  const admin = player.role === 'admin', locked = self && admin, name = playerLabel(player);
  return <article className="admin-detail-body" aria-labelledby="admin-player-title">
    <header className="admin-identity">
      <div className="admin-identity-main">
        <p className="admin-kicker">Player{self && ' · you'}</p>
        <h2 id="admin-player-title">{player.name || <i>No display name</i>}</h2>
        <dl className="admin-facts">
          <div><dt>Email</dt><dd>{player.email}</dd></div>
          <div><dt>Account id</dt><dd><CopyId id={player.id}/></dd></div>
          <div><dt>Joined</dt><dd><time dateTime={player.createdAt?.toISOString()}>{formatDate(player.createdAt)}</time></dd></div>
        </dl>
      </div>
      <div className="admin-role" aria-labelledby="admin-role-title" role="group">
        <p className="admin-kicker" id="admin-role-title">Role</p>
        <RoleBadge role={player.role}/>
        <Button disabled={locked} aria-disabled={role.busy || undefined} aria-describedby={locked ? 'admin-role-reason' : undefined}
          onClick={() => { if (!role.busy) role.onRole(admin ? 'user' : 'admin'); }}>{role.busy ? 'Saving…' : admin ? 'Remove admin' : 'Make admin'}</Button>
        {locked && <p className="admin-field-hint" id="admin-role-reason">You cannot remove your own admin role.</p>}
        {role.notice && <p className={role.notice.tone === 'error' ? 'admin-field-error' : 'admin-field-done'} role={role.notice.tone === 'error' ? 'alert' : 'status'}>{role.notice.text}</p>}
      </div>
    </header>
    <ResearchPanel key={player.id} player={name} {...research}/>
  </article>;
}

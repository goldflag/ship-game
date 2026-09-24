import { useEffect, useRef, useState, type FormEvent } from 'react';
import { assetUrl } from '../assetUrl';
import type { AdminProgressAction, ProgressProfile } from '../progression/rules';
import { TECH_TREE } from '../progression/techTree';
import { NationFlag } from '../ui/battle/NationFlag';
import { Button, Input, Select, SelectOption } from '../ui/components';
import { Icon } from '../ui/Icons';
import { PortIcon } from '../ui/PortIcon';
import { formatXp, GRANT_POOLS, grantPreview, ownedCount, parseXpAmount, shipLedger, type GrantPool, type LedgerShip } from './adminModel';

export type ResearchState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; profile: ProgressProfile };
export interface ResearchPanelProps {
  /** The player's name as the page shows it. */
  player: string;
  research: ResearchState;
  /** An action is in flight: every control waits. */
  busy: boolean;
  /** The last saved change, or the last failure. */
  notice?: { tone: 'done' | 'error'; text: string };
  /** Sends a change; resolves true once it is saved. */
  onAction(action: AdminProgressAction): Promise<boolean>;
  onRetry(): void;
}
type Act = ResearchPanelProps['onAction'];
/** While a change is in flight the controls refuse presses but keep focus, so the keyboard does not lose its place. */
const waiting = (busy: boolean) => (busy ? { 'aria-disabled': true } as const : {});

const STANDING: Record<LedgerShip['standing'], string> = { starter: 'Starter', owned: 'Owned', locked: 'Locked' };

function XpLedger({ profile }: { profile: ProgressProfile }) {
  return <dl className="admin-xp">
    {TECH_TREE.map(nation => <div key={nation.id} className="admin-xp-cell">
      <dt><NationFlag nation={nation.name} width={18}/>{nation.name}</dt>
      <dd>{formatXp(profile.xp[nation.id])}<small>XP</small></dd>
    </div>)}
    <div className="admin-xp-cell"><dt>Free XP</dt><dd>{formatXp(profile.freeXp)}<small>XP</small></dd></div>
    <div className="admin-xp-cell admin-xp-earned"><dt>Earned, lifetime</dt><dd>{formatXp(profile.earned)}<small>XP</small></dd></div>
  </dl>;
}

function GrantXp({ profile, busy, onAction }: { profile: ProgressProfile; busy: boolean; onAction: Act }) {
  const [amount, setAmount] = useState(''), [pool, setPool] = useState<GrantPool>('all'), [tried, setTried] = useState(false);
  const parsed = parseXpAmount(amount);
  const error = tried && 'error' in parsed ? parsed.error : '';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (busy || 'error' in parsed) return;
    void onAction({ action: 'grant-xp', amount: parsed.amount, pool }).then(saved => { if (saved) { setAmount(''); setTried(false); } });
  };
  return <form className="admin-grant" onSubmit={submit} noValidate aria-labelledby="admin-grant-title">
    <h4 id="admin-grant-title">Grant XP</h4>
    <div className="admin-grant-row">
      <label className="admin-field">
        <span>Amount</span>
        <Input value={amount} inputMode="numeric" placeholder="5000 or −500" autoComplete="off" aria-invalid={!!error}
          aria-describedby="admin-grant-hint" onChange={event => setAmount(event.target.value)}/>
      </label>
      <span className="admin-field">
        <label htmlFor="admin-grant-pool">Pool</label>
        <Select id="admin-grant-pool" value={pool} onValueChange={value => setPool(value as GrantPool)}>
          {GRANT_POOLS.map(entry => <SelectOption key={entry.id} value={entry.id}>{entry.label}</SelectOption>)}
        </Select>
      </span>
      <Button variant="primary" type="submit" {...waiting(busy)}>{'amount' in parsed && parsed.amount < 0 ? 'Take XP' : 'Grant XP'}</Button>
    </div>
    <p id="admin-grant-hint" className={error ? 'admin-field-error' : 'admin-field-hint'} role={error ? 'alert' : undefined}>
      {error || ('amount' in parsed ? grantPreview(profile, parsed.amount, pool) : 'A negative amount corrects a balance; no pool drops below zero.')}
    </p>
  </form>;
}

function OpenEverything({ profile, busy, onAction }: { profile: ProgressProfile; busy: boolean; onAction: Act }) {
  const on = !!profile.allUnlocked;
  return <div className="admin-open-all">
    <h4>Every ship</h4>
    <button type="button" role="switch" aria-checked={on} className="admin-switch" {...waiting(busy)} aria-describedby="admin-open-all-note"
      onClick={() => { if (!busy) void onAction({ action: 'unlock-all', value: !on }); }}>
      <span className="admin-switch-track" aria-hidden="true"><span/></span>
      Every ship unlocked
    </button>
    <p id="admin-open-all-note" className="admin-field-hint">
      {on ? 'Every modelled ship is open. Turning it off keeps starters, unlocks and gifts.' : 'Opens every modelled ship without spending XP.'}
    </p>
  </div>;
}

function ShipRow({ ship, busy, onAction }: { ship: LedgerShip; busy: boolean; onAction: Act }) {
  const { node, standing, detail, action } = ship, name = node.name.toUpperCase();
  return <li className="admin-ship" data-standing={standing}>
    <img src={assetUrl(`models/${node.presetId}-thumbnail.png`)} width={96} height={29} alt="" loading="lazy" draggable={false}/>
    <span className="admin-ship-name">
      <strong>{name}</strong>
      <small>{node.className !== node.name ? `${node.type} · ${node.className} class` : node.type} · {node.year}</small>
    </span>
    <span className="admin-ship-cost">{node.cost ? `${formatXp(node.cost)} XP` : 'Free'}</span>
    <span className="admin-ship-standing">
      <b>{STANDING[standing]}</b>
      <small>{detail}</small>
    </span>
    {action
      ? <Button className="admin-ship-toggle" data-action={action} {...waiting(busy)} aria-label={`${action === 'unlock' ? 'Gift' : 'Remove'} ${name}`}
        onClick={() => { if (!busy) void onAction({ action, nodeId: node.id }); }}>{action === 'unlock' ? 'Gift' : 'Remove'}</Button>
      : <span className="admin-ship-fixed" title="Starters are always owned">Fixed</span>}
  </li>;
}

/** A second press sooner than this after the offer is a double-click, not a decision. */
const CONFIRM_GUARD_MS = 400;
function ResetProgress({ player, busy, onAction }: { player: string; busy: boolean; onAction: Act }) {
  const [confirming, setConfirming] = useState(false), offered = useRef(0), offer = useRef<HTMLButtonElement>(null), answered = useRef(false);
  // Cancel and confirm unmount the pair of buttons; focus returns to the offer.
  useEffect(() => { if (!confirming && answered.current) offer.current?.focus(); }, [confirming]);
  const close = () => { answered.current = true; setConfirming(false); };
  return <section className="admin-reset" aria-labelledby="admin-reset-title" data-confirming={confirming}
    onKeyDown={event => { if (event.key === 'Escape' && confirming) { event.stopPropagation(); close(); } }}>
    <div>
      <h4 id="admin-reset-title">Reset progress</h4>
      <p role={confirming ? 'alert' : undefined}>{confirming
        ? `This clears ${player}’s XP, lifetime total, unlocks and gifts, and turns off Every ship unlocked. It cannot be undone.`
        : 'Back to the starters with no XP.'}</p>
    </div>
    <div className="admin-reset-actions">
      {confirming ? <>
        <Button onClick={close}>Cancel</Button>
        <Button className="admin-danger-button" autoFocus {...waiting(busy)} onClick={() => {
          if (busy || performance.now() - offered.current < CONFIRM_GUARD_MS) return;
          close();
          void onAction({ action: 'reset' });
        }}>Reset {player}’s progress</Button>
      </> : <Button ref={offer} {...waiting(busy)} onClick={() => { if (busy) return; offered.current = performance.now(); setConfirming(true); }}>Reset progress…</Button>}
    </div>
  </section>;
}

/** A player's research: XP by pool, grants, gifts and the reset, each saved at once and answered with the new profile. */
export function ResearchPanel({ player, research, busy, notice, onAction, onRetry }: ResearchPanelProps) {
  const profile = research.status === 'ready' ? research.profile : undefined;
  const ledger = profile && shipLedger(profile), count = ledger && ownedCount(ledger);
  return <section className="admin-research" aria-labelledby="admin-research-title" aria-busy={busy || research.status === 'loading'}>
    <header className="admin-research-head">
      <h3 id="admin-research-title">Research</h3>
      <p className="admin-status" role="status" data-tone={busy ? 'busy' : notice?.tone}>
        {busy ? 'Saving…' : notice?.tone === 'done' ? <><PortIcon name="check" size={14}/>{notice.text}</> : notice?.tone === 'error' ? <><Icon name="warning" size={13}/>{notice.text}</> : null}
      </p>
    </header>
    {research.status === 'loading' ? <p className="admin-empty">Loading research progress…</p>
      : research.status === 'error' ? <div className="admin-empty" role="alert">
        <p className="admin-error">{research.error}</p>
        <Button onClick={onRetry}>Retry</Button>
      </div>
      : <>
        <XpLedger profile={profile!}/>
        <div className="admin-tools">
          <GrantXp profile={profile!} busy={busy} onAction={onAction}/>
          <OpenEverything profile={profile!} busy={busy} onAction={onAction}/>
        </div>
        <section className="admin-ledger" aria-labelledby="admin-ledger-title">
          <h4 id="admin-ledger-title">Ships <span>{count!.owned} of {count!.total} owned</span></h4>
          {ledger!.map(({ nation, lines }) => <section key={nation.id} className="admin-ledger-nation" aria-label={nation.name}>
            <h5><NationFlag nation={nation.name} width={20}/>{nation.name}<span>{formatXp(profile!.xp[nation.id])} XP</span></h5>
            {lines.map(({ line, ships }) => <div key={line.id} className="admin-ledger-line">
              <h6>{line.label}</h6>
              <ul>{ships.map(ship => <ShipRow key={ship.node.id} ship={ship} busy={busy} onAction={onAction}/>)}</ul>
            </div>)}
          </section>)}
        </section>
        <ResetProgress player={player} busy={busy} onAction={onAction}/>
      </>}
  </section>;
}

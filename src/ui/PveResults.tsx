import { useEffect, useRef, useState } from 'react';
import type { BattleDebrief } from '../game/session/BattleSession';
import type { BattleOutcome } from '../simulation/battleRules';
import { shipPreset } from '../ships/presets';
import { Button } from './components';
import './PveResults.css';

interface Props { result: 'victory' | 'defeat' | 'draw'; outcome: BattleOutcome; debrief: BattleDebrief; onRestart(): Promise<void>; onNewBattle(): Promise<void>; onPort(): Promise<void> }
const statusLabel = { operational: 'Combat capable', sunk: 'Sunk', incapacitated: 'Permanently incapacitated' };
export function PveResults({ result, outcome, debrief, onRestart, onNewBattle, onPort }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const action = async (label: string, run: () => Promise<void>) => { if (busy) return; setBusy(label); setError(''); try { await run(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); } };
  const seconds = Math.floor(debrief.tick / 60);
  const reason = outcome.reason === 'time-limit' ? 'The configured time limit was reached.' : result === 'victory' ? 'The enemy fleet can no longer fight.' : result === 'defeat' ? 'Your fleet can no longer fight.' : 'Both fleets lost their remaining combat capability.';
  return <dialog ref={dialog} className="pve-results" aria-labelledby="pve-result-title" onCancel={e => e.preventDefault()}>
    <header><span>FLEET COMMAND · BATTLE COMPLETE</span><h1 id="pve-result-title">{result === 'victory' ? 'Victory' : result === 'defeat' ? 'Defeat' : 'Draw'}</h1><p>{reason}</p><div><strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} elapsed</strong><small>Mission {debrief.seed.toString(16).toUpperCase().padStart(8, '0')}</small></div></header>
    <div className="pve-results-report"><h2>Full debrief</h2><p>Both fleets are now revealed. Sunk and permanently incapacitated ships count as defeated.</p>
      {(['friendly', 'enemy'] as const).map(team => {
        const ships = debrief.ships.filter(s => s.team === team), sunk = ships.filter(s => s.status === 'sunk').length, incapable = ships.filter(s => s.status === 'incapacitated').length;
        return <section key={team}><h3>{team === 'friendly' ? 'Your fleet' : 'Enemy fleet'}<small>{ships.length} ships · {Math.round(ships.reduce((n, s) => n + shipPreset(s.presetId).hull.massKg, 0) / 1000).toLocaleString()} t</small></h3><p>{sunk} sunk · {incapable} permanently incapacitated</p><table><thead><tr><th scope="col">Ship / final state</th><th scope="col">Damage dealt</th><th scope="col">Ships sunk</th></tr></thead><tbody>{ships.map(ship => {
          const definition = shipPreset(ship.presetId), same = ships.filter(s => s.presetId === ship.presetId);
          return <tr key={ship.id}><th scope="row">{definition.name}{same.length > 1 ? ` ${same.indexOf(ship) + 1}` : ''}<small className={ship.status === 'operational' ? '' : 'is-defeated'}>{statusLabel[ship.status]}{definition.airWing ? ` · ${ship.aircraftRemaining} aircraft remaining` : ''}</small></th><td>{Math.round(ship.damageDealt).toLocaleString()}</td><td>{ship.frags}</td></tr>;
        })}</tbody></table></section>;
      })}
    </div>
    <footer><p role="status">{error || busy}</p><div><Button variant="primary" disabled={!!busy} onClick={() => void action('Restarting the same mission…', onRestart)}>Restart this battle<small>Same fleets, seed and starting positions</small></Button><Button disabled={!!busy} onClick={() => void action('Preparing a new battle…', onNewBattle)}>New battle<small>Keep your fleet; generate a new opponent</small></Button></div><Button disabled={!!busy} onClick={() => void action('Returning to port…', onPort)}>Return to port</Button></footer>
  </dialog>;
}

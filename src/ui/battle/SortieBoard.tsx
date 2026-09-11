import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../components';
import { Icon } from '../Icons';
import { BATTLE_MODES, loadSkipSortieBoard, saveSkipSortieBoard, type BattleMode } from './battleModes';
import './SortieBoard.css';

interface Props {
  /** Marked "Last played" and focused first, so Enter repeats the usual choice. */
  lastMode: BattleMode;
  onChoose(mode: BattleMode): void;
  onClose(): void;
}

/** The board shown when Battle is pressed: every mode answers the same four questions in the
 * same place, so the choice is made with context before the setup dialog opens. */
export function SortieBoard({ lastMode, onChoose, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState<BattleMode>(lastMode);
  const [skip, setSkip] = useState(loadSkipSortieBoard);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    cards.current[BATTLE_MODES.findIndex(mode => mode.id === lastMode)]?.focus();
    return () => { if (element.open) element.close(); };
  }, [lastMode]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + BATTLE_MODES.length) % BATTLE_MODES.length;
    setSelected(BATTLE_MODES[next].id); cards.current[next]?.focus();
  };
  const toggleSkip = (value: boolean) => { setSkip(value); saveSkipSortieBoard(value); };

  return <dialog ref={dialog} className="sortie-board" aria-labelledby="sortie-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="sortie-head">
      <h1 id="sortie-title"><Icon name="anchor" size={18}/>Choose a battle</h1>
      <p>Three ways to put the fleet to sea. Every mode ends on the deployment chart.</p>
      <Button variant="icon" className="sortie-close" aria-label="Back to port" onClick={onClose}><Icon name="close"/></Button>
    </header>
    <div className="sortie-cards" role="radiogroup" aria-label="Battle mode">
      {BATTLE_MODES.map((mode, index) => <button type="button" key={mode.id} ref={element => { cards.current[index] = element; }} className="sortie-card" role="radio" aria-checked={selected === mode.id}
        tabIndex={selected === mode.id ? 0 : -1} onFocus={() => setSelected(mode.id)} onKeyDown={event => move(event, index)} onClick={() => onChoose(mode.id)}>
        {mode.id === lastMode && <span className="sortie-tag">Last played</span>}
        {mode.id !== lastMode && mode.online && <span className="sortie-tag is-quiet">Online</span>}
        <ModeGlyph mode={mode.id}/>
        <h2>{mode.name}</h2>
        <p className="sortie-pitch">{mode.pitch}</p>
        <dl className="sortie-ledger">
          {mode.ledger.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}{fact.note && <small>{fact.note}</small>}</dd></div>)}
        </dl>
        <span className="sortie-go">{mode.action}<Icon name="arrow" size={16}/></span>
      </button>)}
    </div>
    <footer className="sortie-foot">
      <label><input type="checkbox" id="sortie-skip" checked={skip} onChange={event => toggleSkip(event.target.checked)}/>Skip this next time and open my last mode</label>
      <span className="sortie-keys"><kbd>←</kbd> <kbd>→</kbd> choose · <kbd>Enter</kbd> continue · <kbd>Esc</kbd> back to port</span>
    </footer>
  </dialog>;
}

/** Hull silhouettes: one ship, a fleet in three groups, two ships facing off. */
function ModeGlyph({ mode }: { mode: BattleMode }) {
  return <svg className="sortie-glyph" viewBox="0 0 44 26" fill="currentColor" aria-hidden="true">
    {mode === 'custom' && <path d="M2 20h40l-4 4H6zM10 19l2-5h8l1-4h4v4h6l2 5z"/>}
    {mode === 'pve' && <path d="M1 12h14l-2 3H3zM4 11l1-3h5l1-2h2v2h3l1 3zM15 20h16l-2 3H17zM18 19l1-3h5l1-3h2v3h3l2 3zM29 12h14l-2 3H31zM32 11l1-3h5l1-2h2v2h3l1 3z"/>}
    {mode === 'duel' && <><path d="M1 18h18l-2 3H3zM4 17l1-3h6l1-4h2v4h4l1 3zM25 18h18l-2 3H27zM28 17l1-3h4l1-4h2v4h6l1 3z"/><path d="M20 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></>}
  </svg>;
}

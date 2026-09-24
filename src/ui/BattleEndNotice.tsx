import { useEffect, useRef, useState } from 'react';
import type { BattleResult } from '../game/session/BattleSession';
import type { BattleOutcome } from '../game/session/battleRules';
import type { XpReadout } from './report/battleAward';
import { XpAward } from './report/XpAward';
import './BattleEndNotice.css';

export const BATTLE_EXIT_DELAY_MS = 15_000;

/** Wall-clock deadline: independent of simulation speed, pause and HUD visibility. */
export function scheduleBattleExit(onSeconds: (seconds: number) => void, onExit: () => void) {
  const deadline = Date.now() + BATTLE_EXIT_DELAY_MS;
  const interval = setInterval(() => onSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 200);
  const timeout = setTimeout(() => { clearInterval(interval); onSeconds(0); onExit(); }, BATTLE_EXIT_DELAY_MS);
  return () => { clearInterval(interval); clearTimeout(timeout); };
}

export function BattleEndNotice({ result, outcome, onExit, xp }: { result: BattleResult; outcome?: BattleOutcome; onExit(): void; xp?: XpReadout }) {
  const [seconds, setSeconds] = useState(15);
  const exit = useRef(onExit);
  exit.current = onExit;
  useEffect(() => scheduleBattleExit(setSeconds, () => exit.current()), []);
  const title = outcome?.reason === 'infrastructure' ? 'Battle interrupted' : outcome?.reason === 'abandoned' ? 'Battle abandoned' : `Battle over · ${result === 'victory' ? 'Victory' : result === 'defeat' ? 'Defeat' : 'Draw'}`;
  return <section className="battle-end-notice" aria-label="Battle complete">
    <h2 role="status">{title}</h2>
    {xp && <XpAward xp={xp} />}
    <p>Returning to port in <strong>{seconds}s</strong></p>
  </section>;
}

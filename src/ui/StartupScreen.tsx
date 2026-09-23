import { useEffect, useState, type CSSProperties } from 'react';
import './startup.css';

export interface StartupProgress { label: string; progress: number; }
/** Shown from the moment the account is confirmed until the game bundle reports its own progress. */
export const STARTUP_INITIAL: StartupProgress = { label: 'Preparing the harbor', progress: 0.05 };
/** Callbacks a parent uses to keep one loader mounted while the game bundle loads and initializes. */
export interface StartupReporter { progress(label: string, progress: number): void; done(): void; }

/** A finished load holds "Ready to get underway" this long, then fades into the port over `.startup-leaving`. */
const READY_HOLD_MS = 450;
const LEAVE_MS = 600;

/** The single loading screen for startup: Scharnhorst's profile inks in from stern to bow as the game loads.
 * Mirrors the static markup in index.html so the swap to React is invisible. After `done`, a finished load
 * holds its last stage and fades out; an unfinished one (the game reported an error) leaves at once.
 * Change the markup here and in index.html together. scripts/diagnostics/measure-startup.mjs,
 * measure-port-startup.mjs and measure-custom-battle.mjs read the `.startup-status` text. */
export function StartupScreen({ label, progress, done = false }: StartupProgress & { done?: boolean }) {
  const [phase, setPhase] = useState<'shown' | 'leaving' | 'gone'>('shown');
  const finished = progress >= 1;
  useEffect(() => {
    if (!done) return setPhase('shown');
    if (!finished) return setPhase('gone');
    const leave = setTimeout(() => setPhase('leaving'), READY_HOLD_MS);
    const gone = setTimeout(() => setPhase('gone'), READY_HOLD_MS + LEAVE_MS);
    return () => { clearTimeout(leave); clearTimeout(gone); };
  }, [done, finished]);
  if (done && phase === 'gone') return null;
  const percent = Math.round(progress * 100);
  return <section className={`startup-screen${done && phase === 'leaving' ? ' startup-leaving' : ''}`} aria-label="Opening the harbor" style={{ '--p': progress } as CSSProperties}>
    <div className="startup-drawing" role="progressbar" aria-label="Loading progress" aria-valuetext={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span className="startup-pen"/></div>
    <p className="startup-status" role="status">{finished ? label : `${label}…`}</p>
  </section>;
}

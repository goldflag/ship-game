import './startup.css';

export interface StartupProgress { label: string; progress: number; }
/** Shown from the moment the account is confirmed until the game bundle reports its own progress. */
export const STARTUP_INITIAL: StartupProgress = { label: 'Preparing the harbor', progress: 0.05 };
/** Callbacks a parent uses to keep one loader mounted while the game bundle loads and initializes. */
export interface StartupReporter { progress(label: string, progress: number): void; done(): void; }

/** The single loading screen for startup. Mirrors the static markup in index.html so the swap to React is invisible. */
export function StartupScreen({ label, progress }: StartupProgress) {
  return <section className="startup-screen" aria-labelledby="startup-title">
    <div className="startup-content">
      <h1 id="startup-title">Opening the harbor</h1>
      <p className="startup-status" role="status">{label}…</p>
      <div className="loading-progress" role="progressbar" aria-label="Opening the harbor" aria-valuetext={label} aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ transform: `scaleX(${progress})` }}/></div>
      <p className="startup-note">The first visit can take a little longer while ship models, ocean effects and lighting are prepared.</p>
    </div>
  </section>;
}

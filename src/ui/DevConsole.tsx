import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { DeveloperWeather, EnvironmentOverrides } from '../game/VisualEnvironment';
import type { SkyRenderer } from '../game/graphicsSettings';
import { clampSetting, currentValue, isDeveloperConsoleKey, matchCommands, overrideCount, readingLabel, WEATHER_SETTINGS, type ConsoleMatch, type WeatherKey, type WeatherSetting } from './devConsoleCommands';
import './DevConsole.css';

/** The slice of the game the console reads and drives. */
export interface DevConsoleHost {
  developerWeather(): DeveloperWeather | undefined;
  setDeveloperWeather(overrides: EnvironmentOverrides): void;
  diagnostics(): unknown;
  /** Returns whether the analytic bow waves are now drawn. */
  toggleBowWaves?(): boolean;
  releasePointer(): void;
  capturePointer(): void;
}

const ICONS: Record<WeatherKey, ReactNode> = {
  timeHours: <svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="2.6"/><path d="M7 .8v1.8M7 11.4v1.8M.8 7h1.8M11.4 7h1.8M2.6 2.6l1.3 1.3M10.1 10.1l1.3 1.3M2.6 11.4l1.3-1.3M10.1 3.9l1.3-1.3"/></svg>,
  cloudCover: <svg viewBox="0 0 16 14" aria-hidden="true"><path d="M4.5 11.5h7.2a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.6-.9A3.2 3.2 0 0 0 4.5 11.5z"/></svg>,
  windSpeed: <svg viewBox="0 0 16 14" aria-hidden="true"><path d="M1 5h9.5a2 2 0 1 0-2-2M1 9h12a2 2 0 1 1-2 2"/></svg>,
  windDirection: <svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.8"/><path d="M7 3v8M4.6 8.6 7 11l2.4-2.4"/></svg>,
  visibilityKm: <svg viewBox="0 0 16 14" aria-hidden="true"><path d="M1 7s2.6-4.5 7-4.5S15 7 15 7s-2.6 4.5-7 4.5S1 7 1 7z"/><circle cx="8" cy="7" r="2"/></svg>,
  precipitation: <svg viewBox="0 0 16 14" aria-hidden="true"><path d="M4.5 8h7.2a2.6 2.6 0 0 0 .3-5.2 3.8 3.8 0 0 0-7.2-.8A3 3 0 0 0 4.5 8zM5 10l-1 3M8.5 10l-1 3M12 10l-1 3"/></svg>,
  lightning: <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 1 3.5 8h3.5L5.5 13l5-7H7z"/></svg>,
  moonPhase: <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9.8 1.6a5.6 5.6 0 1 0 2.6 8.4A4.6 4.6 0 0 1 9.8 1.6z"/></svg>,
};
const SEARCH = <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.8"/><path d="M10.5 10.5l4 4"/></svg>;

/** The sky comparison the app owns: the renderer the graphics settings name, and a switch that saves the other
 * and says when it applies (at once in port, which rebuilds; on return to port at sea). */
export interface SkyRendererSwitch { current: SkyRenderer; toggle(): string }
const SKY_RENDERER_NAMES: Record<SkyRenderer, string> = { game: 'Game sky', skypro: 'Sky Pro' };

/** Shift-D developer console: a command line over the scene for live weather
 * and diagnostics. Weather chips scrub by dragging; a new scene clears them. */
export function DevConsole({ host, skyRenderer }: { host: DevConsoleHost; skyRenderer?: SkyRendererSwitch }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [weather, setWeather] = useState(() => host.developerWeather());
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => setWeather(host.developerWeather());

  // Scene changes, restarts and trial resets clear overrides inside the game;
  // a light poll keeps the chips and the closed tag honest.
  useEffect(() => { refresh(); const timer = setInterval(refresh, 400); return () => clearInterval(timer); }, [host]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!isDeveloperConsoleKey(event) || event.repeat) return;
      const target = event.target;
      const own = target instanceof HTMLElement && !!target.closest('.dev-console');
      if (!own && target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      // Let the key travel on: the helm reads any non-Shift key as the end of a
      // Shift tap, and would otherwise raise the binoculars on release.
      event.preventDefault();
      setOpen(value => !value);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  useEffect(() => {
    if (!open) return;
    host.releasePointer(); setQuery(''); setActive(0); setNotice(''); refresh();
    input.current?.focus();
    return () => host.capturePointer();
  }, [open, host]);

  const locked = !!weather?.locked;
  const matches = matchCommands(query, locked).slice(0, 8);
  const selected = Math.min(active, Math.max(0, matches.length - 1));
  const overrides = weather?.overrides ?? {};
  useEffect(() => { if (open) document.getElementById(`dev-console-result-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [open, selected]);
  const apply = (next: EnvironmentOverrides) => {
    try { host.setDeveloperWeather(next); setNotice(''); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    refresh();
  };
  const run = ({ command, value }: ConsoleMatch) => {
    if (command.kind === 'setting') {
      if (value === undefined) { setQuery(`${command.words[0]} `); input.current?.focus(); return; }
      apply({ ...overrides, [command.key]: value });
    } else if (command.kind === 'preset') apply({ ...overrides, ...command.overrides });
    else if (command.id === 'reset') apply({});
    else if (command.id === 'bowWaves') setNotice(host.toggleBowWaves?.() ? 'Bow waves on.' : 'Bow waves off.');
    else if (command.id === 'skyRenderer') setNotice(skyRenderer?.toggle() ?? 'The sky renderer cannot be switched here.');
    else {
      const text = JSON.stringify(host.diagnostics(), null, 2);
      void navigator.clipboard?.writeText(text).then(() => setNotice('Scene diagnostics copied.'), () => setNotice('The clipboard is unavailable.'));
    }
    setQuery(''); setActive(0);
  };
  // Keep the game's own Escape (pause) and helm keys out of the console,
  // whether the command line or a chip holds focus.
  const panelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isDeveloperConsoleKey(event.nativeEvent)) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length) setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); run(matches[selected]); }
  };

  if (!open) {
    const count = overrideCount(overrides);
    return count ? <button type="button" className="dev-console-tag" onClick={() => setOpen(true)}>
      <span className="dev-console-badge">DEV</span>{count} {count === 1 ? 'override' : 'overrides'}<kbd>⇧</kbd><kbd>D</kbd>
    </button> : null;
  }
  const reading = weather?.reading;
  return <section className="dev-console" role="dialog" aria-label="Developer console" onKeyDown={panelKeyDown}>
    <div className="dev-console-line">
      <span className="dev-console-badge">DEV</span>{SEARCH}
      <input ref={input} value={query} aria-label="Developer command" placeholder="Type a setting or command, such as wind 14"
        role="combobox" aria-expanded={matches.length > 0} aria-controls="dev-console-results" aria-activedescendant={matches.length ? `dev-console-result-${selected}` : undefined}
        spellCheck={false} autoComplete="off"
        onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keyDown}/>
      <kbd>esc</kbd>
    </div>
    <ul id="dev-console-results" className="dev-console-results" role="listbox">
      {matches.map((match, index) => <li key={`${match.command.kind}-${'key' in match.command ? match.command.key : match.command.id}`}
        id={`dev-console-result-${index}`} role="option" aria-selected={index === selected} className={index === selected ? 'on' : ''}
        onPointerEnter={() => setActive(index)} onPointerDown={event => { event.preventDefault(); run(match); }}>
        <span className="dev-console-group">{match.command.group}</span>
        <span className="dev-console-label">{match.command.label}</span>
        <span className="dev-console-value">{resultValue(match, reading && weather, skyRenderer?.current)}</span>
        {index === selected && <kbd>↵</kbd>}
      </li>)}
      {!matches.length && <li className="dev-console-empty">No setting or command matches “{query.trim()}”.</li>}
    </ul>
    {reading && <footer className="dev-console-now">
      <div className="dev-console-caption">
        <span>Weather now · {weather.scene}{locked ? ' · online battles keep the server’s weather' : ' · drag a value to scrub, double-click to reset it'}</span>
        {!locked && <button type="button" disabled={!overrideCount(overrides)} onClick={() => apply({})}>Reset all</button>}
      </div>
      <div className="dev-console-chips">
        {WEATHER_SETTINGS.map(setting => <WeatherChip key={setting.key} setting={setting} weather={weather} disabled={locked}
          onFocus={() => { setQuery(`${setting.words[0]} `); input.current?.focus(); }}
          onChange={value => apply({ ...overrides, [setting.key]: value })}
          onReset={() => apply({ ...overrides, [setting.key]: undefined })}/>)}
      </div>
      {weather.seaWind !== undefined && <p className="dev-console-note">Sea physics ride {weather.seaWind.toFixed(1)} m/s.</p>}
      {notice && <p className="dev-console-note" role="status">{notice}</p>}
    </footer>}
  </section>;
}

function resultValue({ command, value }: ConsoleMatch, weather?: DeveloperWeather, sky?: SkyRenderer) {
  if (command.kind === 'action' && command.id === 'skyRenderer')
    return sky ? `${SKY_RENDERER_NAMES[sky]} → ${SKY_RENDERER_NAMES[sky === 'skypro' ? 'game' : 'skypro']}` : '';
  if (command.kind !== 'setting') return command.kind === 'preset' ? Object.entries(command.overrides)
    .map(([key, v]) => WEATHER_SETTINGS.find(s => s.key === key)!.format(v)).join(' · ') : '';
  const now = weather ? command.format(currentValue(command.key, weather.reading)) : '';
  return value === undefined ? now : <b>{now} → {command.format(value)}</b>;
}

function WeatherChip({ setting, weather, disabled, onChange, onReset, onFocus }: {
  setting: WeatherSetting; weather: DeveloperWeather; disabled: boolean;
  onChange(value: number): void; onReset(): void; onFocus(): void;
}) {
  const drag = useRef<{ x: number; start: number; moved: boolean }>(undefined);
  const changed = weather.overrides[setting.key] !== undefined;
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: currentValue(setting.key, weather.reading), moved: false };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) < 3) return;
    state.moved = true;
    onChange(clampSetting(setting, state.start + dx * setting.scrub));
  };
  const up = () => { const state = drag.current; drag.current = undefined; if (state && !state.moved) onFocus(); };
  return <button type="button" className={`dev-console-chip ${changed ? 'changed' : ''}`} disabled={disabled}
    aria-label={`${setting.label}: ${readingLabel(setting.key, weather.reading)}${changed ? ', overridden' : ''}`}
    title={`${setting.label}. Drag to scrub, double-click to reset.`}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; }}
    onDoubleClick={() => { if (changed) onReset(); }}>
    {ICONS[setting.key]}<span>{readingLabel(setting.key, weather.reading)}</span>
  </button>;
}

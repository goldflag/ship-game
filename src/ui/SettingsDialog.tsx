import { Select, SelectOption, Button, Input } from './components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PerformanceReadout } from '../game/types';
import { bindingError, defaultKeybindings, INPUT_ACTIONS, keyLabel, type InputAction, type Keybindings } from '../game/keybindings';
import { Icon } from './Icons';
import './SettingsDialog.css';
import { DEFAULT_AUDIO, type AudioSettings, type SoundId } from '../game/audio';
import { DEFAULT_HUD, type HudSettings } from '../game/hudSettings';
import { GRAPHICS_PRESETS, PRESET_ORDER, launchMatches, matchingPreset, nearestPreset, RENDER_SCALE_MIN, RENDER_SCALE_STEP, type FrameLimit, type GraphicsPreset, type GraphicsSettings } from '../game/graphicsSettings';

// The landscape pause-menu settings dialog: section tabs on the title row, one
// live status line in the footer. Every row applies immediately; the ocean tier
// and terrain density are read when the port reloads or the next battle starts.
interface SettingsDialogProps {
  graphics: GraphicsSettings;
  launched?: Pick<GraphicsSettings, 'ocean' | 'terrain'>;
  performance?: PerformanceReadout;
  inBattle: boolean;
  onGraphicsChange(settings: GraphicsSettings): boolean;
  onReloadPort(): void;
  bindings: Keybindings;
  audioSettings: AudioSettings;
  hudSettings: HudSettings;
  hudScale: number;
  onHudChange(settings: HudSettings): boolean;
  onAudioChange(settings: AudioSettings): boolean;
  onPreviewSound(id: SoundId): void;
  onBindingsChange(bindings: Keybindings): boolean;
  onClose(): void;
}

type Section = 'graphics' | 'hud' | 'keys' | 'sound';
type SelectRowKey = Exclude<keyof GraphicsSettings, 'renderScale'>;
interface SelectRow { id: SelectRowKey; label: string; hint: string; cost?: 1 | 2 | 3; later?: boolean; options: readonly (readonly [string, string])[] }

const PRESET_LABEL: Record<GraphicsPreset, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };
const PRESET_NOTES: Record<GraphicsPreset, string> = {
  low: 'For integrated graphics and laptops on battery.', medium: 'Balanced for mid-range and older desktop GPUs.',
  high: 'Recommended for most desktop GPUs.', ultra: 'For fast GPUs; the full ocean and sky simulation.',
};
const TIERS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] as const;
const GRAPHICS_COLUMNS: { group: string; rows: SelectRow[] }[][] = [
  [{ group: 'Display', rows: [
    { id: 'frameLimit', label: 'Frame rate limit', hint: 'Caps rendering to save power and keep fans quiet.', options: [['0', 'Display refresh'], ['120', '120 FPS'], ['60', '60 FPS'], ['30', '30 FPS']] },
    { id: 'antialiasing', label: 'Anti-aliasing', cost: 1, hint: 'Smooths rigging, rails and hull edges. SMAA is sharper and costs a little more.', options: [['off', 'Off'], ['fxaa', 'FXAA'], ['smaa', 'SMAA']] },
  ] }],
  [{ group: 'Sea and sky', rows: [
    { id: 'ocean', label: 'Ocean simulation', cost: 2, later: true, hint: 'Wave cascades, surface mesh and wake resolution.', options: TIERS },
    { id: 'reflections', label: 'Water reflections', cost: 3, hint: 'Ships and sky traces hulls and smoke into the water. The heaviest single effect in a large fleet.', options: [['sky', 'Sky only'], ['scene', 'Ships and sky']] },
    { id: 'clouds', label: 'Clouds', cost: 3, hint: 'Volumetric cloud detail and cloud light in reflections.', options: TIERS },
    { id: 'shadows', label: 'Shadows', cost: 2, hint: 'Sun shadows across decks, hulls and the harbor.', options: [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  ] }],
  [{ group: 'Detail and effects', rows: [
    { id: 'modelDetail', label: 'Ship and aircraft detail', cost: 1, hint: 'How close a hull or airframe must be before it keeps its full geometry.', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['full', 'Full']] },
    { id: 'terrain', label: 'Terrain and vegetation', cost: 1, later: true, hint: 'Island and harbor mesh density and tree cover.', options: [['medium', 'Medium'], ['high', 'High']] },
    { id: 'effects', label: 'Combat effects', cost: 2, hint: 'Gun smoke, splashes, fires, funnel smoke and damage marks.', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  ] }, { group: 'Readouts', rows: [
    { id: 'readout', label: 'Performance readout', hint: 'Detailed adds frame time, render resolution and draw counts beside the pause control.', options: [['hidden', 'Hidden'], ['fps', 'FPS'], ['detailed', 'Detailed']] },
  ] }],
];
const optionLabel = (row: SelectRow, value: string | number) => row.options.find(([option]) => option === String(value))?.[1] ?? String(value);
const COST_WORDS = ['', 'light', 'moderate', 'heavy'];

function CostMeter({ cost }: { cost?: 1 | 2 | 3 }) {
  if (!cost) return null;
  return <span className="cost-meter" data-cost={cost} role="img" aria-label={`GPU cost: ${COST_WORDS[cost]}`} title={`GPU cost: ${COST_WORDS[cost]}`}><i/><i/><i/></span>;
}

export function SettingsDialog({ graphics, launched, performance, inBattle, onGraphicsChange, onReloadPort, bindings, audioSettings, hudSettings, hudScale, onHudChange, onAudioChange, onPreviewSound, onBindingsChange, onClose }: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<Section>('graphics');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const noticeTimer = useRef(0);
  const [listening, setListening] = useState<{ action: InputAction; slot: 0 | 1 } | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      clearTimeout(noticeTimer.current);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  /** Momentary confirmation in the footer; a keybinding error stays until the next action. */
  const announce = (text: string, error = false, sticky = false) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, error });
    if (!sticky) noticeTimer.current = window.setTimeout(() => setNotice(null), 2200);
  };
  const storageNote = (saved: boolean, what: string) => saved ? `${what} saved.` : `${what} applied for this session. Browser storage is unavailable.`;
  const showSection = (next: Section) => { setSection(next); setListening(null); setInvalid(false); setNotice(null); };

  useEffect(() => {
    if (!listening) return;
    const capture = (event: KeyboardEvent) => {
      if (event.code === 'Tab') { setListening(null); setInvalid(false); announce('Key change cancelled.'); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') { setListening(null); setInvalid(false); announce('Key change cancelled.'); return; }
      const code = ['Backspace', 'Delete'].includes(event.code) ? null : event.code;
      const error = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        ? 'Use a single key without Shift, Ctrl, Alt, or Command.'
        : bindingError(bindings, listening.action, listening.slot, code);
      if (error) { setInvalid(true); announce(error, true, true); return; }
      const pair = [...bindings[listening.action]] as Keybindings[InputAction];
      pair[listening.slot] = code;
      const saved = onBindingsChange({ ...bindings, [listening.action]: pair });
      setListening(null); setInvalid(false);
      announce(storageNote(saved, 'Keybinding'));
    };
    const cancel = () => { setListening(null); setInvalid(false); announce('Key change cancelled.'); };
    window.addEventListener('keydown', capture, true);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', capture, true); window.removeEventListener('blur', cancel); };
    // announce is stable enough: it only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, bindings, onBindingsChange]);

  const changeGraphics = (next: GraphicsSettings, what: string) => {
    const saved = onGraphicsChange(next);
    announce(saved ? what : `${what} Browser storage is unavailable, so this lasts for the session.`);
  };
  const setRow = (row: SelectRow, value: string) => {
    const next = { ...graphics, [row.id]: row.id === 'frameLimit' ? Number(value) as FrameLimit : value } as GraphicsSettings;
    // Rows that wait for the next launch let the pending notice explain itself.
    if (row.later) { if (!onGraphicsChange(next)) announce('Browser storage is unavailable, so this change lasts for the session.'); return; }
    changeGraphics(next, row.id === 'frameLimit' && value === '0' ? 'Frame rate limit removed.' : `${row.label} set to ${optionLabel(row, value)}.`);
  };
  const preset = matchingPreset(graphics);
  const pending = launched ? [...GRAPHICS_COLUMNS.flat().flatMap(g => g.rows)].filter(row => row.later && launched[row.id as 'ocean' | 'terrain'] !== graphics[row.id]) : [];
  const renderSize = performance ? `${performance.width} × ${performance.height}` : '';
  const fpsClass = !performance ? 'fps' : performance.fps < 30 ? 'fps poor' : performance.fps < 50 ? 'fps strained' : 'fps';

  const status = (): ReactNode => {
    if (notice) return notice.text;
    if (section === 'keys') return listening ? `Press a key for ${INPUT_ACTIONS.find(entry => entry.id === listening.action)!.label.toLowerCase()}.` : 'Weapon groups follow the HUD order for each ship: main guns, secondaries, torpedoes, then depth charges. Bindings are saved in this browser.';
    if (section === 'graphics' && pending.length) {
      const names = pending.map(row => `${row.label}: ${optionLabel(row, graphics[row.id])}`).join(' and ');
      return inBattle ? `${names} applies when you return to port.` : <>{names} applies when the next battle starts. <button type="button" className="link-button" onClick={onReloadPort}>Reload port to apply now</button></>;
    }
    return { graphics: 'Changes apply immediately and are saved in this browser.', hud: 'HUD settings apply immediately, including during a battle.', sound: 'Sound settings apply immediately. Background tabs are silent.', keys: '' }[section];
  };
  const statusClass = `settings-status ${notice?.error ? 'error' : notice || (section === 'graphics' && pending.length) || (section === 'keys' && listening) ? '' : 'quiet'}`;

  const hudCurrent = Math.round(hudScale * 100);
  const preview = (width: number, height: number) => ({ width: `${width * hudScale}%`, height: `${height * hudScale}%` });
  const renderSelectRow = (row: SelectRow) => {
    const isPending = !!launched && row.later && launched[row.id as 'ocean' | 'terrain'] !== graphics[row.id];
    return <div className={`settings-row ${isPending ? 'pending' : ''}`} key={row.id}>
      <div className="label"><span id={`graphics-${row.id}-label`}>{row.label}</span><CostMeter cost={row.cost}/></div>
      <p className="hint">{row.later && <span className="setting-tag">{inBattle ? 'After battle' : 'Next battle'}</span>}<span>{row.hint}</span></p>
      <div className="control"><Select id={`graphics-${row.id}`} aria-labelledby={`graphics-${row.id}-label`} value={String(graphics[row.id])} onValueChange={value => setRow(row, value)}>
        {row.options.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}
      </Select></div>
    </div>;
  };

  return <dialog ref={dialog} className="pause-menu settings-dialog" aria-labelledby="settings-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="menu-heading">
      <h2 id="settings-title">Settings</h2>
      <div className="settings-sections" role="group" aria-label="Settings sections">
        <button aria-pressed={section === 'graphics'} onClick={() => showSection('graphics')}>Graphics</button>
        <button aria-pressed={section === 'hud'} onClick={() => showSection('hud')}>HUD</button>
        <button aria-pressed={section === 'keys'} onClick={() => showSection('keys')}>Keybindings</button>
        <button aria-pressed={section === 'sound'} onClick={() => showSection('sound')}>Sound</button>
      </div>
      <Button variant="icon" aria-label="Close settings" autoFocus onClick={onClose}><Icon name="close"/></Button>
    </div>
    <div className="settings-content">
      {section === 'graphics' ? <section aria-label="Graphics settings">
        <div className="graphics-head">
          <div className="preset-block">
            <div className="preset-rail" role="group" aria-label="Quality preset">
              {PRESET_ORDER.map(name => <button key={name} aria-pressed={preset === name} onClick={() => changeGraphics({ ...GRAPHICS_PRESETS[name] }, `${PRESET_LABEL[name]} preset applied.`)}>{PRESET_LABEL[name]}</button>)}
            </div>
            <div className="preset-state">{preset ? <span>{PRESET_NOTES[preset]}</span> : <><span><strong>Custom</strong> · from {PRESET_LABEL[nearestPreset(graphics)]}.</span><span>Your own mix of settings.</span></>}</div>
          </div>
          <div className="graphics-readout" role="status" aria-live="off" aria-label={performance ? `${performance.fps} frames per second, ${performance.frameMs.toFixed(1)} milliseconds per frame, rendering ${renderSize}` : 'Frame rate unavailable'}>
            <div className="graphics-readout-line">
              <span className={fpsClass}>{performance?.fps || '—'}</span><span className="unit">FPS</span>
              {performance && <><span className="detail">{performance.frameMs.toFixed(1)} ms</span><span className="detail">{renderSize}</span><span className="detail">{performance.backend === 'webgl' ? 'WebGL' : 'WebGPU'}</span></>}
            </div>
            <span className="note">{inBattle ? 'Measured in this battle while paused.' : 'Measured in port. A busy fleet action runs lower.'}</span>
          </div>
        </div>
        <div className="settings-columns">
          {GRAPHICS_COLUMNS.map((groups, column) => <div className="settings-column" key={column}><div className="settings-column-groups">
            {column === 0 && <div><h3>Display</h3>
              <div className="settings-row slider">
                <div className="label"><label htmlFor="graphics-renderScale">Render scale</label><CostMeter cost={3}/></div>
                <output className="value" htmlFor="graphics-renderScale">{graphics.renderScale}%{renderSize && ` · ${renderSize}`}</output>
                <Input id="graphics-renderScale" type="range" min={RENDER_SCALE_MIN} max={100} step={RENDER_SCALE_STEP} value={graphics.renderScale} aria-valuetext={`${graphics.renderScale} percent`}
                  onChange={event => changeGraphics({ ...graphics, renderScale: Number(event.target.value) }, `Render scale set to ${event.target.value}%.`)}/>
                <p className="hint"><span>Resolution of the sea and ships. Instruments and menus stay sharp.</span></p>
              </div>
              {groups[0].rows.map(renderSelectRow)}
            </div>}
            {column !== 0 && groups.map(({ group, rows }) => <div key={group}><h3>{group}</h3>{rows.map(renderSelectRow)}</div>)}
          </div></div>)}
        </div>
      </section> : section === 'hud' ? <section aria-label="HUD settings" className="two-columns">
        <div>
          <p className="settings-description">Size the battle instruments to suit your display. Changes apply immediately, including during a battle.</p>
          <div className="settings-row" style={{ marginTop: 6 }}>
            <div className="label"><span id="hud-mode-label">HUD scaling</span></div>
            <p className="hint"><span>{hudSettings.mode === 'auto' ? 'Adapts to your game window. Adjust the automatic size below.' : 'Keeps your chosen size when you resize the game window or move between displays.'}</span></p>
            <div className="control"><Select id="hud-mode" aria-labelledby="hud-mode-label" value={hudSettings.mode} onValueChange={value => announce(storageNote(onHudChange({ ...hudSettings, mode: value as HudSettings['mode'] }), 'HUD scaling'))}>
              <SelectOption value="auto">Automatic</SelectOption><SelectOption value="manual">Manual</SelectOption>
            </Select></div>
          </div>
          <div className="settings-row slider">
            <div className="label"><label htmlFor="hud-size">{hudSettings.mode === 'auto' ? 'Size adjustment' : 'HUD size'}</label></div>
            <output className="value" htmlFor="hud-size">{Math.round(hudSettings.scale * 100)}%</output>
            <Input id="hud-size" type="range" min="50" max="200" step="5" value={Math.round(hudSettings.scale * 100)} aria-valuetext={`${Math.round(hudSettings.scale * 100)} percent`}
              onChange={event => announce(storageNote(onHudChange({ ...hudSettings, scale: Number(event.target.value) / 100 }), 'HUD size'))}/>
            <p className="hint"><span>Scales instruments, the minimap, ship names and hit readouts. Menus keep their normal size.</span></p>
          </div>
          <p className="hud-scale-readout">Current HUD scale <strong>{hudCurrent}%</strong></p>
        </div>
        <div>
          <p className="settings-description">Instrument footprint at the current scale.</p>
          <div className="hud-preview" aria-hidden="true">
            <span className="caption">{hudCurrent}%</span><i className="sight"/>
            <i style={{ left: '1.5%', bottom: '2.5%', ...preview(15, 21) }}/>
            <i style={{ left: '50%', bottom: '2.5%', transform: 'translateX(-50%)', ...preview(21, 9) }}/>
            <i style={{ right: 0, bottom: 0, ...preview(20, 35.5) }}/>
          </div>
          <div className="note-list"><p>The automatic size fits a 1080p workspace and follows the window as you resize it or move between displays.</p><p>HUD settings are saved in this browser.</p></div>
        </div>
      </section> : section === 'sound' ? <section aria-label="Sound settings" className="two-columns">
        <div>
          <p className="settings-description">Balance the guns and instruments. Changes apply immediately.</p>
          <label className="settings-row checkbox audio-mute">Mute all sound<Input type="checkbox" checked={audioSettings.muted} onChange={event => announce(storageNote(onAudioChange({ ...audioSettings, muted: event.target.checked }), 'Sound'))}/></label>
          {([['master', 'Master volume'], ['effects', 'Guns & impacts'], ['interface', 'Controls & instruments']] as const).map(([key, label]) => <label className="audio-setting" key={key} htmlFor={`audio-volume-${key}`}>
            <span>{label}</span><output>{Math.round(audioSettings[key] * 100)}%</output>
            <Input id={`audio-volume-${key}`} type="range" min="0" max="100" step="1" value={Math.round(audioSettings[key] * 100)} aria-label={label} aria-valuetext={`${Math.round(audioSettings[key] * 100)} percent`} onChange={event => announce(storageNote(onAudioChange({ ...audioSettings, [key]: Number(event.target.value) / 100 }), label))}/>
          </label>)}
        </div>
        <div>
          <p className="settings-description">Preview sounds at the current levels.</p>
          <div className="audio-previews" role="group" aria-label="Preview sounds">
            <Button variant="secondary" data-sound="none" disabled={audioSettings.muted || audioSettings.master === 0 || audioSettings.interface === 0} onClick={() => onPreviewSound('ui-confirm')}>Test controls</Button>
            <Button variant="secondary" data-sound="none" disabled={audioSettings.muted || audioSettings.master === 0 || audioSettings.effects === 0} onClick={() => onPreviewSound('main-gun-a')}>Test gunfire</Button>
          </div>
          <div className="note-list"><p>Guns & impacts covers batteries, shell splashes, torpedo launches and hits. Controls & instruments covers menu clicks, the telegraph and alarms.</p><p>Sound settings are saved in this browser.</p></div>
        </div>
      </section> : <section aria-label="Keybindings">
        <p className="keybinding-instructions" id="keybinding-instructions">Select a binding, then press a key. Esc cancels a change. Delete clears a binding. Keep at least one key per action. Esc and Enter stay reserved for menus.</p>
        <div className="settings-columns">
          {(['Helm', 'Gunnery', 'View'] as const).map(group => <div className="settings-column keybinding-group" key={group}>
            <h3>{group}</h3>
            <div className="keybinding-columns" aria-hidden="true"><span>Action</span><span>Primary</span><span>Alternate</span></div>
            {INPUT_ACTIONS.filter(entry => entry.group === group).map(({ id, label }) => <div className="keybinding-row" key={id}>
              <span>{label}</span>
              {([0, 1] as const).map(slot => {
                const capturing = listening?.action === id && listening.slot === slot;
                return <button key={slot} className="keybinding-button" aria-pressed={capturing} aria-label={`${label}, ${slot === 0 ? 'primary' : 'alternate'}: ${keyLabel(bindings[id][slot])}`}
                  aria-describedby="keybinding-instructions" onClick={() => { setListening(capturing ? null : { action: id, slot }); setInvalid(false); setNotice(null); }}>
                  {capturing ? 'Press a key…' : bindings[id][slot] ? <kbd>{keyLabel(bindings[id][slot])}</kbd> : <span>Unbound</span>}
                </button>;
              })}
            </div>)}
          </div>)}
        </div>
        <div className="keybinding-fixed">
          <span>Pause / resume <kbd>Esc</kbd> <small>Always available</small></span>
          <span>Toggle binoculars <kbd>Shift</kbd> <small>Fixed control</small></span>
          <span>Hold for cursor <kbd>Ctrl</kbd> <small>Fixed control</small></span>
          <span><small>Move the mouse to aim; hold left mouse to fire. Right mouse also toggles binoculars. Scroll adjusts camera distance or magnification.</small></span>
        </div>
      </section>}
    </div>
    <footer className="settings-footer">
      <div className={statusClass} role="status" aria-live="polite">{status()}</div>
      {section === 'graphics' && <Button variant="secondary" disabled={preset === 'high'} onClick={() => changeGraphics({ ...GRAPHICS_PRESETS.high }, 'Graphics reset to High.')}>Reset graphics to High</Button>}
      {section === 'hud' && <Button variant="secondary" disabled={hudSettings.mode === DEFAULT_HUD.mode && hudSettings.scale === DEFAULT_HUD.scale} onClick={() => announce(storageNote(onHudChange({ ...DEFAULT_HUD }), 'HUD reset'))}>Reset HUD to automatic</Button>}
      {section === 'sound' && <Button variant="secondary" onClick={() => announce(storageNote(onAudioChange({ ...DEFAULT_AUDIO }), 'Sound defaults'))}>Reset sound to defaults</Button>}
      {section === 'keys' && <Button variant="secondary" onClick={() => {
        setListening(null); setInvalid(false);
        const saved = onBindingsChange(defaultKeybindings());
        announce(saved ? 'Default keybindings restored.' : 'Defaults restored for this session. Browser storage is unavailable.');
      }}>Reset keybindings to defaults</Button>}
      <Button variant="secondary" data-sound="back" onClick={onClose}>Back to menu <kbd>Esc</kbd></Button>
    </footer>
  </dialog>;
}

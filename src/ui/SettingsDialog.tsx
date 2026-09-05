import { useEffect, useRef, useState } from 'react';
import type { GameSettings } from '../game/types';
import { bindingError, defaultKeybindings, INPUT_ACTIONS, keyLabel, type InputAction, type Keybindings } from '../game/keybindings';
import { Icon } from './Icons';
import './SettingsDialog.css';

// Extends the naval pause menu: compact brass commands and labeled control rows.
// Graphics require a scene reload; keybindings apply immediately while play stays paused.
interface SettingsDialogProps {
  settings: GameSettings;
  bindings: Keybindings;
  onBindingsChange(bindings: Keybindings): boolean;
  onApply(settings: GameSettings): void;
  onClose(): void;
}

export function SettingsDialog({ settings, bindings, onBindingsChange, onApply, onClose }: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<'scene' | 'keys'>('scene');
  const [draft, setDraft] = useState(settings);
  const [listening, setListening] = useState<{ action: InputAction; slot: 0 | 1 } | null>(null);
  const [notice, setNotice] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!listening) return;
    const capture = (event: KeyboardEvent) => {
      if (event.code === 'Tab') { setListening(null); setInvalid(false); setNotice('Key change cancelled.'); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') { setListening(null); setInvalid(false); setNotice('Key change cancelled.'); return; }
      const code = ['Backspace', 'Delete'].includes(event.code) ? null : event.code;
      const error = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        ? 'Use a single key without Shift, Ctrl, Alt, or Command.'
        : bindingError(bindings, listening.action, listening.slot, code);
      if (error) { setInvalid(true); setNotice(error); return; }
      const pair = [...bindings[listening.action]] as Keybindings[InputAction];
      pair[listening.slot] = code;
      const saved = onBindingsChange({ ...bindings, [listening.action]: pair });
      setListening(null); setInvalid(false);
      setNotice(saved ? 'Keybinding saved.' : 'Keybinding applied for this session. Browser storage is unavailable.');
    };
    const cancel = () => { setListening(null); setInvalid(false); setNotice('Key change cancelled.'); };
    window.addEventListener('keydown', capture, true);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', capture, true); window.removeEventListener('blur', cancel); };
  }, [listening, bindings, onBindingsChange]);

  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  return <dialog ref={dialog} className="pause-menu settings-dialog" aria-labelledby="settings-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="menu-heading"><h2 id="settings-title">Settings</h2><button className="icon-button" aria-label="Close settings" autoFocus onClick={onClose}><Icon name="close"/></button></div>
    <div className="settings-sections" role="group" aria-label="Settings sections">
      <button aria-pressed={section === 'scene'} onClick={() => { setSection('scene'); setListening(null); }}>Graphics & sea</button>
      <button aria-pressed={section === 'keys'} onClick={() => setSection('keys')}>Keybindings</button>
    </div>
    <div className="settings-content">
      {section === 'scene' ? <section aria-label="Graphics and sea settings">
        <p className="settings-description">Prepare the scene for your next voyage.</p>
        <label className="setting-row">Ocean detail<select value={draft.quality} onChange={event => setDraft({ ...draft, quality: event.target.value as GameSettings['quality'] })}><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
        <label className="setting-row">Render scale<select value={draft.resolution} onChange={event => setDraft({ ...draft, resolution: Number(event.target.value) })}><option value={0.65}>65%</option><option value={0.8}>80%</option><option value={1}>100%</option></select></label>
        <label className="setting-row">Sea conditions<select value={draft.sea} onChange={event => setDraft({ ...draft, sea: event.target.value as GameSettings['sea'] })}><option>Fair</option><option>Atlantic</option><option>Heavy</option></select></label>
        <p className="settings-note">Applying these settings ends the current trial and reloads the scene in port. Lower detail or render scale can improve performance.</p>
        <button className="primary-button" disabled={!changed} onClick={() => onApply(draft)}>Apply & reload port <Icon name="arrow" size={17}/></button>
      </section> : <section aria-label="Keybindings">
        <p className="settings-description">Select a binding, then press a key. Changes apply immediately.</p>
        <p className="keybinding-instructions" id="keybinding-instructions">Esc cancels a change. Delete clears a binding. Keep at least one key per action. Esc, Tab and Enter stay reserved for menus.</p>
        <div className="keybinding-columns" aria-hidden="true"><span>Action</span><span>Primary</span><span>Alternate</span></div>
        {(['Helm', 'Gunnery', 'View'] as const).map(group => <div className="keybinding-group" key={group}>
          <h3>{group}</h3>
          {INPUT_ACTIONS.filter(entry => entry.group === group).map(({ id, label }) => <div className="keybinding-row" key={id}>
            <span>{label}</span>
            {([0, 1] as const).map(slot => {
              const capturing = listening?.action === id && listening.slot === slot;
              return <button key={slot} className="keybinding-button" aria-pressed={capturing} aria-label={`${label}, ${slot === 0 ? 'primary' : 'alternate'}: ${keyLabel(bindings[id][slot])}`}
                aria-describedby="keybinding-instructions" onClick={() => { setListening(capturing ? null : { action: id, slot }); setInvalid(false); setNotice(''); }}>
                {capturing ? 'Press a key…' : bindings[id][slot] ? <kbd>{keyLabel(bindings[id][slot])}</kbd> : <span>Unbound</span>}
              </button>;
            })}
          </div>)}
        </div>)}
        <div className="keybinding-fixed"><span>Pause / resume</span><kbd>Esc</kbd><span>Always available</span></div>
        <div className="keybinding-fixed"><span>Toggle binoculars</span><kbd>Shift</kbd><span>Fixed control</span></div>
        <div className="keybinding-fixed"><span>Hold for cursor</span><kbd>Ctrl</kbd><span>Fixed control</span></div>
        <p className="settings-note">Move the mouse to aim; hold left mouse to fire. Right mouse also toggles binoculars. Scroll adjusts camera distance or magnification.</p>
        <button className="secondary-button" onClick={() => {
          setListening(null); setInvalid(false);
          const saved = onBindingsChange(defaultKeybindings());
          setNotice(saved ? 'Default keybindings restored.' : 'Defaults restored for this session. Browser storage is unavailable.');
        }}>Reset keybindings to defaults</button>
      </section>}
    </div>
    <footer className="settings-footer">
      {section === 'keys' && <div className={`keybinding-status ${invalid ? 'keybinding-error' : ''}`} role="status" aria-live="polite">
        {listening && !invalid ? `Press a key for ${INPUT_ACTIONS.find(entry => entry.id === listening.action)!.label.toLowerCase()}.` : notice || 'Your bindings are saved in this browser.'}
      </div>}
      <button className="secondary-button" onClick={onClose}>Back to menu <kbd>Esc</kbd></button>
    </footer>
  </dialog>;
}

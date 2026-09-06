import { ENGINE_ORDERS, type HelmCommand } from '../simulation/ship';
import { INPUT_ACTIONS, loadKeybindings, type InputAction, type Keybindings } from './keybindings';

export interface InputActions {
  pause(): void;
  camera(): void;
  recenter(): void;
  hud(): void;
  fullscreen(): void;
  optics(): void;
  battery(battery: import('../ships/blueprint').Battery): void;
  cursor(released: boolean): void;
  chartSize(direction: number): void;
  gunnery(): void;
  shellFollow(): void;
}

export class InputController {
  order = 1;
  private keys = new Set<string>();
  private touchRudder = 0;
  private enabled = true;
  private shiftTap = false;
  private abort = new AbortController();
  private bindings: Keybindings;

  constructor(private actions: InputActions, bindings = loadKeybindings()) {
    this.bindings = bindings;
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', this.onDown, options);
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (this.enabled && this.shiftTap) this.actions.optics();
        this.shiftTap = false;
      }
      if (this.enabled && (e.code === 'ControlLeft' || e.code === 'ControlRight') && !this.keys.has('ControlLeft') && !this.keys.has('ControlRight')) this.actions.cursor(false);
    }, options);
    window.addEventListener('blur', () => this.clear(), options);
  }

  private onDown = (event: KeyboardEvent) => {
    // A tapped Shift opens optics; Shift used to type '+' only resizes the chart.
    if (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') this.shiftTap = false;
    // Downloads can leave focus on body while a native modal is still open.
    // Keep the game's shortcuts from cancelling the dialog's Escape or Tab handling.
    if (document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('dialog')) return;
    if (target instanceof HTMLElement && (target.matches('input, select, textarea, button') || target.isContentEditable)) {
      if (event.code !== 'Escape') return;
    }
    const key = event.code;
    if (event.metaKey || event.altKey) return;
    const action = INPUT_ACTIONS.find(({ id }) => this.bindings[id].includes(key))?.id;
    const shift = key === 'ShiftLeft' || key === 'ShiftRight';
    const control = key === 'ControlLeft' || key === 'ControlRight';
    // Ctrl releases the aiming cursor; Shift-plus remains a chart shortcut.
    if (event.ctrlKey && !control) return;
    if (event.shiftKey && !shift && action !== 'chartLarger' && action !== 'chartSmaller') return;
    if (action || key === 'Escape' || shift) event.preventDefault();
    if (!event.repeat) {
      if (key === 'Escape') this.actions.pause();
      if (action === 'hud') this.actions.hud();
      if (action === 'fullscreen') this.actions.fullscreen();
    }
    if (!this.enabled) return;
    this.keys.add(key);
    if (!event.repeat) {
      if (action === 'throttleUp') this.setOrder(this.order + 1);
      if (action === 'throttleDown') this.setOrder(this.order - 1);
      if (action === 'stop') this.setOrder(1);
      if (action === 'camera') this.actions.camera();
      if (action === 'recenter') this.actions.recenter();
      if (shift) this.shiftTap = true;
      if (control) this.actions.cursor(true);
      if (action === 'mainBattery') this.actions.battery('main');
      if (action === 'secondaryBattery') this.actions.battery('secondary');
      if (action === 'torpedoes') this.actions.battery('torpedo');
      if (action === 'depthCharges') this.actions.battery('depth-charge');
      if (action === 'chartLarger') this.actions.chartSize(1);
      if (action === 'chartSmaller') this.actions.chartSize(-1);
      if (action === 'gunnery') this.actions.gunnery();
      if (action === 'shellFollow') this.actions.shellFollow();
    }
  };

  setOrder(order: number): void { this.order = Math.max(0, Math.min(ENGINE_ORDERS.length - 1, Math.round(order))); }
  setRudder(rudder: number): void { this.touchRudder = rudder; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.clear(); }
  clear(): void { this.keys.clear(); this.touchRudder = 0; this.shiftTap = false; }
  setBindings(bindings: Keybindings): void { this.bindings = bindings; this.clear(); }
  private held(action: InputAction): boolean { return this.bindings[action].some(key => key !== null && this.keys.has(key)); }
  get firing(): boolean { return this.enabled && this.held('fire'); }
  sample(): HelmCommand {
    const left = this.held('port');
    const right = this.held('starboard');
    return { throttle: ENGINE_ORDERS[this.order], rudder: this.enabled ? (Number(right) - Number(left) || this.touchRudder) : 0 };
  }
  dispose(): void { this.abort.abort(); this.clear(); }
}

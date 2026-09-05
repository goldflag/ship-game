import { ENGINE_ORDERS, type HelmCommand } from '../simulation/ship';

export interface InputActions {
  pause(): void;
  camera(): void;
  recenter(): void;
  hud(): void;
  fullscreen(): void;
  optics(): void;
  battery(battery: 'main' | 'secondary'): void;
  cursor(released: boolean): void;
  chartSize(direction: number): void;
  gunnery(): void;
}

export class InputController {
  order = 1;
  private keys = new Set<string>();
  private touchRudder = 0;
  private enabled = true;
  private shiftTap = false;
  private abort = new AbortController();

  constructor(private actions: InputActions) {
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
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Escape', 'KeyC', 'KeyR', 'KeyH', 'KeyF', 'KeyQ', 'KeyG', 'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Minus', 'Equal', 'NumpadAdd', 'NumpadSubtract'].includes(key)) event.preventDefault();
    if (!event.repeat) {
      if (key === 'Escape') this.actions.pause();
      if (key === 'KeyH') this.actions.hud();
      if (key === 'KeyF') this.actions.fullscreen();
    }
    if (!this.enabled) return;
    this.keys.add(key);
    if (!event.repeat) {
      if (key === 'KeyW' || key === 'ArrowUp') this.setOrder(this.order + 1);
      if (key === 'KeyS' || key === 'ArrowDown') this.setOrder(this.order - 1);
      if (key === 'Space') this.setOrder(1);
      if (key === 'KeyC') this.actions.camera();
      if (key === 'KeyR') this.actions.recenter();
      if (key === 'ShiftLeft' || key === 'ShiftRight') this.shiftTap = true;
      if (key === 'Digit1') this.actions.battery('main');
      if (key === 'Digit2') this.actions.battery('secondary');
      if (key === 'ControlLeft' || key === 'ControlRight') this.actions.cursor(true);
      if (key === 'Equal' || key === 'NumpadAdd') this.actions.chartSize(1);
      if (key === 'Minus' || key === 'NumpadSubtract') this.actions.chartSize(-1);
      if (key === 'KeyG') this.actions.gunnery();
    }
  };

  setOrder(order: number): void { this.order = Math.max(0, Math.min(ENGINE_ORDERS.length - 1, Math.round(order))); }
  setRudder(rudder: number): void { this.touchRudder = rudder; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.clear(); }
  clear(): void { this.keys.clear(); this.touchRudder = 0; this.shiftTap = false; }
  get firing(): boolean { return this.enabled && this.keys.has('KeyQ'); }
  sample(): HelmCommand {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    return { throttle: ENGINE_ORDERS[this.order], rudder: this.enabled ? (Number(right) - Number(left) || this.touchRudder) : 0 };
  }
  dispose(): void { this.abort.abort(); this.clear(); }
}

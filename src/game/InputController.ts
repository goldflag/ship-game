import { ENGINE_ORDERS, type HelmCommand } from '../simulation/ship';
import { INPUT_ACTIONS, WEAPON_GROUP_ACTIONS, loadKeybindings, type InputAction, type Keybindings } from './keybindings';

export interface InputActions {
  pause(): void;
  camera(): void;
  recenter(): void;
  hud(): void;
  fullscreen(): void;
  optics(): void;
  weaponGroup(index: number): void;
  cursor(released: boolean): void;
  chartSize(direction: number): void;
  shellFollow(): void;
  shellType?(): void;
  depth?(direction: number): void;
  depthPreset?(depthM: number): void;
  emergencyBlow?(): void;
  periscope?(): void;
  airOperations?(): void;
  simulationSpeed?(): void;
  isSpectating?(): boolean;
  cycleSpectator?(direction: number): void;
}

export class InputController {
  order = 1;
  private keys = new Set<string>();
  rudderOrder = 0;
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
        if (this.shiftTap) this.actions.optics();
        this.shiftTap = false;
      }
      if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && !this.keys.has('ControlLeft') && !this.keys.has('ControlRight')) this.actions.cursor(false);
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
    if (this.enabled && !event.ctrlKey && !event.shiftKey && this.actions.isSpectating?.() && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      if (!event.repeat) this.actions.cycleSpectator?.(key === 'ArrowLeft' ? -1 : 1);
      return;
    }
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
      // Resizing the chart is a view control like the HUD toggle: it stays live
      // while the helm is not the player's, such as when following a teammate.
      if (action === 'chartLarger') this.actions.chartSize(1);
      if (action === 'chartSmaller') this.actions.chartSize(-1);
      // Simulation speed is the battle's clock, not the helm's: it answers while
      // following a captain or reading the fleet chart, like the chart size keys.
      if (action === 'simulationSpeed') this.actions.simulationSpeed?.();
      // Optics are a view control too: a spectator following a teammate raises the
      // same glasses without holding that ship's helm.
      if (shift) this.shiftTap = true;
      // So is the cursor: a follower's mouse steers the camera the way a helm's does,
      // and Ctrl hands the cursor back to the panels the same way.
      if (control) this.actions.cursor(true);
    }
    if (!this.enabled) return;
    this.keys.add(key);
    if (!event.repeat) {
      if (action === 'throttleUp') this.setOrder(this.order + 1);
      if (action === 'throttleDown') this.setOrder(this.order - 1);
      if (action === 'port') this.setRudder(this.rudderOrder - .5);
      if (action === 'starboard') this.setRudder(this.rudderOrder + .5);
      if (action === 'stop') this.setOrder(1);
      if (action === 'camera') this.actions.camera();
      if (action === 'recenter') this.actions.recenter();
      const weaponIndex = WEAPON_GROUP_ACTIONS.findIndex(id => id === action);
      if (weaponIndex >= 0) this.actions.weaponGroup(weaponIndex);
      if (action === 'shellFollow') this.actions.shellFollow();
      if (action === 'shellType') this.actions.shellType?.();
      if (action === 'dive') this.actions.depth?.(1);
      if (action === 'surface') this.actions.depthPreset?.(0);
      if (action === 'dive50') this.actions.depthPreset?.(50);
      if (action === 'rise') this.actions.depth?.(-1);
      if (action === 'periscope') this.actions.periscope?.();
      if (action === 'emergencyBlow') this.actions.emergencyBlow?.();
      if (action === 'airOperations') this.actions.airOperations?.();
    }
  };

  setOrder(order: number): void { this.order = Math.max(0, Math.min(ENGINE_ORDERS.length - 1, Math.round(order))); }
  setRudder(rudder: number): void { if (Number.isFinite(rudder)) this.rudderOrder = Math.max(-1, Math.min(1, Math.round(rudder * 2) / 2)); }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.clear(); }
  get isEnabled(): boolean { return this.enabled; }
  clear(): void { this.keys.clear(); this.shiftTap = false; }
  setBindings(bindings: Keybindings): void { this.bindings = bindings; this.clear(); }
  private held(action: InputAction): boolean { return this.bindings[action].some(key => key !== null && this.keys.has(key)); }
  get firing(): boolean { return this.enabled && this.held('fire'); }
  sample(): HelmCommand {
    return { throttle: ENGINE_ORDERS[this.order], rudder: this.enabled ? this.rudderOrder : 0 };
  }
  dispose(): void { this.abort.abort(); this.clear(); }
}

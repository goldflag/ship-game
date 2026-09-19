import { ENGINE_ORDERS } from './session/motion';
import { INPUT_ACTIONS, WEAPON_GROUP_ACTIONS, loadKeybindings, type InputAction, type Keybindings } from './keybindings';
import type { HelmCommand } from '../game/session/elements';

export interface InputActions {
  pause(): void;
  camera(): void;
  recenter(): void;
  /** The helm is idle in port, but its camera still answers the recenter key. */
  portHome?(): void;
  hud(): void;
  fullscreen(): void;
  optics(): void;
  weaponGroup(index: number): void;
  cursor(released: boolean): void;
  chartSize(direction: number): void;
  shellFollow(): void;
  shellType?(): void;
  rangefind?(): void;
  rangeLock?(): void;
  depth?(direction: number): void;
  depthPreset?(depthM: number): void;
  emergencyBlow?(): void;
  periscope?(): void;
  airOperations?(): void;
  simulationSpeed?(): void;
  isSpectating?(): boolean;
  cycleSpectator?(direction: number): void;
  /** The helm wheel is held open like binoculars: true on press, false on release. */
  helmWheel?(held: boolean): void;
  freeCamera?(): void;
}

export class InputController {
  order = 1;
  private keys = new Set<string>();
  rudderOrder = 0;
  private enabled = true;
  private helmHeld = false;
  private shiftTap = false;
  /** The free camera flies on the helm keys, so they stop reaching the ship while it is out. */
  private flying = false;
  private abort = new AbortController();
  private bindings: Keybindings;

  constructor(private actions: InputActions, bindings = loadKeybindings()) {
    this.bindings = bindings;
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', this.onDown, options);
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (this.bindings.helmWheel.includes(e.code)) this.actions.helmWheel?.(false);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (this.shiftTap) this.actions.optics();
        this.shiftTap = false;
      }
      if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && !this.keys.has('ControlLeft') && !this.keys.has('ControlRight')) this.actions.cursor(false);
    }, options);
    window.addEventListener('blur', () => { this.clear(); this.actions.helmWheel?.(false); }, options);
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
    if (event.shiftKey && !shift && !this.flying && action !== 'chartLarger' && action !== 'chartSmaller') return;
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
      if (shift && !this.flying) this.shiftTap = true;
      // So is the cursor: a follower's mouse steers the camera the way a helm's does,
      // and Ctrl hands the cursor back to the panels the same way.
      if (control) this.actions.cursor(true);
      // The helm wheel picks the next ship to command, so it answers while the
      // current helm is a captain's or already on the bottom.
      if (action === 'helmWheel') this.actions.helmWheel?.(true);
      // The free camera is a view as well: it leaves the ship's orders as they stand.
      if (action === 'freeCamera') this.actions.freeCamera?.();
    }
    if (this.flying) {
      this.keys.add(key);
      if (key === 'KeyE' || key === 'KeyQ') event.preventDefault();
      // Cycling or recentring the camera returns to the ship, as it does from a followed aircraft.
      if (!event.repeat && action === 'camera') this.actions.camera();
      if (!event.repeat && action === 'recenter') this.actions.recenter();
      return;
    }
    if (!this.enabled) { if (action === 'recenter' && !event.repeat) this.actions.portHome?.(); return; }
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
      if (action === 'rangefind') this.actions.rangefind?.();
      if (action === 'rangeLock') this.actions.rangeLock?.();
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
  /** `helmHeld` keeps the last rudder order standing while the keys belong to something
   * else, as the fleet chart of a custom battle does; otherwise a disabled helm centres. */
  setEnabled(enabled: boolean, helmHeld = false): void { this.enabled = enabled; this.helmHeld = helmHeld; this.clear(); }
  get isEnabled(): boolean { return this.enabled; }
  clear(): void { this.keys.clear(); this.shiftTap = false; }
  setBindings(bindings: Keybindings): void { this.bindings = bindings; this.clear(); }
  private held(action: InputAction): boolean { return this.bindings[action].some(key => key !== null && this.keys.has(key)); }
  setFlying(flying: boolean): void { if (flying !== this.flying) { this.flying = flying; this.clear(); } }
  get firing(): boolean { return this.enabled && !this.flying && this.held('fire'); }
  /** Free-camera travel in its own frame: x right, y up, z ahead, each −1..1. E and Q climb and sink. */
  get flight(): { x: number; y: number; z: number; fast: boolean } {
    const axis = (positive: boolean, negative: boolean) => this.flying ? +positive - +negative : 0;
    return {
      x: axis(this.held('starboard'), this.held('port')), y: axis(this.keys.has('KeyE'), this.keys.has('KeyQ')),
      z: axis(this.held('throttleUp'), this.held('throttleDown')), fast: this.flying && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
    };
  }
  sample(): HelmCommand {
    return { throttle: ENGINE_ORDERS[this.order], rudder: this.enabled || this.helmHeld ? this.rudderOrder : 0 };
  }
  dispose(): void { this.abort.abort(); this.clear(); }
}

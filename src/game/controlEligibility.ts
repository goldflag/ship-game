/** Presentation facts only: selection, camera focus and helm ownership are independent.
 * Optics and the helm wheel do not revoke eligibility: CameraRig owns optics and
 * holds mouse movement for the wheel while keyboard shortcuts remain available. */
export interface ControlState {
  paused: boolean;
  tacticalPause: boolean;
  inPort: boolean;
  waterReady: boolean;
  fleetCommand: boolean;
  hasHelm: boolean;
  chartOpen: boolean;
  chartTransitioning: boolean;
  inspecting: boolean;
  shellFollow: boolean;
  aircraftFollow: boolean;
  sunk: boolean;
}

/** Temporary loading and helm-release barriers must win even before the session
 * acknowledges a release. They suspend input, not camera or simulation time. */
export function controlEligibility(state: ControlState, inputSuspended = false) {
  const helm = !state.fleetCommand || state.hasHelm;
  const offChart = !state.chartOpen && !state.chartTransitioning;
  return {
    // Non-fleet spectators retain keyboard cycling; a carrier chart retains helm.
    inputEnabled: !inputSuspended && state.waterReady && !state.inPort && !state.paused && !state.tacticalPause
      && (!state.fleetCommand || (state.hasHelm && !state.chartOpen)),
    // Tactical pause and chart descent deliberately leave the camera live.
    rigEnabled: !state.paused && !state.chartOpen,
    viewAway: !helm || !offChart || state.inspecting || state.shellFollow || state.aircraftFollow,
    // Inspection and follows freeze the sight, but do not revoke gun authority.
    // Pause belongs to command dispatch/frame timing (online pause keeps ticking).
    gunsCommandable: helm && !state.sunk && offChart,
    capturePointer: !state.chartOpen,
    captureAfterChart: !state.paused && !state.chartOpen,
    captureAfterSpectate: (state.fleetCommand || !state.sunk) && !state.paused,
  };
}

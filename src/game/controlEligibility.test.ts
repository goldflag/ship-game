import { expect, test } from 'bun:test';
import { controlEligibility, type ControlState } from './controlEligibility';

const sailing: ControlState = {
  paused: false, tacticalPause: false, inPort: false, waterReady: true,
  fleetCommand: false, hasHelm: true, chartOpen: false, chartTransitioning: false,
  inspecting: false, shellFollow: false, aircraftFollow: false, freeCamera: false, sunk: false,
};
const controls = (patch: Partial<ControlState> = {}, suspended = false) => controlEligibility({ ...sailing, ...patch }, suspended);

test('loading barriers and port keep input idle without revoking the camera', () => {
  expect(controls({ waterReady: false }).inputEnabled).toBe(false);
  expect(controls({ inPort: true }).inputEnabled).toBe(false);
  expect(controls({}, true)).toMatchObject({ inputEnabled: false, rigEnabled: true });
  expect(controls().inputEnabled).toBe(true);
});

test('fleet chart, follow and confirmed helm are distinct control states', () => {
  const state = { ...sailing, fleetCommand: true, chartOpen: true, hasHelm: false };
  expect(controlEligibility(state)).toMatchObject({ inputEnabled: false, rigEnabled: false, viewAway: true, gunsCommandable: false });
  state.chartOpen = false; state.chartTransitioning = true;
  expect(controlEligibility(state)).toMatchObject({ inputEnabled: false, rigEnabled: true, viewAway: true, captureAfterSpectate: true });
  state.chartTransitioning = false;
  // Following or selecting a hull cannot grant helm authority.
  expect(controlEligibility(state)).toMatchObject({ inputEnabled: false, gunsCommandable: false });
  state.hasHelm = true;
  expect(controlEligibility(state)).toMatchObject({ inputEnabled: true, viewAway: false, gunsCommandable: true });
  // A release is locally suspended before the session acknowledges it.
  expect(controlEligibility(state, true).inputEnabled).toBe(false);
});

test('carrier chart retains keyboard helm; descent restores camera before sight and fire', () => {
  expect(controls({ chartOpen: true })).toMatchObject({ inputEnabled: true, rigEnabled: false, viewAway: true, gunsCommandable: false, capturePointer: false });
  expect(controls({ chartTransitioning: true })).toMatchObject({ inputEnabled: true, rigEnabled: true, viewAway: true, gunsCommandable: false, captureAfterChart: true });
  expect(controls()).toMatchObject({ viewAway: false, gunsCommandable: true });
});

test('inspection, shell and aircraft follows freeze sight without revoking fire authority', () => {
  for (const mode of ['inspecting', 'shellFollow', 'aircraftFollow'] as const) {
    expect(controls({ [mode]: true })).toMatchObject({ viewAway: true, gunsCommandable: true, inputEnabled: true });
    expect(controls({ [mode]: false })).toMatchObject({ viewAway: false, gunsCommandable: true });
  }
});

test('pause inhibits input and camera, tactical pause inhibits only input, neither redefines gun authority', () => {
  // Online pause keeps simulation ticking; explicit fire() separately checks pause.
  expect(controls({ paused: true })).toMatchObject({ inputEnabled: false, rigEnabled: false, gunsCommandable: true, captureAfterChart: false });
  expect(controls({ fleetCommand: true, tacticalPause: true })).toMatchObject({ inputEnabled: false, rigEnabled: true, gunsCommandable: true });
  expect(controls({ paused: true, chartTransitioning: true })).toMatchObject({ rigEnabled: false, gunsCommandable: false });
});

test('sunk custom spectators retain keyboard cycling and cursor; fleet spectators can capture', () => {
  expect(controls({ sunk: true })).toMatchObject({ inputEnabled: true, gunsCommandable: false, captureAfterSpectate: false });
  expect(controls({ sunk: true, fleetCommand: true, hasHelm: false })).toMatchObject({ inputEnabled: false, captureAfterSpectate: true });
  expect(controls({ sunk: true, fleetCommand: true, paused: true }).captureAfterSpectate).toBe(false);
});

test('the free camera holds the sight where it was without revoking the guns or the helm', () => {
  expect(controls({ freeCamera: true })).toMatchObject({ inputEnabled: true, rigEnabled: true, viewAway: true, gunsCommandable: true });
});

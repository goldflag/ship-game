/**
 * Complete no-op stand-ins for the services a test-built `Game` needs.
 *
 * Tests assemble a `Game` with `Object.create(Game.prototype)` and assign only the
 * collaborators they exercise. Hand-rolled partial literals break at runtime, in many
 * files at once, whenever `Game` starts calling one more method. Each factory here is
 * typed against the real class's whole public surface, so adding a public member to
 * `CameraRig`, `InputController` or `BattlefieldCamera` fails to compile in this one
 * file. Add the member's inert default below and every test keeps running.
 *
 * Pass `overrides` for the members a test observes. Extra fields (a counter, a private
 * name the test reads back) are kept and typed on the result; methods may use `this`.
 */
import { Group, PerspectiveCamera } from 'three/webgpu';
import type { BattlefieldCamera } from '../BattlefieldCamera';
import type { CameraRig } from '../CameraRig';
import type { InputController } from '../InputController';
import { VisualEnvironment } from '../VisualEnvironment';

/** The public members of a class, writable so a fake can stand in for getters with plain values. */
export type PublicSurface<T> = { -readonly [K in keyof T]: T[K] };
export type TestRig = PublicSurface<CameraRig>;
export type TestInput = PublicSurface<InputController>;
export type TestBattlefieldCamera = PublicSurface<BattlefieldCamera>;

/** Getters and `this`-using methods in `overrides` survive, which `Object.assign` would flatten. */
function withOverrides<Base extends object, Extra extends object>(base: Base, overrides?: Extra): Base & Extra {
  if (overrides) Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
  return base as Base & Extra;
}

export function makeTestRig<Extra extends object = object>(overrides?: Partial<TestRig> & Extra): TestRig & Extra {
  const rig: TestRig = {
    camera: new PerspectiveCamera(),
    mode: 'Chase',
    binoculars: false,
    freeCamera: false,
    pointerLocked: false,
    firing: false,
    magnification: 1,
    bearing: 0,
    rangeAim: undefined,
    freeCameraSpeed: 0,
    setBridge() {},
    setSubmarine() {},
    setGunScope() {},
    setTorpedoView() {},
    setRangeLock() {},
    setShellView() {},
    setFreeCamera() {},
    setFreeMove() {},
    capturePointer() {},
    releasePointer() {},
    setEnabled() {},
    setHeld() {},
    setInspecting() {},
    exitBinoculars() {},
    toggleBinoculars() {},
    aimAt() {},
    cycle() {},
    portHome() {},
    recenter() {},
    setInPort() {},
    setHullLength() {},
    setBattleTerrain() {},
    update() {},
    dispose() {},
  };
  return withOverrides(rig, overrides);
}

export function makeTestInput<Extra extends object = object>(overrides?: Partial<TestInput> & Extra): TestInput & Extra {
  const input: TestInput = {
    order: 1,
    rudderOrder: 0,
    isEnabled: true,
    firing: false,
    flight: { x: 0, y: 0, z: 0, fast: false },
    setOrder() {},
    setRudder() {},
    setEnabled() {},
    clear() {},
    setBindings() {},
    setFlying() {},
    sample: () => ({ throttle: 0, rudder: 0 }),
    dispose() {},
  };
  return withOverrides(input, overrides);
}

export function makeTestBattlefieldCamera<Extra extends object = object>(
  overrides?: Partial<TestBattlefieldCamera> & Extra,
): TestBattlefieldCamera & Extra {
  const camera: TestBattlefieldCamera = {
    view: { x: 0, z: 0, radius: 8000 },
    transitioning: false,
    beginTransition() {},
    cancelTransition() {},
    applyTransition() {},
    enter() {},
    exit() {},
    fit() {},
    pan() {},
    zoom() {},
    setTilt() {},
    orbit() {},
    resetAngle() {},
    update() {},
  };
  return withOverrides(camera, overrides);
}

/** The real environment over inert effects, smoke and sun anchor: no renderer, water or sky. */
export function makeTestEnvironment(): VisualEnvironment {
  return new VisualEnvironment({
    effects: { setWind() {}, setSun() {}, setIllumination() {} },
    funnelSmoke: { setWind() {} },
    sunAnchor: new Group(),
  });
}

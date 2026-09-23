import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { localToWorld } from './geometry';
import type { SubmarineDefinition, Vec3 } from '../ships/blueprint';
import { terrainHeight } from './HarborTerrain';
import type { ShellView } from './ShellFollow';
import type { ShipState } from '../game/session/elements';

export type CameraMode = 'Chase' | 'Bridge' | 'Tactical';
const NORMAL_FOV = 52;
const MIN_MAGNIFICATION = 1, MAX_MAGNIFICATION = 32, DEFAULT_SCOPE_MAGNIFICATION = 2;
const MAX_DOWNWARD_TILT = Math.PI / 2 - .015;
/** Lowest chase orbit (about 7°), where the camera rides while aiming toward the horizon. */
const MIN_ORBIT_ELEVATION = .12;
/** Torpedoes are laid on wedges drawn on the sea: the chase view climbs until the water fills the lower half of the frame. */
const TORPEDO_ORBIT_ELEVATION = .38;
const MAX_UPWARD_TILT = Math.PI / 6;
/** Binoculars look from this far above the bridge, the same at every range, for a little more look-down on the sea. */
const SCOPE_EYE_HEIGHT = 30;
const CAMERA_CLEARANCE = 12;
const PORT_ELEVATION = .2;
const PORT_AIM_DROP = .148;
/** Port orbit range for a 250 m hull: close enough to read a fitting, far enough to see her whole from any side. */
const PORT_MIN_DISTANCE = 20;
const PORT_MAX_DISTANCE = 1200;
const PORT_MAX_ELEVATION = 1.35;
const FOLLOW_DISTANCE = Math.hypot(45, 12, 12);
const FOLLOW_AZIMUTH = Math.atan2(12, 45);
const FOLLOW_ELEVATION = Math.atan2(12, Math.hypot(45, 12));
const POINTER_LOCK_RETRY_MS = 1000;
const FREE_SPEED = 120, FREE_MIN_SPEED = 5, FREE_MAX_SPEED = 3000, FREE_FAST = 4;
const FREE_MAX_TILT = Math.PI / 2 - .02;

export class CameraRig {
  mode: CameraMode = 'Chase';
  binoculars = false;
  private scopeMagnification = DEFAULT_SCOPE_MAGNIFICATION;
  private lockedRangeM?: number;
  private torpedoView = false;
  private chaseFloor = MIN_ORBIT_ELEVATION;
  private displayedDistance = 345;
  private opticsTransition?: { offset: Vector3; aim?: Vec3; elapsed: number };
  private readonly motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  private get reducedMotion(): boolean { return this.motionPreference?.matches ?? false; }
  private azimuth = .82;
  private elevation = .1;
  private distance = 345;
  private hullScale = 1;
  private hullLength = 250.5;
  private submarine?: SubmarineDefinition;
  private portHullScale = 1;
  private dragging = false;
  /** Port only: a right-drag (or a modified left-drag) trucks the view across the ship, as in the shipbuilder. */
  private panning = false;
  /** World offset the port pan adds to the aim point and the orbit alike. */
  private portPan = new Vector3();
  private panStep = new Vector3();
  private panAxis = new Vector3();
  private inPort = false;
  private enabled = true;
  /** A held overlay (the helm wheel) reads the mouse itself: the view holds still and clicks do not fire. */
  private held = false;
  private inspecting = false;
  private pointerId = -1;
  private previous = { x: 0, y: 0 };
  private target = new Vector3();
  private desired = new Vector3();
  private look = new Vector3();
  private lastShip?: ShipState;
  private followedPosition = new Vector3();
  private followedShipId?: string;
  private abort = new AbortController();
  private mouseFire = false;
  private lockRequest?: { startedAt: number };
  private intentionalUnlock = false;
  private shellView?: ShellView;
  private returnBinoculars = false;
  private shellDirection = new Vector3();
  private shellRight = new Vector3();
  private shellUp = new Vector3();
  private followAzimuth = FOLLOW_AZIMUTH;
  private followElevation = FOLLOW_ELEVATION;
  private followDistance = FOLLOW_DISTANCE;
  /** The free camera leaves the ship and flies on its own heading; the ship's sight angles wait for its return. */
  freeCamera = false;
  private freeAzimuth = 0;
  private freeElevation = 0;
  private freeSpeed = FREE_SPEED;
  private freeMove = { x: 0, y: 0, z: 0, fast: false };
  private aimLockHeld = false;

  constructor(readonly camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private bridge: Vec3 = [0, 29, -31],
    private actions: { pause(): void; aim(): void; aimLock(held: boolean): void } = { pause() {}, aim() {}, aimLock() {} }) {
    const options = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled || this.held || (e.button !== 0 && e.button !== 2)) return;
      const detached = !!this.shellView || this.freeCamera;
      if (detached && this.pointerLocked) return;
      if (!detached && !this.inPort && !this.inspecting && e.pointerType === 'mouse') {
        if (!this.pointerLocked) { this.capturePointer(); return; }
        if (e.button === 0) this.mouseFire = true;
        // Held right mouse keeps the guns on their point while the view looks elsewhere.
        if (e.button === 2) this.holdAimLock(true);
        return;
      }
      this.dragging = true; this.pointerId = e.pointerId;
      this.panning = this.inPort && (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey);
      this.previous = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    }, options);
    canvas.addEventListener('pointermove', e => {
      if (!this.enabled || this.held) return;
      const locked = this.pointerLocked;
      if (!locked && (!this.dragging || e.pointerId !== this.pointerId)) return;
      const dx = locked ? e.movementX : e.clientX - this.previous.x;
      const dy = locked ? e.movementY : e.clientY - this.previous.y;
      if (this.freeCamera) {
        this.freeAzimuth += dx * .0025;
        this.freeElevation = MathUtils.clamp(this.freeElevation + dy * .0025, -FREE_MAX_TILT, FREE_MAX_TILT);
      } else if (this.shellView) {
        this.followAzimuth = MathUtils.euclideanModulo(this.followAzimuth - dx * .005, Math.PI * 2);
        this.followElevation = MathUtils.clamp(this.followElevation + dy * .004, -Math.PI / 2 + .06, Math.PI / 2 - .06);
      } else if (this.inPort && this.panning) {
        this.panPort(dx, dy);
      } else if (this.inPort || this.inspecting) {
        this.azimuth -= dx * .005;
        this.elevation = MathUtils.clamp(this.elevation + dy * .003, this.inPort ? -PORT_MAX_ELEVATION : -MAX_UPWARD_TILT, PORT_MAX_ELEVATION);
      } else {
        // Angular sensitivity follows the visible field of view at every magnification.
        const sensitivity = .0025 * Math.tan(this.camera.fov * Math.PI / 360) / Math.tan(NORMAL_FOV * Math.PI / 360);
        this.azimuth += dx * sensitivity;
        if (this.lockedRangeM === undefined) this.elevation = MathUtils.clamp(this.elevation + dy * sensitivity, -MAX_UPWARD_TILT, MAX_DOWNWARD_TILT);
        if (dx || dy) { if (this.opticsTransition) this.opticsTransition.aim = undefined; this.actions.aim(); }
      }
      this.previous = { x: e.clientX, y: e.clientY };
    }, options);
    const release = (e?: Event) => {
      // With the pointer captured each mouse button lets go of its own hold: firing continues under a released aim lock.
      const button = e?.type === 'pointerup' && this.pointerLocked ? (e as PointerEvent).button : undefined;
      if (button === undefined || button === 2) this.holdAimLock(false);
      if (button === undefined || button === 0) this.mouseFire = false;
      if (button === undefined) { this.dragging = false; this.panning = false; }
    };
    window.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    document.addEventListener('pointerlockchange', () => {
      this.lockRequest = undefined;
      if (this.pointerLocked) {
        if (!this.enabled || this.inPort || this.inspecting || this.intentionalUnlock) this.releasePointer();
      } else {
        release();
        if (!this.intentionalUnlock && this.enabled && !this.inPort && !this.inspecting) this.actions.pause();
      }
    }, options);
    document.addEventListener('pointerlockerror', () => { this.lockRequest = undefined; }, options);
    window.addEventListener('blur', release, options);
    canvas.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.canvas.clientHeight || 800 : 1);
      if (this.freeCamera) this.freeSpeed = MathUtils.clamp(this.freeSpeed * Math.exp(-delta * .001), FREE_MIN_SPEED, FREE_MAX_SPEED);
      else if (this.shellView) this.followDistance = MathUtils.clamp(this.followDistance * Math.exp(delta * .001), 12, 800);
      else if (this.binoculars) this.scopeMagnification = MathUtils.clamp(this.scopeMagnification * Math.exp(-delta * .0015), MIN_MAGNIFICATION, MAX_MAGNIFICATION);
      else this.distance = MathUtils.clamp(this.distance * Math.exp(delta * .001), (this.inPort ? PORT_MIN_DISTANCE : 45) * this.distanceScale, this.inPort ? PORT_MAX_DISTANCE * this.portHullScale : 1400 * this.hullScale);
    }, { ...options, passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault(), options);
    // The port camera roams without limits, so double-click always finds the ship again.
    canvas.addEventListener('dblclick', () => { if (this.enabled) this.portHome(); }, options);
  }

  setBridge(bridge: Vec3 = [0, 29, -31]): void { this.bridge = bridge; }
  setSubmarine(equipment?: SubmarineDefinition): void { this.submarine = equipment; }

  get pointerLocked(): boolean { return document.pointerLockElement === this.canvas; }
  get firing(): boolean { return this.enabled && !this.shellView && !this.freeCamera && this.pointerLocked && this.mouseFire; }
  private holdAimLock(held: boolean): void {
    if (held === this.aimLockHeld) return;
    this.aimLockHeld = held;
    this.actions.aimLock(held);
  }
  get magnification(): number { return Math.tan(NORMAL_FOV * Math.PI / 360) / Math.tan(this.camera.fov * Math.PI / 360); }
  /** The view is still easing to where it was sent: an optics glide (about 0.42 s), a lens or zoom change, the torpedo lift or the port orbit. */
  get transitioning(): boolean {
    const floor = this.torpedoView && this.mode === 'Chase' ? TORPEDO_ORBIT_ELEVATION : MIN_ORBIT_ELEVATION;
    return !!this.opticsTransition || Math.abs(this.magnification / (this.binoculars ? this.scopeMagnification : 1) - 1) > 1e-3
      || Math.abs(this.displayedDistance / this.distance - 1) > 1e-3
      || (!this.inPort && !this.inspecting && this.mode === 'Chase' && !this.binoculars && Math.abs(this.chaseFloor - floor) > 1e-3)
      || ((this.inPort || this.inspecting) && this.camera.position.distanceTo(this.desired) > .05);
  }
  get bearing(): number { return ((this.azimuth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); }

  /** Raise the lowest chase orbit while the torpedo sight is up. */
  setTorpedoView(on: boolean): void { this.torpedoView = on; }

  setRangeLock(rangeM?: number): void {
    if (rangeM !== undefined && (!Number.isFinite(rangeM) || rangeM <= 0)) return;
    if (rangeM !== undefined && this.lockedRangeM === undefined) this.opticsTransition = undefined;
    this.lockedRangeM = rangeM;
  }
  /** Horizontal range from the controlled hull; bearing remains the player's. */
  get rangeAim(): Vec3 | undefined {
    const ship = this.lastShip;
    return this.binoculars && !this.shellView && ship && this.lockedRangeM !== undefined
      ? [ship.x + Math.sin(this.azimuth) * this.lockedRangeM, .5, ship.z - Math.cos(this.azimuth) * this.lockedRangeM] : undefined;
  }

  setShellView(view?: ShellView): void {
    if (!!view !== !!this.shellView) {
      this.opticsTransition = undefined;
      this.dragging = false; this.mouseFire = false;
      if (view) {
        this.returnBinoculars = this.binoculars; this.binoculars = false;
        this.followAzimuth = FOLLOW_AZIMUTH; this.followElevation = FOLLOW_ELEVATION; this.followDistance = FOLLOW_DISTANCE;
        this.shellRight.set(1, 0, 0);
      }
      else { this.binoculars = this.returnBinoculars; this.followedShipId = undefined; }
      this.updateProjection();
    }
    this.shellView = view;
  }

  /** Leave the ship where the view stands, or return to it with the optics the flight interrupted. */
  setFreeCamera(free: boolean): void {
    if (free === this.freeCamera) return;
    this.freeCamera = free;
    this.opticsTransition = undefined;
    this.dragging = false; this.mouseFire = false; this.holdAimLock(false);
    if (free) {
      this.returnBinoculars = this.binoculars; this.binoculars = false;
      this.camera.getWorldDirection(this.look);
      this.freeAzimuth = Math.atan2(this.look.x, -this.look.z);
      this.freeElevation = MathUtils.clamp(-Math.asin(MathUtils.clamp(this.look.y, -1, 1)), -FREE_MAX_TILT, FREE_MAX_TILT);
    } else { this.binoculars = this.returnBinoculars; this.followedShipId = undefined; }
    this.updateProjection();
  }
  /** Travel for the next frame in the camera's own frame: x right, y up, z ahead. */
  setFreeMove(move: { x: number; y: number; z: number; fast: boolean }): void { this.freeMove = move; }
  get freeCameraSpeed(): number { return this.freeSpeed; }

  capturePointer(): void {
    if (!this.enabled || this.inPort || this.inspecting || this.pointerLocked || !this.canvas.requestPointerLock || !window.matchMedia('(pointer: fine)').matches) return;
    // Suppress duplicate requests, but let a fresh gesture recover if the browser
    // never reports completion. No timer automatically recaptures the cursor.
    const now = performance.now();
    if (this.lockRequest && now - this.lockRequest.startedAt < POINTER_LOCK_RETRY_MS) return;
    const pending = this.lockRequest = { startedAt: now };
    const finish = () => { if (this.lockRequest === pending) this.lockRequest = undefined; };
    this.intentionalUnlock = false;
    try {
      this.canvas.focus({ preventScroll: true });
      // Older implementations return void; current browsers return a promise.
      const request = this.canvas.requestPointerLock() as Promise<void> | undefined;
      request?.then(finish, finish);
    } catch { finish(); }
  }
  releasePointer(): void {
    this.intentionalUnlock = true;
    this.lockRequest = undefined;
    this.mouseFire = false;
    if (this.pointerLocked) document.exitPointerLock();
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) { this.dragging = false; this.releasePointer(); }
  }
  /** Hold the view still while an overlay owns the mouse; the pointer stays captured. */
  setHeld(held: boolean): void {
    this.held = held;
    if (held) { this.dragging = false; this.mouseFire = false; this.holdAimLock(false); }
  }
  setInspecting(inspecting: boolean): void {
    this.setShellView(); this.setFreeCamera(false);
    this.inspecting = inspecting;
    this.binoculars = false;
    this.updateProjection();
    if (inspecting) this.releasePointer();
    this.recenter();
  }
  private updateProjection(dt = 0, snap = true): void {
    const target = this.binoculars ? this.scopeMagnification : 1;
    const lens = snap || this.reducedMotion ? target : Math.exp(MathUtils.lerp(Math.log(this.magnification), Math.log(target), 1 - Math.exp(-12 * dt)));
    this.camera.fov = 2 * Math.atan(Math.tan(NORMAL_FOV * Math.PI / 360) / lens) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }
  exitBinoculars(): void {
    this.setRangeLock();
    this.returnBinoculars = false;
    if (!this.binoculars) return;
    this.binoculars = false;
    this.opticsTransition = undefined;
    this.updateProjection();
  }
  toggleBinoculars(aim: Vec3, ship: ShipState): void {
    if (this.inPort || this.inspecting) return;
    const position = this.camera.position.clone(), orientation = this.camera.quaternion.clone(), fov = this.camera.fov;
    this.opticsTransition = undefined;
    this.binoculars = !this.binoculars;
    if (this.binoculars) this.scopeMagnification = DEFAULT_SCOPE_MAGNIFICATION;
    else this.setRangeLock();
    this.aimAt(aim, ship);
    if (!this.reducedMotion) {
      this.opticsTransition = { offset: position.clone().sub(this.camera.position), aim: [...aim], elapsed: 0 };
      this.camera.position.copy(position); this.camera.quaternion.copy(orientation);
      this.camera.fov = fov; this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    }
  }
  aimAt(aim: Vec3, ship: ShipState): void {
    this.azimuth = Math.atan2(aim[0] - ship.x, ship.z - aim[2]);
    this.update(ship, ship.y, 0, true);
    // Orbit height depends on pitch; solve position and sight together.
    for (let i = 0; i < 8; i++) {
      const delta = new Vector3(...aim).sub(this.camera.position);
      this.azimuth = Math.atan2(delta.x, -delta.z);
      this.elevation = Math.atan2(-delta.y, Math.hypot(delta.x, delta.z));
      this.update(ship, ship.y, 0, true);
    }
  }
  cycle(): void {
    this.setRangeLock();
    const modes: CameraMode[] = ['Chase', 'Bridge', 'Tactical'];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.binoculars = false;
    this.updateProjection();
    this.recenter();
  }
  /** Slide the port view in the screen plane so the hull follows the pointer. Unbounded, as in the shipbuilder: recentring finds the ship again. */
  private panPort(dx: number, dy: number): void {
    const distance = this.displayedDistance * Math.max(1, 1.1 / this.camera.aspect);
    const perPixel = 2 * Math.tan(this.camera.fov * Math.PI / 360) * distance / (this.canvas.clientHeight || 800);
    const before = this.panStep.copy(this.portPan);
    this.portPan.addScaledVector(this.panAxis.setFromMatrixColumn(this.camera.matrixWorld, 0), -dx * perPixel)
      .addScaledVector(this.panAxis.setFromMatrixColumn(this.camera.matrixWorld, 1), dy * perPixel);
    // Truck the camera with the aim, so the view slides instead of swinging while the orbit eases.
    this.camera.position.add(before.subVectors(this.portPan, before));
  }
  /** Back to the port's opening view of the ship: pan, orbit and zoom. */
  portHome(): void {
    if (!this.inPort) return;
    this.recenter();
    this.distance = 325 * this.distanceScale;
  }
  recenter(): void {
    this.opticsTransition = undefined;
    this.portPan.set(0, 0, 0);
    this.azimuth = this.inPort || this.inspecting ? 1.08 : this.lastShip?.heading ?? 0;
    this.elevation = this.inPort || this.inspecting ? PORT_ELEVATION : this.mode === 'Tactical' ? .85 : this.mode === 'Bridge' ? .025 : .1;
  }
  setInPort(inPort: boolean): void {
    this.setRangeLock();
    this.setShellView(); this.setFreeCamera(false);
    this.inPort = inPort;
    this.inspecting = false;
    this.followedShipId = undefined;
    this.mode = 'Chase';
    this.binoculars = false;
    this.updateProjection();
    this.azimuth = inPort ? 1.08 : .82;
    this.elevation = inPort ? PORT_ELEVATION : .1;
    this.distance = this.displayedDistance = (inPort ? 325 : 345) * this.distanceScale;
    this.portPan.set(0, 0, 0); this.panning = false;
    this.opticsTransition = undefined;
    this.releasePointer();
  }
  /** Preserve relative zoom and orbit when switching between differently sized hulls. */
  setHullLength(length: number): void {
    // Another hull starts framed on herself; the orbit and relative zoom carry over.
    if (length !== this.hullLength) this.portPan.set(0, 0, 0);
    this.hullLength = length;
    const previousScale = this.distanceScale;
    // Port framing follows the actual hull size, including boats below the
    // combat camera's minimum scale. Water/terrain clearance is applied later.
    this.portHullScale = length / 250.5;
    this.hullScale = MathUtils.clamp(this.portHullScale, .35, 1.5);
    this.distance *= this.distanceScale / previousScale;
    this.displayedDistance *= this.distanceScale / previousScale;
  }
  private get distanceScale(): number { return this.inPort ? this.portHullScale : this.hullScale; }
  private battleTerrain: (x: number, z: number) => number = () => 0;
  setBattleTerrain(height: (x: number, z: number) => number): void { this.battleTerrain = height; }
  private constrainCameraHeight(position: Vector3): void {
    const ground = this.inPort ? Math.max(0, terrainHeight(position.x, position.z)) : Math.max(0, this.battleTerrain(position.x, position.z));
    // Port looks at the hull from anywhere, including beneath her keel; only the harbor's land stays solid.
    if (ground === 0 && this.inPort) return;
    if (ground === 0 && this.submarine && !this.shellView && (this.mode !== 'Tactical' || this.inspecting)) return;
    position.y = Math.max(position.y, ground + CAMERA_CLEARANCE);
  }
  update(ship: ShipState, height: number, dt: number, snap = false): void {
    this.lastShip = ship;
    this.updateProjection(dt, snap);
    this.displayedDistance = snap || this.reducedMotion ? this.distance : MathUtils.lerp(this.displayedDistance, this.distance, 1 - Math.exp(-12 * dt));
    if (this.freeCamera) {
      const cos = Math.cos(this.freeElevation), { x, y, z, fast } = this.freeMove;
      this.look.set(Math.sin(this.freeAzimuth) * cos, -Math.sin(this.freeElevation), -Math.cos(this.freeAzimuth) * cos);
      const step = this.freeSpeed * (fast ? FREE_FAST : 1) * dt;
      this.camera.position.addScaledVector(this.look, z * step);
      this.camera.position.x += Math.cos(this.freeAzimuth) * x * step;
      this.camera.position.z += Math.sin(this.freeAzimuth) * x * step;
      this.camera.position.y += y * step;
      // The sea is open above and below; only land stays solid.
      const ground = this.battleTerrain(this.camera.position.x, this.camera.position.z);
      if (ground > 0) this.camera.position.y = Math.max(this.camera.position.y, ground + 2);
      this.camera.lookAt(this.look.add(this.camera.position));
      this.camera.updateMatrixWorld();
      return;
    }
    if (this.shellView) {
      this.target.fromArray(this.shellView.position);
      this.shellDirection.fromArray(this.shellView.velocity).normalize();
      if (this.shellDirection.lengthSq() === 0) this.shellDirection.set(0, 0, -1);
      // Keep a stable frame through steep/vertical flight, independent of the
      // ship's saved aiming angles. Translation follows the target exactly.
      if (Math.hypot(this.shellDirection.x, this.shellDirection.z) > .001) this.shellRight.set(-this.shellDirection.z, 0, this.shellDirection.x).normalize();
      this.shellUp.crossVectors(this.shellRight, this.shellDirection).normalize();
      const radius = Math.cos(this.followElevation) * this.followDistance;
      this.camera.position.copy(this.target)
        .addScaledVector(this.shellDirection, -Math.cos(this.followAzimuth) * radius)
        .addScaledVector(this.shellRight, Math.sin(this.followAzimuth) * radius)
        .addScaledVector(this.shellUp, Math.sin(this.followElevation) * this.followDistance);
      this.constrainCameraHeight(this.camera.position);
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
      return;
    }
    // Follow translation exactly; damping is for changes in orbit/zoom. Damping
    // a moving world-space destination makes the follow distance vary with dt.
    if (!snap && this.followedShipId === ship.id) {
      this.camera.position.x += ship.x - this.followedPosition.x;
      this.camera.position.y += height - this.followedPosition.y;
      this.camera.position.z += ship.z - this.followedPosition.z;
    }
    this.followedPosition.set(ship.x, height, ship.z);
    this.followedShipId = ship.id;
    if (this.inPort || this.inspecting) {
      const framingScale = this.inPort ? this.portHullScale : 1;
      const distance = this.displayedDistance * Math.max(1, 1.1 / this.camera.aspect);
      // Port lowers its aim by a fixed share of the orbit distance: the same tilt at every zoom, so the
      // ship rides in the clear upper half above her builder's plate without sliding off the top up close.
      this.target.set(ship.x + Math.sin(ship.heading) * 25 * framingScale, height + 20 * framingScale - (this.inPort ? PORT_AIM_DROP * distance : 0), ship.z - Math.cos(ship.heading) * 25 * framingScale);
      if (this.inPort) this.target.add(this.portPan);
      // Up close the port's long near plane would slice the fitting being read; far out it keeps the town's depth precision.
      if (this.inPort) { const near = MathUtils.clamp(distance * .02, .3, 3); if (Math.abs(this.camera.near - near) > 1e-3) { this.camera.near = near; this.camera.updateProjectionMatrix(); } }
      const angle = this.azimuth - ship.heading;
      // Port orbits freely, below the waterline too. Combat inspection can tilt toward
      // the sky below the lowest orbit while the camera stays above the water.
      const orbitElevation = this.inPort ? this.elevation : Math.max(this.elevation, MIN_ORBIT_ELEVATION);
      const radius = Math.cos(orbitElevation) * distance;
      this.desired.set(ship.x + Math.sin(angle) * radius, height + Math.sin(orbitElevation) * distance + 15 * framingScale, ship.z + Math.cos(angle) * radius);
      if (this.inPort) this.desired.add(this.portPan);
      this.constrainCameraHeight(this.desired);
      this.camera.position.lerp(this.desired, snap ? 1 : 1 - Math.exp(-5 * dt));
      this.constrainCameraHeight(this.camera.position);
      this.look.copy(this.target);
      if (!this.inPort && this.elevation < MIN_ORBIT_ELEVATION) {
        this.look.sub(this.camera.position);
        const horizontalDistance = Math.hypot(this.look.x, this.look.z);
        const pitch = Math.min(MAX_UPWARD_TILT, Math.atan2(this.look.y, horizontalDistance) + MIN_ORBIT_ELEVATION - this.elevation);
        this.look.y = Math.tan(pitch) * horizontalDistance;
        this.look.add(this.camera.position);
      }
    } else {
      if (this.binoculars || this.mode === 'Bridge') {
        const periscope = this.submarine && (this.binoculars || height < -.5);
        this.desired.set(...localToWorld(periscope ? this.submarine!.periscopeEye : this.bridge, { ...ship, y: height }));
        if (this.binoculars && !periscope) this.desired.y += SCOPE_EYE_HEIGHT;
      } else {
        let distance = (this.mode === 'Tactical' ? Math.max(160 * this.hullScale, this.displayedDistance) : this.displayedDistance) * Math.max(1, 1.2 / this.camera.aspect);
        const floor = this.torpedoView && this.mode === 'Chase' ? TORPEDO_ORBIT_ELEVATION : MIN_ORBIT_ELEVATION;
        this.chaseFloor = snap || this.reducedMotion ? floor : MathUtils.lerp(this.chaseFloor, floor, 1 - Math.exp(-7 * dt));
        const orbitElevation = Math.max(this.chaseFloor, this.elevation);
        let lift = Math.sin(orbitElevation) * distance + 12 * this.hullScale;
        distance *= Math.cos(orbitElevation);
        if (this.submarine && this.mode === 'Chase') {
          const blend = MathUtils.clamp((-height - .5) / 5, 0, 1);
          const zoom = this.displayedDistance / (345 * this.hullScale);
          // Stay just behind the stern: the full surface follow distance is
          // beyond underwater visibility, especially in a portrait viewport.
          const close = this.hullLength * Math.max(.6, .66 * zoom) * Math.max(1, .55 / this.camera.aspect);
          const underwaterElevation = Math.max(0, orbitElevation - .1) * (Math.PI / 2) / (Math.PI / 2 - .1);
          distance = MathUtils.lerp(distance, close * Math.cos(underwaterElevation), blend);
          lift = MathUtils.lerp(lift, Math.sin(underwaterElevation) * close + 3.5, blend);
        }
        this.desired.set(ship.x - Math.sin(this.azimuth) * distance, height + lift, ship.z + Math.cos(this.azimuth) * distance);
      }
      this.constrainCameraHeight(this.desired);
      this.camera.position.copy(this.desired);
      if (this.opticsTransition && !snap) {
        this.opticsTransition.elapsed += dt;
        const progress = MathUtils.clamp(this.opticsTransition.elapsed / .42, 0, 1);
        const ease = 1 - (1 - progress) ** 3;
        this.camera.position.addScaledVector(this.opticsTransition.offset, 1 - ease);
        this.constrainCameraHeight(this.camera.position);
        if (this.opticsTransition.aim) {
          this.look.fromArray(this.opticsTransition.aim);
          this.camera.lookAt(this.look); this.camera.updateMatrixWorld();
          if (progress < 1) return;
          const delta = this.look.clone().sub(this.camera.position);
          this.azimuth = Math.atan2(delta.x, -delta.z);
          this.elevation = Math.atan2(-delta.y, Math.hypot(delta.x, delta.z));
        }
        if (progress >= 1) this.opticsTransition = undefined;
      }
      const rangeAim = this.rangeAim;
      if (rangeAim) {
        this.look.fromArray(rangeAim);
        this.elevation = Math.atan2(this.camera.position.y - rangeAim[1], Math.hypot(rangeAim[0] - this.camera.position.x, rangeAim[2] - this.camera.position.z));
      } else this.look.set(Math.sin(this.azimuth) * Math.cos(this.elevation), -Math.sin(this.elevation), -Math.cos(this.azimuth) * Math.cos(this.elevation)).multiplyScalar(1000).add(this.camera.position);
    }
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }
  dispose(): void { this.releasePointer(); this.abort.abort(); }
}

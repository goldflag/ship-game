import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { ShipState } from '../simulation/ship';
import { localToWorld } from '../simulation/geometry';
import type { Vec3 } from '../ships/blueprint';
import { terrainHeight } from './HarborTerrain';
import type { ShellView } from './ShellFollow';

export type CameraMode = 'Chase' | 'Bridge' | 'Tactical';
const NORMAL_FOV = 52;
const MAGNIFICATIONS = [2, 4, 6, 8, 12, 16, 24];
const MIN_ORBIT_ELEVATION = .08;
const MAX_UPWARD_TILT = Math.PI / 6;
const CAMERA_CLEARANCE = 12;
const PORT_ELEVATION = .2;

export class CameraRig {
  mode: CameraMode = 'Chase';
  binoculars = false;
  private zoomIndex = 1;
  private azimuth = .82;
  private elevation = .1;
  private distance = 345;
  private hullScale = 1;
  private portHullScale = 1;
  private dragging = false;
  private inPort = false;
  private enabled = true;
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
  private requestingLock = false;
  private intentionalUnlock = false;
  private shellView?: ShellView;
  private returnBinoculars = false;
  private shellDirection = new Vector3();
  private shellRight = new Vector3();

  constructor(readonly camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private bridge: Vec3 = [0, 29, -31],
    private actions: { pause(): void; aim(): void; optics(): void } = { pause() {}, aim() {}, optics() {} }) {
    const options = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled || (e.button !== 0 && e.button !== 2)) return;
      if (!this.inPort && !this.inspecting && e.pointerType === 'mouse') {
        if (!this.pointerLocked) { this.capturePointer(); return; }
        if (e.button === 0) this.mouseFire = true;
        if (e.button === 2) this.actions.optics();
        return;
      }
      this.dragging = true; this.pointerId = e.pointerId;
      this.previous = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    }, options);
    canvas.addEventListener('pointermove', e => {
      if (!this.enabled || this.shellView) return;
      const locked = this.pointerLocked;
      if (!locked && (!this.dragging || e.pointerId !== this.pointerId)) return;
      const dx = locked ? e.movementX : e.clientX - this.previous.x;
      const dy = locked ? e.movementY : e.clientY - this.previous.y;
      if (this.inPort || this.inspecting) {
        this.azimuth -= dx * .005;
        this.elevation = MathUtils.clamp(this.elevation + dy * .003, this.inPort ? MIN_ORBIT_ELEVATION : -MAX_UPWARD_TILT, 1.35);
      } else {
        // Angular sensitivity follows the visible field of view at every magnification.
        const sensitivity = .0025 * Math.tan(this.camera.fov * Math.PI / 360) / Math.tan(NORMAL_FOV * Math.PI / 360);
        this.azimuth += dx * sensitivity;
        this.elevation = MathUtils.clamp(this.elevation + dy * sensitivity, -MAX_UPWARD_TILT, 1.3);
        if (dx || dy) this.actions.aim();
      }
      this.previous = { x: e.clientX, y: e.clientY };
    }, options);
    const release = () => { this.dragging = false; this.mouseFire = false; };
    window.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    document.addEventListener('pointerlockchange', () => {
      if (this.pointerLocked) {
        this.requestingLock = false;
        if (!this.enabled || this.inPort || this.inspecting || this.intentionalUnlock) this.releasePointer();
      } else {
        release();
        if (!this.intentionalUnlock && this.enabled && !this.inPort && !this.inspecting) this.actions.pause();
      }
    }, options);
    document.addEventListener('pointerlockerror', () => { this.requestingLock = false; }, options);
    window.addEventListener('blur', release, options);
    canvas.addEventListener('wheel', e => {
      if (!this.enabled || this.shellView) return;
      e.preventDefault();
      if (this.binoculars) {
        this.zoomIndex = MathUtils.clamp(this.zoomIndex + Math.sign(-e.deltaY), 0, MAGNIFICATIONS.length - 1);
        this.updateProjection();
      } else this.distance = MathUtils.clamp(this.distance * Math.exp(e.deltaY * .001), (this.inPort ? 90 : 185) * this.distanceScale, this.inPort ? 650 * this.portHullScale : 1400);
    }, { ...options, passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault(), options);
  }

  setBridge(bridge: Vec3 = [0, 29, -31]): void { this.bridge = bridge; }

  get pointerLocked(): boolean { return document.pointerLockElement === this.canvas; }
  get firing(): boolean { return this.enabled && this.pointerLocked && this.mouseFire; }
  get magnification(): number { return this.binoculars ? MAGNIFICATIONS[this.zoomIndex] : 1; }
  get bearing(): number { return ((this.azimuth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); }

  setShellView(view?: ShellView): void {
    if (!!view !== !!this.shellView) {
      if (view) { this.returnBinoculars = this.binoculars; this.binoculars = false; }
      else { this.binoculars = this.returnBinoculars; this.followedShipId = undefined; }
      this.updateProjection();
    }
    this.shellView = view;
  }

  capturePointer(): void {
    if (!this.enabled || this.inPort || this.inspecting || this.pointerLocked || this.requestingLock || !this.canvas.requestPointerLock || !window.matchMedia('(pointer: fine)').matches) return;
    this.intentionalUnlock = false;
    this.requestingLock = true;
    this.canvas.focus({ preventScroll: true });
    try {
      // Older implementations return void; current browsers return a promise.
      const request = this.canvas.requestPointerLock() as Promise<void> | undefined;
      request?.catch(() => { this.requestingLock = false; });
    } catch { this.requestingLock = false; }
  }
  releasePointer(): void {
    this.intentionalUnlock = true;
    this.mouseFire = false;
    if (this.pointerLocked) document.exitPointerLock();
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) { this.dragging = false; this.releasePointer(); }
  }
  setInspecting(inspecting: boolean): void {
    this.setShellView();
    this.inspecting = inspecting;
    this.binoculars = false;
    this.updateProjection();
    if (inspecting) this.releasePointer();
    this.recenter();
  }
  private updateProjection(): void {
    this.camera.fov = 2 * Math.atan(Math.tan(NORMAL_FOV * Math.PI / 360) / this.magnification) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }
  toggleBinoculars(aim: Vec3, ship: ShipState): void {
    if (this.inPort || this.inspecting) return;
    this.binoculars = !this.binoculars;
    this.updateProjection();
    this.aimAt(aim, ship);
  }
  aimAt(aim: Vec3, ship: ShipState): void {
    this.azimuth = Math.atan2(aim[0] - ship.x, ship.z - aim[2]);
    this.update(ship, ship.y, 0, true);
    const delta = new Vector3(...aim).sub(this.camera.position);
    this.azimuth = Math.atan2(delta.x, -delta.z);
    this.elevation = Math.atan2(-delta.y, Math.hypot(delta.x, delta.z));
    this.update(ship, ship.y, 0, true);
  }
  cycle(): void {
    const modes: CameraMode[] = ['Chase', 'Bridge', 'Tactical'];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.binoculars = false;
    this.updateProjection();
    this.recenter();
  }
  recenter(): void {
    this.azimuth = this.inPort || this.inspecting ? 1.08 : this.lastShip?.heading ?? 0;
    this.elevation = this.inPort || this.inspecting ? PORT_ELEVATION : this.mode === 'Tactical' ? .85 : this.mode === 'Bridge' ? .025 : .1;
  }
  setInPort(inPort: boolean): void {
    this.setShellView();
    this.inPort = inPort;
    this.inspecting = false;
    this.followedShipId = undefined;
    this.mode = 'Chase';
    this.binoculars = false;
    this.updateProjection();
    this.azimuth = inPort ? 1.08 : .82;
    this.elevation = inPort ? PORT_ELEVATION : .1;
    this.distance = (inPort ? 325 : 345) * this.distanceScale;
    this.releasePointer();
  }
  /** Preserve relative zoom and orbit when switching between differently sized hulls. */
  setHullLength(length: number): void {
    const previousScale = this.distanceScale;
    // Port framing follows the actual hull size, including boats below the
    // combat camera's minimum scale. Water/terrain clearance is applied later.
    this.portHullScale = length / 250.5;
    this.hullScale = MathUtils.clamp(this.portHullScale, .35, 1.5);
    this.distance *= this.distanceScale / previousScale;
  }
  private get distanceScale(): number { return this.inPort ? this.portHullScale : this.hullScale; }
  private battleTerrain: (x: number, z: number) => number = () => 0;
  setBattleTerrain(height: (x: number, z: number) => number): void { this.battleTerrain = height; }
  private constrainCameraHeight(position: Vector3): void {
    const ground = this.inPort ? Math.max(0, terrainHeight(position.x, position.z)) : Math.max(0, this.battleTerrain(position.x, position.z));
    position.y = Math.max(position.y, ground + CAMERA_CLEARANCE);
  }
  update(ship: ShipState, height: number, dt: number, snap = false): void {
    this.lastShip = ship;
    if (this.shellView) {
      this.target.fromArray(this.shellView.position);
      this.shellDirection.fromArray(this.shellView.velocity).normalize();
      if (this.shellDirection.lengthSq() === 0) this.shellDirection.set(0, 0, -1);
      this.shellRight.set(-this.shellDirection.z, 0, this.shellDirection.x).normalize();
      this.camera.position.copy(this.target).addScaledVector(this.shellDirection, -45).addScaledVector(this.shellRight, 12);
      this.camera.position.y += 12;
      this.constrainCameraHeight(this.camera.position);
      this.look.copy(this.target).addScaledVector(this.shellDirection, 35);
      this.camera.lookAt(this.look);
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
      this.target.set(ship.x + Math.sin(ship.heading) * 25 * framingScale, height + 20 * framingScale, ship.z - Math.cos(ship.heading) * 25 * framingScale);
      const distance = this.distance * Math.max(1, 1.1 / this.camera.aspect);
      const angle = this.azimuth - ship.heading;
      // Port stays aimed at the ship. Combat inspection can tilt toward the sky
      // below the lowest orbit while the camera stays above the water.
      const orbitElevation = Math.max(this.elevation, MIN_ORBIT_ELEVATION);
      const radius = Math.cos(orbitElevation) * distance;
      this.desired.set(ship.x + Math.sin(angle) * radius, height + Math.sin(orbitElevation) * distance + 15 * framingScale, ship.z + Math.cos(angle) * radius);
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
        this.desired.set(...localToWorld(this.bridge, { ...ship, y: height }));
        if (this.binoculars) this.desired.y += 8;
      } else {
        const distance = (this.mode === 'Tactical' ? Math.max(650, this.distance) : this.distance) * Math.max(1, 1.2 / this.camera.aspect);
        const lift = this.mode === 'Tactical' ? distance * .95 + 25 : (distance * .28 + 25) * this.hullScale;
        this.desired.set(ship.x - Math.sin(this.azimuth) * distance, height + lift, ship.z + Math.cos(this.azimuth) * distance);
      }
      this.constrainCameraHeight(this.desired);
      this.camera.position.copy(this.desired);
      this.look.set(Math.sin(this.azimuth) * Math.cos(this.elevation), -Math.sin(this.elevation), -Math.cos(this.azimuth) * Math.cos(this.elevation)).multiplyScalar(1000).add(this.desired);
    }
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }
  dispose(): void { this.releasePointer(); this.abort.abort(); }
}

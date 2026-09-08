import { PerspectiveCamera } from 'three/webgpu';
import { battlefieldDistance, BATTLEFIELD_FOV, BATTLEFIELD_TILT, BATTLEFIELD_MAX_TILT, chartNavigationY, chartPoint, chartWorld, fitAirChart, type ChartView } from '../ui/airChart';

/** Orbitable battlefield camera; defaults to north-up, twenty degrees off vertical. */
export class BattlefieldCamera {
  view: ChartView = { x: 0, z: 0, radius: 8000 };
  private saved?: { fov: number; far: number; up: [number, number, number] };
  constructor(private camera: PerspectiveCamera) {}
  private transition?: { position: PerspectiveCamera['position']; quaternion: PerspectiveCamera['quaternion']; fov: number; far: number; targetFar?: number; elapsed: number };
  get transitioning() { return !!this.transition; }
  beginTransition(reducedMotion = false) {
    this.transition = reducedMotion ? undefined : { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), fov: this.camera.fov, far: this.camera.far, elapsed: 0 };
  }
  cancelTransition() {
    if (this.transition?.targetFar !== undefined) {
      this.camera.far = this.transition.targetFar;
      this.camera.updateProjectionMatrix();
    }
    this.transition = undefined;
  }
  /** Blend toward the live destination, so the ship keeps moving during descent. */
  applyTransition(dt: number) {
    const start = this.transition;
    if (!start) return;
    start.elapsed += Math.max(0, dt);
    const t = Math.min(1, start.elapsed / 1.4);
    const eased = t * t * t * (t * (t * 6 - 15) + 10);
    start.targetFar ??= this.camera.far;
    this.camera.far = t === 1 ? start.targetFar : Math.max(start.far, start.targetFar);
    this.camera.position.lerpVectors(start.position, this.camera.position, eased);
    // The live destination is already in camera.quaternion. Using it as slerpQuaternions'
    // second input would overwrite it when that method copies the start into its output.
    this.camera.quaternion.slerp(start.quaternion, 1 - eased);
    this.camera.fov = start.fov + (this.camera.fov - start.fov) * eased;
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    if (t === 1) this.transition = undefined;
  }
  enter(points: { x: number; z: number }[], width: number, height: number) {
    this.saved ??= { fov: this.camera.fov, far: this.camera.far, up: this.camera.up.toArray() };
    this.fit(points, width, height); this.update();
  }
  exit() {
    if (!this.saved) return;
    this.camera.fov = this.saved.fov; this.camera.far = this.saved.far; this.camera.up.fromArray(this.saved.up);
    this.camera.updateProjectionMatrix(); this.saved = undefined;
  }
  fit(points: { x: number; z: number }[], width: number, height: number) {
    this.view = { ...this.view, ...fitAirChart(points.length ? points : [{ x: 0, z: 0 }], width, Math.max(1, height - 240)) };
    this.view.radius = Math.min(40000, this.view.radius);
    // Perspective makes the near side larger. Frame actual projected fleet positions.
    const margin = Math.min(40, width * .1);
    for (let i = 0; i < 16 && this.view.radius < 40000; i++) {
      if (points.every(p => { const [x, y] = chartPoint(this.view, width, height, p.x, p.z); return x >= margin && x <= width - margin && y >= 110 && y <= height - 140; })) break;
      this.view.radius = Math.min(40000, this.view.radius * 1.15);
    }
  }
  pan(dx: number, dy: number, width: number, height: number, x = width / 2, y = height / 2) {
    // Move both grab points into the usable water band so sky drags still pan in both axes.
    y = chartNavigationY(this.view, height, y - Math.max(0, dy)) + Math.max(0, dy);
    const before = chartWorld(this.view, width, height, x - dx, y - dy), after = chartWorld(this.view, width, height, x, y);
    this.view.x += before[0] - after[0]; this.view.z += before[1] - after[1];
    this.view.x = Math.max(-50000, Math.min(50000, this.view.x)); this.view.z = Math.max(-50000, Math.min(50000, this.view.z));
  }
  zoom(delta: number, x: number, y: number, width: number, height: number) {
    y = chartNavigationY(this.view, height, y);
    const before = chartWorld(this.view, width, height, x, y);
    this.view.radius = Math.max(300, Math.min(40000, this.view.radius * Math.exp(delta * .0015)));
    const after = chartWorld(this.view, width, height, x, y);
    this.view.x += before[0] - after[0]; this.view.z += before[1] - after[1];
  }
  setTilt(radians: number) {
    if (Number.isFinite(radians)) this.view.tilt = Math.max(0, Math.min(BATTLEFIELD_MAX_TILT, radians));
  }
  orbit(dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.view.bearing = ((this.view.bearing ?? 0) - dx * .005) % (Math.PI * 2);
    this.setTilt((this.view.tilt ?? BATTLEFIELD_TILT) - dy * .005);
  }
  resetAngle() { this.view.tilt = BATTLEFIELD_TILT; this.view.bearing = 0; }
  update() {
    this.camera.fov = BATTLEFIELD_FOV; this.camera.far = 1000000;
    const distance = battlefieldDistance(this.view, this.camera.aspect, 1);
    const tilt = this.view.tilt ?? BATTLEFIELD_TILT, bearing = this.view.bearing ?? 0;
    this.camera.position.set(this.view.x + distance * Math.sin(tilt) * Math.sin(bearing), distance * Math.cos(tilt), this.view.z + distance * Math.sin(tilt) * Math.cos(bearing));
    // A horizontal up reference also keeps an exactly overhead view well defined.
    this.camera.up.set(-Math.sin(bearing), 0, -Math.cos(bearing)); this.camera.lookAt(this.view.x, 0, this.view.z);
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }
}

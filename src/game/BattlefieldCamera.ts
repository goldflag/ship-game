import { PerspectiveCamera } from 'three/webgpu';
import { battlefieldDistance, BATTLEFIELD_FOV, BATTLEFIELD_TILT, chartPoint, chartWorld, fitAirChart, type ChartView } from '../ui/airChart';

/** North-up battlefield camera, twenty degrees off vertical, over the actual ocean. */
export class BattlefieldCamera {
  view: ChartView = { x: 0, z: 0, radius: 8000 };
  private saved?: { fov: number; far: number; up: [number, number, number] };
  constructor(private camera: PerspectiveCamera) {}
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
    this.view = fitAirChart(points.length ? points : [{ x: 0, z: 0 }], width, Math.max(1, height - 240));
    this.view.radius = Math.min(40000, this.view.radius);
    // Perspective makes the near side larger. Frame actual projected fleet positions.
    const margin = Math.min(40, width * .1);
    for (let i = 0; i < 16 && this.view.radius < 40000; i++) {
      if (points.every(p => { const [x, y] = chartPoint(this.view, width, height, p.x, p.z); return x >= margin && x <= width - margin && y >= 110 && y <= height - 140; })) break;
      this.view.radius = Math.min(40000, this.view.radius * 1.15);
    }
  }
  pan(dx: number, dy: number, width: number, height: number, x = width / 2, y = height / 2) {
    const before = chartWorld(this.view, width, height, x - dx, y - dy), after = chartWorld(this.view, width, height, x, y);
    this.view.x += before[0] - after[0]; this.view.z += before[1] - after[1];
    this.view.x = Math.max(-50000, Math.min(50000, this.view.x)); this.view.z = Math.max(-50000, Math.min(50000, this.view.z));
  }
  zoom(delta: number, x: number, y: number, width: number, height: number) {
    const before = chartWorld(this.view, width, height, x, y);
    this.view.radius = Math.max(600, Math.min(40000, this.view.radius * Math.exp(delta * .0015)));
    const after = chartWorld(this.view, width, height, x, y);
    this.view.x += before[0] - after[0]; this.view.z += before[1] - after[1];
  }
  update() {
    this.camera.fov = BATTLEFIELD_FOV; this.camera.far = 1000000;
    const distance = battlefieldDistance(this.view, this.camera.aspect, 1);
    this.camera.position.set(this.view.x, distance * Math.cos(BATTLEFIELD_TILT), this.view.z + distance * Math.sin(BATTLEFIELD_TILT));
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.view.x, 0, this.view.z);
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }
}

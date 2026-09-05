import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { ShipState } from '../simulation/ship';
import { localToWorld } from '../simulation/geometry';
import type { Vec3 } from '../ships/blueprint';
import { terrainHeight } from './HarborTerrain';

export type CameraMode = 'Chase' | 'Bridge' | 'Tactical';
export class CameraRig {
  mode: CameraMode = 'Chase';
  private azimuth = 0.82;
  private elevation = 0.25;
  private distance = 345;
  private dragging = false;
  private inPort = false;
  private pointerId = -1;
  private previous = { x: 0, y: 0 };
  private target = new Vector3();
  private desired = new Vector3();
  private look = new Vector3();
  private abort = new AbortController();

  constructor(readonly camera: PerspectiveCamera, canvas: HTMLCanvasElement, private bridge: Vec3 = [0, 29, -31]) {
    const options = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.button !== 2) return;
      this.dragging = true; this.pointerId = e.pointerId;
      this.previous = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    }, options);
    canvas.addEventListener('pointermove', e => {
      if (!this.dragging || e.pointerId !== this.pointerId) return;
      this.azimuth -= (e.clientX - this.previous.x) * 0.005;
      this.elevation = MathUtils.clamp(this.elevation + (e.clientY - this.previous.y) * 0.003, 0.08, 1.35);
      this.previous = { x: e.clientX, y: e.clientY };
    }, options);
    const release = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.distance = MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), this.inPort ? 90 : 185, this.inPort ? 650 : 1400);
    }, { ...options, passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault(), options);
  }

  cycle(): void {
    const modes: CameraMode[] = ['Chase', 'Bridge', 'Tactical'];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.recenter();
  }
  recenter(): void { this.azimuth = this.mode === 'Bridge' ? 0 : this.inPort ? 1.08 : .82; this.elevation = this.inPort ? .23 : .25; }
  setInPort(inPort: boolean): void {
    this.inPort = inPort;
    this.mode = 'Chase';
    this.azimuth = inPort ? 1.08 : .82;
    this.elevation = inPort ? .23 : .25;
    this.distance = inPort ? 325 : 345;
  }
  update(ship: ShipState, height: number, dt: number, snap = false): void {
    const forwardX = Math.sin(ship.heading), forwardZ = -Math.cos(ship.heading);
    this.target.set(ship.x + forwardX * 25, height + 20, ship.z + forwardZ * 25);
    if (this.mode === 'Bridge') {
      this.desired.set(...localToWorld(this.bridge, { ...ship, y: height }));
      const angle = ship.heading + this.azimuth;
      this.look.set(this.desired.x + Math.sin(angle) * 500, this.desired.y - 7, this.desired.z - Math.cos(angle) * 500);
    } else {
      const elevation = this.mode === 'Tactical' ? 1.25 : this.elevation;
      const framing = Math.max(1, (this.inPort ? 1.1 : 1.45) / this.camera.aspect);
      const distance = (this.mode === 'Tactical' ? Math.max(650, this.distance) : this.distance) * framing;
      const angle = this.azimuth - ship.heading;
      const radius = Math.cos(elevation) * distance;
      this.desired.set(ship.x + Math.sin(angle) * radius, height + Math.sin(elevation) * distance + 15, ship.z + Math.cos(angle) * radius);
      if (this.inPort) this.desired.y = Math.max(this.desired.y, terrainHeight(this.desired.x, this.desired.z) + 12);
      this.look.copy(this.target);
    }
    this.camera.position.lerp(this.desired, snap ? 1 : 1 - Math.exp(-5 * dt));
    if (this.inPort) this.camera.position.y = Math.max(this.camera.position.y, terrainHeight(this.camera.position.x, this.camera.position.z) + 12);
    this.camera.lookAt(this.look);
  }
  dispose(): void { this.abort.abort(); }
}

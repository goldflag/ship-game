import * as THREE from 'three';
import type { Vec3 } from '../../ships/blueprint';

export interface RotateHandleOptions {
  key: string; anchor: Vec3; axis: number; snap: boolean;
  select(axis: number): void;
  preview(axis?: number, degrees?: number): void;
  commit(axis: number, degrees: number): void;
}
const NAMES = ['Pitch', 'Yaw', 'Roll'];
const TAU = Math.PI * 2;
interface Drag {
  pointer: number; target: SVGPathElement; options: RotateHandleOptions; axis: number;
  camera: string; x: number; y: number; plane: THREE.Plane; anchor: THREE.Vector3;
  previous: number; total: number; degrees: number; tangent?: THREE.Vector2;
}
/** Screen-sized rings around ship axes. Source changes only on release. */
export class RotateHandles {
  readonly element = document.createElement('div');
  screenBounds?: { left: number; right: number; top: number; bottom: number };
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readout = document.createElement('output');
  private rings: { line: SVGPathElement; hit: SVGPathElement }[];
  private options?: RotateHandleOptions;
  private drag?: Drag;
  private radius = 1;
  constructor(private host: HTMLElement, private camera: () => THREE.Camera) {
    this.element.className = 'sb-rotate-handles';
    this.element.setAttribute('role', 'group'); this.element.setAttribute('aria-label', 'Rotate block handles');
    this.element.append(this.svg, this.readout); this.readout.setAttribute('aria-label', 'Rotation drag angle');
    this.rings = [0, 1, 2].map(axis => {
      const line = document.createElementNS(this.svg.namespaceURI, 'path') as SVGPathElement;
      const hit = document.createElementNS(this.svg.namespaceURI, 'path') as SVGPathElement;
      line.classList.add('sb-rotation-ring'); hit.classList.add('sb-rotation-hit');
      for (const path of [line, hit]) { path.dataset.axis = 'XYZ'[axis]; this.svg.append(path); }
      line.setAttribute('aria-hidden', 'true'); hit.setAttribute('role', 'button'); hit.setAttribute('tabindex', '0');
      hit.setAttribute('aria-label', `Rotate ${NAMES[axis]} ring`);
      hit.addEventListener('pointerdown', e => this.down(e, axis));
      hit.addEventListener('pointermove', this.move); hit.addEventListener('pointerup', this.up);
      hit.addEventListener('pointercancel', this.cancel); hit.addEventListener('contextmenu', e => e.preventDefault());
      hit.addEventListener('lostpointercapture', () => { if (this.drag?.target === hit) this.cancel(); });
      hit.addEventListener('keydown', e => {
        if (!this.options || this.drag || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation(); this.options.select(axis);
        if (e.key.startsWith('Arrow')) this.options.commit(axis, (e.shiftKey ? 1 : 15) * (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1));
      });
      return { line, hit };
    });
    this.element.hidden = true; host.append(this.element);
    window.addEventListener('keydown', this.key, true); window.addEventListener('blur', this.cancel);
    window.addEventListener('pointerdown', this.secondary, true);
  }
  get dragging() { return !!this.drag; }
  update(options?: RotateHandleOptions) {
    if (this.drag && options?.key !== this.drag.options.key) this.cancel();
    this.options = options; this.frame();
  }
  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera());
    return new THREE.Vector2((p.x + 1) * this.host.clientWidth / 2, (1 - p.y) * this.host.clientHeight / 2);
  }
  private cameraKey() { return [...this.camera().matrixWorld.elements, ...this.camera().projectionMatrix.elements].join(','); }
  private point(anchor: THREE.Vector3, axis: number, angle: number) {
    return anchor.clone().setComponent((axis + 1) % 3, anchor.getComponent((axis + 1) % 3) + this.radius * Math.cos(angle))
      .setComponent((axis + 2) % 3, anchor.getComponent((axis + 2) % 3) + this.radius * Math.sin(angle));
  }
  frame() {
    this.camera().updateMatrixWorld();
    if (this.drag && this.drag.camera !== this.cameraKey()) { this.cancel(); return; }
    const o = this.options; this.element.hidden = !o; this.screenBounds = undefined; if (!o) return;
    const anchor = new THREE.Vector3(...o.anchor), origin = this.project(anchor), depth = anchor.clone().project(this.camera()).z;
    if (depth < -1 || depth > 1) { this.element.hidden = true; return; }
    const scale = Math.max(...[0, 1, 2].map(k => this.project(anchor.clone().setComponent(k, anchor.getComponent(k) + 1)).distanceTo(origin)), 1e-6);
    if (!this.drag) this.radius = 92 / scale;
    const all: THREE.Vector2[] = [];
    this.rings.forEach(({ line, hit }, axis) => {
      const points = Array.from({ length: 97 }, (_, i) => this.project(this.point(anchor, axis, i / 96 * TAU)));
      all.push(...points);
      const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';
      line.setAttribute('d', path); hit.setAttribute('d', path);
      line.classList.toggle('is-active', axis === (this.drag?.axis ?? o.axis)); hit.setAttribute('aria-pressed', String(axis === o.axis));
    });
    this.screenBounds = { left: Math.min(...all.map(p => p.x)) - 8, right: Math.max(...all.map(p => p.x)) + 8,
      top: Math.min(...all.map(p => p.y)) - 8, bottom: Math.max(...all.map(p => p.y)) + 32 };
    this.readout.hidden = !this.drag;
    this.readout.style.transform = `translate(${origin.x}px,${this.screenBounds.bottom - 22}px)`;
    if (this.drag) this.readout.textContent = `${'XYZ'[this.drag.axis]} ${NAMES[this.drag.axis]} ${this.drag.degrees > 0 ? '+' : ''}${Number(this.drag.degrees.toFixed(1))}°`;
  }
  private ray(x: number, y: number) {
    const r = this.host.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), this.camera()); return ray.ray;
  }
  private angle(point: THREE.Vector3, axis: number) { return Math.atan2(point.getComponent((axis + 2) % 3), point.getComponent((axis + 1) % 3)); }
  private down(e: PointerEvent, axis: number) {
    if (e.button !== 0 || !this.options || this.drag) return;
    e.preventDefault(); e.stopPropagation(); this.camera().updateMatrixWorld();
    const anchor = new THREE.Vector3(...this.options.anchor), normal = new THREE.Vector3().setComponent(axis, 1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor), ray = this.ray(e.clientX, e.clientY);
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    let previous = hit ? this.angle(hit.sub(anchor), axis) : 0, tangent: THREE.Vector2 | undefined;
    // Edge-on rings have an ill-conditioned plane intersection. Follow their screen tangent instead.
    if (Math.abs(ray.direction.dot(normal)) < .15 || !hit) {
      const r = this.host.getBoundingClientRect(), cursor = new THREE.Vector2(e.clientX - r.left, e.clientY - r.top);
      const candidates = Array.from({ length: 96 }, (_, i) => ({ a: i / 96 * TAU, p: this.project(this.point(anchor, axis, i / 96 * TAU)) }));
      const nearest = candidates.reduce((a, b) => a.p.distanceToSquared(cursor) < b.p.distanceToSquared(cursor) ? a : b);
      previous = nearest.a;
      tangent = this.project(this.point(anchor, axis, previous + .05)).sub(this.project(this.point(anchor, axis, previous - .05))).multiplyScalar(10);
      if (tangent.length() < 18) tangent = new THREE.Vector2(92, 0);
    }
    this.drag = { pointer: e.pointerId, target: e.currentTarget as SVGPathElement, options: this.options, axis, camera: this.cameraKey(),
      x: e.clientX, y: e.clientY, plane, anchor, previous, total: 0, degrees: 0, tangent };
    this.drag.target.setPointerCapture(e.pointerId); this.options.select(axis); this.frame();
  }
  private move = (e: PointerEvent) => {
    const d = this.drag; if (!d || d.pointer !== e.pointerId) return;
    if (d.tangent) d.total = new THREE.Vector2(e.clientX - d.x, e.clientY - d.y).dot(d.tangent) / d.tangent.lengthSq();
    else {
      const hit = this.ray(e.clientX, e.clientY).intersectPlane(d.plane, new THREE.Vector3()); if (!hit) return;
      const angle = this.angle(hit.sub(d.anchor), d.axis);
      d.total += Math.atan2(Math.sin(angle - d.previous), Math.cos(angle - d.previous)); d.previous = angle;
    }
    const raw = Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3 ? 0 : d.total * 180 / Math.PI;
    const step = d.options.snap && !e.shiftKey ? 15 : .1;
    d.degrees = Math.round(raw / step) * step;
    d.options.preview(d.axis, d.degrees); this.frame();
  };
  private up = (e: PointerEvent) => {
    const d = this.drag; if (!d || d.pointer !== e.pointerId || e.button !== 0) return;
    this.move(e); this.cancel(); if (Math.abs(d.degrees % 360) > 1e-8) d.options.commit(d.axis, d.degrees);
  };
  cancel = () => {
    const d = this.drag; this.drag = undefined;
    if (d?.target.hasPointerCapture(d.pointer)) d.target.releasePointerCapture(d.pointer);
    if (d) d.options.preview(); this.frame();
  };
  private key = (e: KeyboardEvent) => {
    if (!this.drag) return;
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase()))) {
      e.preventDefault(); e.stopImmediatePropagation(); this.cancel();
    } else if (!['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  private secondary = (e: PointerEvent) => { if (e.button === 2 && this.drag) { e.preventDefault(); e.stopImmediatePropagation(); this.cancel(); } };
  dispose() {
    this.cancel(); this.element.remove(); window.removeEventListener('keydown', this.key, true);
    window.removeEventListener('blur', this.cancel); window.removeEventListener('pointerdown', this.secondary, true);
  }
}

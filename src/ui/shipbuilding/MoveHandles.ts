import * as THREE from 'three';
import type { Vec3 } from '../../ships/blueprint';

export interface MoveHandleOptions {
  key: string; anchor: Vec3; unit: number;
  axes?: [boolean, boolean, boolean];
  constrain(delta: Vec3): Vec3;
  preview(delta?: Vec3, blocked?: boolean): void;
  commit(delta: Vec3): void;
}
interface Drag {
  pointer: number; target: HTMLElement; options: MoveHandleOptions;
  x: number; y: number; plane: THREE.Plane; origin: THREE.Vector3;
  free: boolean[]; camera: string; delta: Vec3;
}
/** Whole-selection translation using the freeform editor's screen-sized XYZ
 * handles. Axes are ship coordinates, matching position fields and arrow keys. */
export class MoveHandles {
  readonly element = document.createElement('div');
  screenBounds?: { left: number; right: number; top: number; bottom: number };
  private drawing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private lines: SVGPathElement[];
  private buttons: HTMLButtonElement[];
  private plane: HTMLButtonElement;
  private options?: MoveHandleOptions;
  private drag?: Drag;

  constructor(private host: HTMLElement, private camera: () => THREE.Camera) {
    this.element.className = 'sb-freeform-handles sb-move-handles';
    this.element.setAttribute('role', 'group'); this.element.setAttribute('aria-label', 'Move selection');
    this.drawing.classList.add('sb-freeform-overlay'); this.drawing.setAttribute('aria-hidden', 'true');
    this.element.append(this.drawing);
    this.lines = [0, 1, 2].map(k => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('class', 'sb-freeform-axis-line'); line.dataset.axis = 'XYZ'[k];
      this.drawing.append(line); return line;
    });
    this.buttons = [0, 1, 2].map(k => {
      const button = this.button('sb-freeform-axis', k);
      button.textContent = 'XYZ'[k]; button.dataset.axis = 'XYZ'[k];
      button.setAttribute('aria-label', `Move selection ${'XYZ'[k]}`);
      button.addEventListener('keydown', e => {
        if (!this.options || this.options.axes?.[k] === false || this.drag || !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const delta: Vec3 = [0, 0, 0]; delta[k] = this.options.unit * (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1);
        this.options.commit(this.options.constrain(delta));
      });
      return button;
    });
    this.plane = this.button('sb-freeform-plane');
    this.plane.setAttribute('aria-label', 'Move selection in view plane');
    this.plane.title = 'Drag selection in the coordinate plane facing you';
    this.element.hidden = true; host.append(this.element);
    window.addEventListener('keydown', this.key, true); window.addEventListener('blur', this.cancel);
    window.addEventListener('pointerdown', this.secondary, true);
  }
  private button(className: string, axis?: number) {
    const b = document.createElement('button'); b.type = 'button'; b.className = className;
    b.addEventListener('pointerdown', e => this.down(e, axis));
    b.addEventListener('pointermove', this.move); b.addEventListener('pointerup', this.up);
    b.addEventListener('pointercancel', this.cancel);
    b.addEventListener('lostpointercapture', () => { if (this.drag?.target === b) this.cancel(); });
    b.addEventListener('contextmenu', e => e.preventDefault()); this.element.append(b); return b;
  }
  get dragging() { return !!this.drag; }
  update(options?: MoveHandleOptions) {
    if (this.drag && options?.key !== this.drag.options.key) this.cancel();
    this.options = options; this.frame();
  }
  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera());
    return new THREE.Vector2((p.x + 1) * this.host.clientWidth / 2, (1 - p.y) * this.host.clientHeight / 2);
  }
  private cameraKey() { return [...this.camera().matrixWorld.elements, ...this.camera().projectionMatrix.elements].join(','); }
  frame() {
    this.camera().updateMatrixWorld();
    if (this.drag && this.drag.camera !== this.cameraKey()) { this.cancel(); return; }
    const o = this.options; this.element.hidden = !o; this.screenBounds = undefined; if (!o) return;
    const anchor = new THREE.Vector3(...o.anchor).add(new THREE.Vector3(...(this.drag?.delta ?? [0, 0, 0])));
    const origin = this.project(anchor), depth = anchor.clone().project(this.camera()).z;
    const visible = depth >= -1 && depth <= 1;
    const vectors = [0, 1, 2].map(k => this.project(anchor.clone().setComponent(k, anchor.getComponent(k) + 1)).sub(origin));
    const scale = 76 / Math.max(...vectors.map(v => v.length()), 1e-6);
    const points = [origin];
    this.buttons.forEach((b, k) => {
      const v = vectors[k].multiplyScalar(scale), end = origin.clone().add(v);
      b.hidden = !visible || o.axes?.[k] === false || v.length() < 18;
      if (!b.hidden) points.push(end);
      b.style.transform = `translate(${end.x}px,${end.y}px)`;
      b.title = `Drag ${'XYZ'[k]}; arrow keys nudge by ${o.unit} m`;
      this.lines[k].style.display = b.hidden ? 'none' : '';
      this.lines[k].setAttribute('d', `M${origin.x},${origin.y} L${end.x},${end.y}`);
    });
    this.plane.hidden = !visible || (o.axes?.filter(Boolean).length ?? 3) < 2; this.plane.style.transform = `translate(${origin.x}px,${origin.y}px)`;
    if (visible) this.screenBounds = {
      left: Math.min(...points.map(p => p.x)) - 20, right: Math.max(...points.map(p => p.x)) + 20,
      top: Math.min(...points.map(p => p.y)) - 20, bottom: Math.max(...points.map(p => p.y)) + 20,
    };
  }
  private ray(x: number, y: number) {
    const r = this.host.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), this.camera());
    return ray.ray;
  }
  private down(e: PointerEvent, axis?: number) {
    if (e.button !== 0 || !this.options || this.drag || (axis !== undefined && this.options.axes?.[axis] === false)) return;
    e.preventDefault(); e.stopPropagation(); this.camera().updateMatrixWorld();
    const anchor = new THREE.Vector3(...this.options.anchor), direction = this.camera().getWorldDirection(new THREE.Vector3());
    const components = direction.toArray().map(Math.abs), blocked = components.indexOf(Math.max(...components));
    const free = [0, 1, 2].map(k => this.options!.axes?.[k] !== false && (axis === undefined ? k !== blocked : k === axis));
    if (!free.some(Boolean)) return;
    const normal = axis === undefined ? new THREE.Vector3().setComponent(blocked, 1) : direction.clone().setComponent(axis, 0);
    if (normal.lengthSq() < 1e-8) return;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), anchor);
    const target = e.currentTarget as HTMLElement;
    this.drag = { pointer: e.pointerId, target, options: this.options, x: e.clientX, y: e.clientY, plane,
      origin: this.ray(e.clientX, e.clientY).intersectPlane(plane, new THREE.Vector3()) ?? anchor, free,
      camera: this.cameraKey(), delta: [0, 0, 0] };
    target.setPointerCapture(e.pointerId);
  }
  private move = (e: PointerEvent) => {
    const d = this.drag; if (!d || d.pointer !== e.pointerId) return;
    const hit = this.ray(e.clientX, e.clientY).intersectPlane(d.plane, new THREE.Vector3()); if (!hit) return;
    const raw = hit.sub(d.origin).toArray();
    const delta = raw.map((v, k) => d.free[k] && Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 5 ? Math.round(v / d.options.unit) * d.options.unit : 0) as Vec3;
    d.delta = d.options.constrain(delta);
    d.options.preview(d.delta, d.delta.some((v, k) => Math.abs(v - delta[k]) > 1e-7)); this.frame();
  };
  private up = (e: PointerEvent) => {
    const d = this.drag; if (!d || d.pointer !== e.pointerId || e.button !== 0) return;
    this.move(e); this.cancel(); if (d.delta.some(v => v !== 0)) d.options.commit(d.delta);
  };
  cancel = () => {
    const d = this.drag; this.drag = undefined;
    if (d?.target.hasPointerCapture(d.pointer)) d.target.releasePointerCapture(d.pointer);
    if (d) d.options.preview(); this.frame();
  };
  private key = (e: KeyboardEvent) => {
    if (this.drag && (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())))) {
      e.preventDefault(); e.stopImmediatePropagation(); this.cancel();
    }
  };
  private secondary = (e: PointerEvent) => {
    if (e.button === 2 && this.drag) { e.preventDefault(); e.stopImmediatePropagation(); this.cancel(); }
  };
  dispose() {
    this.cancel(); this.element.remove(); window.removeEventListener('keydown', this.key, true);
    window.removeEventListener('blur', this.cancel); window.removeEventListener('pointerdown', this.secondary, true);
  }
}

import * as THREE from 'three';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { affectedCorners, cornerVertices, freeformEdit, rotateVertex, selectionCenter, selectionCorners, selectionLabel, selectionLocks, VERTEX_EDGES, VERTEX_FACES, worldVertex, type HullSelection, type MirrorAxes } from '../../ships/constructionVertex';

export type { BuilderFreeformOptions } from './builderScene';
import type { BuilderFreeformOptions } from './builderScene';
interface Drag {
  pointer: number; target: Element; source: ConstructionSource; options: BuilderFreeformOptions;
  primitive: ConstructionPrimitive; x: number; y: number; anchor: THREE.Vector3;
  plane: THREE.Plane; origin: THREE.Vector3; free: boolean[]; camera: string;
  replacements: ConstructionPrimitive[];
}
const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, parent: SVGElement): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag); parent.append(element); return element;
}
/** Source components, independent of compiled triangulation. Pointer release commits
 * one command; the same rigid transform serves axis and view-plane movement. */
export class FreeformHandles {
  readonly element = document.createElement('div');
  private drawing = document.createElementNS(SVG, 'svg');
  private faceGroup = svg('g', this.drawing);
  private faces = VERTEX_FACES.map(() => svg('path', this.faceGroup));
  private edges = VERTEX_EDGES.map(() => svg('path', this.drawing));
  private edgeTargets = VERTEX_EDGES.map(() => svg('path', this.drawing));
  private corners = Array.from({ length: 8 }, () => svg('circle', this.drawing));
  private axisLines = Array.from({ length: 3 }, () => svg('path', this.drawing));
  private buttons: HTMLButtonElement[];
  private axisButtons: HTMLButtonElement[];
  private planeButton: HTMLButtonElement;
  private drag?: Drag;
  private lastEvent?: PointerEvent;
  refresh() { if (this.lastEvent && this.drag) this.move(this.lastEvent); }
  private source?: ConstructionSource;
  private options?: BuilderFreeformOptions;
  private hovered?: HullSelection;
  private faceOrder = '';

  constructor(private host: HTMLElement, private camera: () => THREE.Camera,
    private preview: (replacements?: ConstructionPrimitive[]) => void,
    private snapping?: { resolve(raw: Vec3, free: boolean[], primitive: ConstructionPrimitive, options: BuilderFreeformOptions): Vec3; clear(): void }) {
    this.element.className = 'sb-freeform-handles';
    this.drawing.classList.add('sb-freeform-overlay'); this.drawing.setAttribute('aria-hidden', 'true');
    this.element.append(this.drawing);
    this.buttons = Array.from({ length: 12 }, (_,index) => {
      const b = this.button('sb-freeform-handle');
      this.bind(b, () => ({ mode: this.options?.selection.mode ?? 'vertex', index }));
      b.addEventListener('click', () => this.options?.onSelect({ mode: this.options.selection.mode, index }));
      return b;
    });
    this.faces.forEach((path,index) => this.bind(path, () => ({ mode: 'face', index })));
    this.edgeTargets.forEach((path,index) => this.bind(path, () => ({ mode: 'edge', index })));
    this.axisButtons = ['X','Y','Z'].map((name,k) => {
      const b = this.button('sb-freeform-axis'); b.textContent = name; b.dataset.axis = name;
      b.setAttribute('aria-label', `Move local ${name}`);
      this.bind(b, () => this.options!.selection, k);
      b.addEventListener('keydown', e => {
        if (!this.options || !this.source || !['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const delta: Vec3 = [0,0,0]; delta[k] = this.options.unit * (['ArrowUp','ArrowRight'].includes(e.key) ? 1 : -1);
        this.options.onCommit(freeformEdit(this.source,this.options.id,this.options.selection,delta,this.options.axes,this.options.snap));
      });
      return b;
    });
    this.planeButton = this.button('sb-freeform-plane');
    this.planeButton.setAttribute('aria-label', 'Move in view plane');
    this.planeButton.title = 'Drag in the local coordinate plane facing you';
    this.bind(this.planeButton, () => this.options!.selection);
    host.append(this.element);
    window.addEventListener('keydown', this.key, true); window.addEventListener('blur', this.cancel);
    window.addEventListener('pointerdown', this.secondary, true);
  }
  private button(className: string) {
    const b = document.createElement('button'); b.className = className; b.type = 'button'; this.element.append(b); return b;
  }
  private bind(target: Element, selection: () => HullSelection, axis?: number) {
    target.addEventListener('pointerdown', event => this.down(event as PointerEvent, selection(), axis));
    target.addEventListener('pointermove', event => this.move(event as PointerEvent));
    target.addEventListener('pointerup', event => this.up(event as PointerEvent));
    target.addEventListener('pointercancel', this.cancel);
    target.addEventListener('lostpointercapture', () => { if (this.drag?.target === target) this.cancel(); });
    target.addEventListener('contextmenu', e => e.preventDefault());
    target.addEventListener('pointerenter', () => { this.hovered = selection(); });
    target.addEventListener('pointerleave', () => { this.hovered = undefined; });
  }
  get dragging() { return !!this.drag; }
  get moving() { return !!this.drag && !!this.lastEvent && Math.hypot(this.lastEvent.clientX - this.drag.x, this.lastEvent.clientY - this.drag.y) >= 5; }
  update(source: ConstructionSource, options?: BuilderFreeformOptions) {
    const d = this.drag;
    if (d && (source.revision !== d.source.revision || source.id !== d.source.id || options?.id !== d.options.id
      || options.unit !== d.options.unit || options.snap !== d.options.snap
      || JSON.stringify(options.axes) !== JSON.stringify(d.options.axes)
      || JSON.stringify(options.selection) !== JSON.stringify(d.options.selection))) this.cancel();
    this.source = source; this.options = options; this.frame();
  }
  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera());
    return new THREE.Vector2((p.x + 1) * this.host.clientWidth / 2, (1 - p.y) * this.host.clientHeight / 2);
  }
  private anchor(p: ConstructionPrimitive, selection: HullSelection) {
    const local = rotateVertex(selectionCenter(p,selection),p.rotationDeg);
    return new THREE.Vector3(...local.map((n,k) => n + p.position[k]) as Vec3);
  }
  private axes(p: ConstructionPrimitive) {
    return [0,1,2].map(k => new THREE.Vector3(...rotateVertex([k===0?1:0,k===1?1:0,k===2?1:0],p.rotationDeg)));
  }
  private cameraKey() { return [...this.camera().matrixWorld.elements,...this.camera().projectionMatrix.elements].join(','); }
  frame() {
    // OrbitControls can change the pose after its last matrix update. Project
    // through the same camera matrix the renderer will use this frame.
    this.camera().updateMatrixWorld();
    if (this.drag && this.drag.camera !== this.cameraKey()) { this.cancel(); return; }
    const o = this.options, p = this.drag?.replacements.find(p => p.id === o?.id) ?? this.source?.construction.primitives.find(p => p.id === o?.id);
    this.element.hidden = !o || !p; if (!o || !p) return;
    const mode = o.selection.mode, selected = selectionCorners(o.selection), affected = affectedCorners(o.selection,o.axes);
    const world = cornerVertices(p).map(v => new THREE.Vector3(...worldVertex(p,v)));
    const screen = world.map(v => this.project(v)), depths = world.map(v => v.clone().project(this.camera()).z);
    const inView = (indices: readonly number[]) => indices.every(i => depths[i] >= -1 && depths[i] <= 1);
    const pathFor = (indices: readonly number[], closed = false) => indices.map((i,n) => `${n?'L':'M'}${screen[i].x},${screen[i].y}`).join(' ') + (closed ? ' Z' : '');
    const state = (indices: readonly number[], selection: HullSelection) => selected.length === indices.length && indices.every(i => selected.includes(i)) ? 'selected'
      : indices.every(i => affected.includes(i)) ? 'mirrored' : this.hovered?.mode === selection.mode && this.hovered.index === selection.index ? 'hover' : '';
    this.faces.forEach((path,index) => {
      path.setAttribute('d', pathFor(VERTEX_FACES[index].corners,true));
      path.setAttribute('class', `sb-freeform-face ${mode==='face'?'is-pickable':''}`);
      path.dataset.state = mode === 'face' ? state(VERTEX_FACES[index].corners,{ mode, index }) : '';
      path.style.display = mode === 'face' && inView(VERTEX_FACES[index].corners) ? '' : 'none';
    });
    const ordered = this.faces.map((path,index) => ({ path, depth: VERTEX_FACES[index].corners.reduce<number>((n,i) => n+depths[i],0) / 4, index })).sort((a,b) => b.depth-a.depth);
    const order = ordered.map(f => f.index).join(',');
    if (!this.drag && order !== this.faceOrder) { ordered.forEach(f => this.faceGroup.append(f.path)); this.faceOrder = order; }
    this.edges.forEach((path,index) => {
      path.setAttribute('d',pathFor(VERTEX_EDGES[index]));
      path.setAttribute('class','sb-freeform-edge');
      path.dataset.state = state(VERTEX_EDGES[index],{ mode:'edge',index });
      path.style.display = inView(VERTEX_EDGES[index]) ? '' : 'none';
      const target = this.edgeTargets[index];
      target.setAttribute('d',pathFor(VERTEX_EDGES[index])); target.setAttribute('class','sb-freeform-edge-target');
      target.style.display = mode === 'edge' && inView(VERTEX_EDGES[index]) ? '' : 'none';
    });
    this.corners.forEach((circle,i) => {
      circle.setAttribute('cx',String(screen[i].x)); circle.setAttribute('cy',String(screen[i].y)); circle.setAttribute('r','4');
      circle.setAttribute('class','sb-freeform-point'); circle.dataset.state = selected.includes(i) ? 'selected' : affected.includes(i) ? 'mirrored' : '';
      circle.style.display = inView([i]) ? '' : 'none';
    });
    const count = mode === 'vertex' ? 8 : mode === 'edge' ? 12 : 6;
    this.buttons.forEach((b,index) => {
      const selection = { mode, index }, indices = selectionCorners(selection);
      b.hidden = index >= count || !inView(indices); if (b.hidden) return;
      const anchor = this.anchor(p,selection), pos = this.project(anchor);
      b.style.transform = `translate(${pos.x}px,${pos.y}px)`;
      b.style.zIndex = String(1 + Math.round((1 - anchor.clone().project(this.camera()).z) * 100));
      b.dataset.mode = mode; b.dataset.index = String(index); b.dataset.state = state(indices,selection);
      b.setAttribute('aria-label', selectionLabel(selection)); b.setAttribute('aria-pressed',String(index === o.selection.index));
      b.title = `${selectionLabel(selection)} · select or drag in the view plane`;
    });
    const anchor = this.anchor(p,o.selection), origin = this.project(anchor), axes = this.axes(p), locks = selectionLocks(o.selection,o.axes);
    const vectors = axes.map(a => this.project(anchor.clone().add(a)).sub(origin));
    const length = Math.max(...vectors.map(v => v.length()),1e-6), scale = 76 / length;
    const visible = anchor.clone().project(this.camera()).z >= -1 && anchor.clone().project(this.camera()).z <= 1;
    this.axisButtons.forEach((b,k) => {
      const v = vectors[k].clone().multiplyScalar(scale), pos = origin.clone().add(v), headOn = v.length() < 18;
      b.hidden = !visible || headOn; b.disabled = locks[k]; b.style.transform = `translate(${pos.x}px,${pos.y}px)`;
      b.title = locks[k] ? `Local ${'XYZ'[k]} locked by symmetry` : `Drag local ${'XYZ'[k]}; arrow keys nudge by ${o.unit} m`;
      const line = this.axisLines[k]; line.style.display = b.hidden ? 'none' : '';
      line.setAttribute('d',`M${origin.x},${origin.y} L${pos.x},${pos.y}`); line.setAttribute('class','sb-freeform-axis-line');
      line.dataset.axis = 'XYZ'[k]; line.dataset.locked = String(locks[k]);
    });
    this.planeButton.hidden = !visible; this.planeButton.style.transform = `translate(${origin.x}px,${origin.y}px)`;
  }
  private ray(x: number,y: number) {
    const r = this.host.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1),this.camera()); return ray.ray;
  }
  private down(e: PointerEvent, selection: HullSelection, axis?: number) {
    if (e.button !== 0 || !this.options || !this.source || this.drag) return;
    const primitive = this.source.construction.primitives.find(p => p.id === this.options!.id); if (!primitive) return;
    e.preventDefault(); e.stopPropagation();
    const options = { ...this.options, selection }, target = e.currentTarget as Element, anchor = this.anchor(primitive,selection);
    const direction = this.camera().getWorldDirection(new THREE.Vector3()), axes = this.axes(primitive), locks = selectionLocks(selection,options.axes);
    const blocked = axes.map(v => Math.abs(v.dot(direction))).indexOf(Math.max(...axes.map(v => Math.abs(v.dot(direction)))));
    const free = locks.map((locked,k) => !locked && (axis === undefined ? k !== blocked : k === axis));
    const normal = axis === undefined ? axes[blocked] : direction.clone().addScaledVector(axes[axis],-direction.dot(axes[axis]));
    options.onSelect(selection);
    if (!free.some(Boolean) || normal.lengthSq() < 1e-8) return;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(),anchor);
    this.drag = { pointer:e.pointerId,target,source:this.source,options,primitive,x:e.clientX,y:e.clientY,anchor,plane,
      origin:this.ray(e.clientX,e.clientY).intersectPlane(plane,new THREE.Vector3()) ?? anchor.clone(),free,camera:this.cameraKey(),replacements:[] };
    target.setPointerCapture(e.pointerId);
  }
  private move = (e: PointerEvent) => {
    const d = this.drag; if (!d || e.pointerId !== d.pointer) return;
    this.lastEvent = e;
    if (Math.hypot(e.clientX-d.x,e.clientY-d.y) < 5) {
      if (d.replacements.length) { d.replacements = []; this.preview([]); this.frame(); }
      return;
    }
    const hit = this.ray(e.clientX,e.clientY).intersectPlane(d.plane,new THREE.Vector3()); if (!hit) return;
    const local = rotateVertex(hit.sub(d.origin).toArray() as Vec3,-d.primitive.rotationDeg);
    const raw = local.map((v,k) => d.free[k] ? v : 0) as Vec3;
    const delta = this.snapping ? this.snapping.resolve(raw, d.free, d.primitive, d.options) : raw.map(v => Math.round(v/d.options.unit)*d.options.unit) as Vec3;
    d.replacements = freeformEdit(d.source,d.options.id,d.options.selection,delta,d.options.axes,d.options.snap);
    this.preview(d.replacements); this.frame();
  };
  private up = (e: PointerEvent) => {
    const d = this.drag; if (!d || e.pointerId !== d.pointer || e.button !== 0) return;
    this.move(e); this.cancel(); if (d.replacements.length) d.options.onCommit(d.replacements);
  };
  cancel = () => {
    const d = this.drag; this.drag = undefined; this.lastEvent = undefined;
    if (d) this.snapping?.clear();
    if (d?.target.hasPointerCapture(d.pointer)) d.target.releasePointerCapture(d.pointer);
    if (d) this.preview(); this.frame();
  };
  private secondary = (e: PointerEvent) => { if (e.button === 2 && this.drag) { e.preventDefault(); e.stopImmediatePropagation(); this.cancel(); } };
  private key = (e: KeyboardEvent) => {
    if (this.drag && (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())))) {
      e.preventDefault(); e.stopImmediatePropagation(); this.cancel();
    }
  };
  dispose() {
    this.cancel(); this.element.remove(); window.removeEventListener('keydown',this.key,true);
    window.removeEventListener('blur',this.cancel); window.removeEventListener('pointerdown',this.secondary,true);
  }
}

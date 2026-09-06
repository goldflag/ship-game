import { Raycaster, Vector2, type Camera } from 'three/webgpu';
import type { InspectionEntry } from '../ships/inspection';
import type { ShipInspection } from './ShipInspection';

export const INSPECTION_TOOLTIP_ID = 'port-inspection-tooltip';
export interface InspectionHoverInfo { entry: InspectionEntry; x: number; y: number; }

/** Browser-only hover feedback for armor plates and internal volumes. Picking never changes selection or simulation state. */
export class InspectionHover {
  private abort = new AbortController();
  private pointer?: { x: number; y: number };
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private inspection?: ShipInspection;
  private current: InspectionHoverInfo | null = null;
  private listeners = new Set<(hover: InspectionHoverInfo | null) => void>();

  constructor(private canvas: HTMLCanvasElement, private camera: Camera) {
    const options = { signal: this.abort.signal };
    const track = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons) { this.clear(); return; }
      this.pointer = { x: event.clientX, y: event.clientY };
    };
    canvas.addEventListener('pointermove', track, options);
    canvas.addEventListener('pointerup', track, options);
    for (const type of ['pointerleave', 'pointerdown', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => this.clear(), options);
    window.addEventListener('blur', () => this.clear(), options);
    window.addEventListener('resize', () => this.clear(), options);
    window.addEventListener('keydown', event => { if (event.key === 'Escape') this.clear(); }, options);
  }
  subscribe(listener: (hover: InspectionHoverInfo | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => { this.listeners.delete(listener); };
  }
  update(inspection?: ShipInspection): void {
    if (this.inspection !== inspection) this.inspection?.setHovered(undefined);
    this.inspection = inspection;
    const point = this.pointer;
    const hoverable = inspection?.mode === 'armor' || inspection?.mode === 'internals';
    if (!inspection || !hoverable || !point || document.hidden || document.elementFromPoint(point.x, point.y) !== this.canvas) {
      this.publish(null); return;
    }
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) { this.publish(null); return; }
    this.ndc.set((point.x - bounds.left) / bounds.width * 2 - 1, 1 - (point.y - bounds.top) / bounds.height * 2);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const entry = inspection.pick(this.raycaster);
    this.publish(entry ? { entry, ...point } : null);
  }
  clear(): void { this.pointer = undefined; this.publish(null); }
  private publish(hover: InspectionHoverInfo | null): void {
    this.inspection?.setHovered(hover?.entry.id);
    if (this.current?.entry === hover?.entry && this.current?.x === hover?.x && this.current?.y === hover?.y) return;
    this.current = hover;
    if (hover) this.canvas.setAttribute('aria-describedby', INSPECTION_TOOLTIP_ID);
    else this.canvas.removeAttribute('aria-describedby');
    this.listeners.forEach(listener => listener(hover));
  }
  dispose(): void { this.abort.abort(); this.clear(); this.listeners.clear(); }
}

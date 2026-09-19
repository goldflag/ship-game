import * as THREE from 'three';
import type { Vec3 } from '../../../ships/blueprint';
import type { BuilderScene } from '../builderScene';
import type { BuilderTag } from '../BuilderViewport';
import { BRASS, MINT, SALMON, clamp } from './resources';

const LEADER: Record<BuilderTag['tone'], string> = { mint: MINT, brass: BRASS, bad: SALMON };

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
type Project = (point: THREE.Vector3) => { x: number; y: number } | undefined;

/** The box-selection rectangle from the press to the pointer, in canvas pixels. */
export function boxRect(canvas: HTMLCanvasElement, start: { x: number; y: number }, event: { clientX: number; clientY: number }): ScreenRect {
  const bounds = canvas.getBoundingClientRect();
  return {
    left: Math.min(start.x, event.clientX) - bounds.left,
    top: Math.min(start.y, event.clientY) - bounds.top,
    right: Math.max(start.x, event.clientX) - bounds.left,
    bottom: Math.max(start.y, event.clientY) - bounds.top,
  };
}

export function showSelectionBox(overlay: HTMLElement, rect?: ScreenRect) {
  const box = overlay.querySelector<HTMLElement>('[data-selection-box]')!;
  box.hidden = !rect;
  if (!rect) return;
  Object.assign(box.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.right - rect.left}px`,
    height: `${rect.bottom - rect.top}px`,
  });
}

export interface TagView {
  host: HTMLElement;
  overlay: HTMLElement;
  tags: BuilderTag[];
  project: Project;
  /** The projected move or rotate handles, which position tags must leave clear. */
  handles?: ScreenRect;
}

/** HTML tags follow their world anchors each frame; React owns their content. */
export function placeTags(view: TagView) {
  const width = view.host.clientWidth,
    height = view.host.clientHeight;
  const narrow = width <= 1100,
    builder = view.tags.length ? view.host.closest('.shipbuilder') : null;
  const header = narrow ? builder?.querySelector<HTMLElement>('.sb-top') : null,
    palette = narrow ? builder?.querySelector<HTMLElement>('.sb-dock') : null;
  const ledger = builder?.querySelector<HTMLElement>('.sb-ledger'),
    hostRect = builder ? view.host.getBoundingClientRect() : null;
  const ledgerRect = ledger?.offsetWidth && ledger.offsetHeight ? ledger.getBoundingClientRect() : null;
  const hostTop = hostRect?.top ?? 0;
  // Keep editable tags beside the tool rail and between the wrapped header and palette.
  const left = narrow ? 80 : 8,
    top = header ? header.getBoundingClientRect().bottom - hostTop + 12 : 60;
  const bottom = narrow && palette?.offsetHeight ? palette.getBoundingClientRect().top - hostTop - 12 : height - 90;
  let leaders = '';
  for (const tag of view.tags) {
    const element = view.overlay.querySelector<HTMLElement>(`[data-tag="${CSS.escape(tag.key)}"]`);
    if (!element) continue;
    const screen = view.project(new THREE.Vector3(...tag.anchor));
    if (!screen) {
      element.style.visibility = 'hidden';
      continue;
    }
    element.style.maxHeight = narrow ? `${Math.max(80, bottom - top)}px` : '';
    const tagWidth = element.offsetWidth,
      tagHeight = element.offsetHeight;
    let x = clamp(screen.x + tag.dx, left, Math.max(left, width - tagWidth - 8)),
      y = clamp(screen.y + tag.dy, top, Math.max(top, bottom - tagHeight));
    if (ledgerRect) {
      const ledgerLeft = ledgerRect.left - (hostRect?.left ?? 0) - 12,
        ledgerTop = ledgerRect.top - hostTop - 12;
      const ledgerRight = ledgerRect.right - (hostRect?.left ?? 0) + 12,
        ledgerBottom = ledgerRect.bottom - hostTop + 12;
      if (x < ledgerRight && x + tagWidth > ledgerLeft && y < ledgerBottom && y + tagHeight > ledgerTop) {
        const beside = ledgerLeft - tagWidth,
          below = ledgerBottom;
        // Choose the smallest move that leaves the whole editor clear of the Ledger.
        if (below + tagHeight <= bottom && (beside < left || below - y < x - beside)) y = below;
        else if (beside >= left) x = beside;
      }
    }
    // Compact layouts may push the position tag back over the selection.
    // Keep its inputs clear of the actual projected movement handles.
    const handles = view.handles;
    if (
      handles &&
      (tag.key.startsWith('piece-') || tag.key === 'group') &&
      x < handles.right &&
      x + tagWidth > handles.left &&
      y < handles.bottom &&
      y + tagHeight > handles.top
    ) {
      if (handles.bottom + 12 + tagHeight <= bottom) y = handles.bottom + 12;
      else if (handles.top - 12 - tagHeight >= top) y = handles.top - 12 - tagHeight;
    }
    element.style.visibility = 'visible';
    element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const endX = screen.x < x + tagWidth / 2 ? x : x + tagWidth,
      endY = y + tagHeight / 2;
    leaders += `<line x1="${screen.x.toFixed(1)}" y1="${screen.y.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="${LEADER[tag.tone]}"/><circle cx="${screen.x.toFixed(1)}" cy="${screen.y.toFixed(1)}" r="2.5" fill="${LEADER[tag.tone]}"/>`;
  }
  const svg = view.overlay.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = leaders;
  }
}

/** The readout under the palette: the rotation while turning, the overlap notice while a placement or move is blocked. */
export function showGestureFeedback(overlay: HTMLElement, text: string) {
  const feedback = overlay.querySelector<HTMLElement>('[data-gesture-feedback]');
  if (feedback) {
    feedback.textContent = text;
    feedback.hidden = !feedback.textContent;
  }
}

/** The measuring line and its length tag; an open measurement follows `hoverPoint`. */
export function placeMeasure(overlay: HTMLElement, line: THREE.Line, measured: BuilderScene['measure'], hoverPoint: () => Vec3 | undefined, project: Project) {
  const measure = overlay.querySelector<HTMLElement>('[data-measure]');
  if (measure) {
    const from = measured?.from,
      to = measured?.to ?? (from ? hoverPoint() : undefined);
    if (from && to) {
      const a = new THREE.Vector3(...from),
        b = new THREE.Vector3(...to);
      line.geometry.setFromPoints([a, b]);
      const middle = project(a.clone().add(b).multiplyScalar(0.5));
      if (middle) {
        measure.innerHTML = `<b>${a.distanceTo(b).toFixed(2)} m</b>${measured?.to ? '' : ' · click to end'}`;
        measure.style.visibility = 'visible';
        measure.style.transform = `translate(${(middle.x + 14).toFixed(1)}px, ${(middle.y - 30).toFixed(1)}px)`;
      }
    } else measure.style.visibility = 'hidden';
  }
}

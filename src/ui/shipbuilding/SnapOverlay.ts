import type { Vec3 } from '../../ships/blueprint';
import type { ProjectSnap, SnapGuide } from './snapping';

const NS = 'http://www.w3.org/2000/svg';
/** Screen-sized, non-interactive geometry feedback. No text covers the model. */
export class SnapOverlay {
  readonly element = document.createElementNS(NS, 'svg');
  private center = document.createElementNS(NS, 'path');
  private marks = Array.from({ length: 3 }, () => ({ line: document.createElementNS(NS, 'path'), edge: document.createElementNS(NS, 'path'), point: document.createElementNS(NS, 'circle') }));
  constructor(host: HTMLElement) {
    this.element.classList.add('sb-snap-overlay'); this.element.setAttribute('aria-hidden', 'true');
    this.element.append(this.center);
    for (const mark of this.marks) this.element.append(mark.line, mark.edge, mark.point);
    host.append(this.element);
  }
  frame(project: ProjectSnap, guides: SnapGuide[], centerline?: [Vec3, Vec3]) {
    const path = (points?: [Vec3, Vec3]) => {
      if (!points) return '';
      const a = project(points[0]), b = project(points[1]); return a && b ? `M${a[0]},${a[1]} L${b[0]},${b[1]}` : '';
    };
    this.center.setAttribute('d', path(centerline)); this.center.setAttribute('stroke', '#e0c58d');
    this.center.setAttribute('stroke-dasharray', guides.some(g => g.centerline && g.active) ? '' : '7 5');
    this.center.setAttribute('opacity', '.75');
    this.marks.forEach((mark, i) => {
      const guide = guides[i], point = guide && project(guide.to);
      for (const el of Object.values(mark)) el.style.display = guide && point ? '' : 'none';
      if (!guide || !point) return;
      const color = guide.centerline ? '#e0c58d' : '#86e4c5';
      for (const el of Object.values(mark)) { el.setAttribute('stroke', color); el.setAttribute('opacity', guide.active ? '1' : '.65'); }
      mark.line.setAttribute('d', path([guide.from, guide.to])); mark.line.setAttribute('stroke-dasharray', guide.active ? '' : '4 4');
      mark.edge.setAttribute('d', path(guide.edge)); mark.edge.setAttribute('stroke-dasharray', guide.active ? '' : '4 4');
      mark.point.setAttribute('cx', String(point[0])); mark.point.setAttribute('cy', String(point[1])); mark.point.setAttribute('r', guide.active ? '4' : '3');
    });
  }
  dispose() { this.element.remove(); }
}

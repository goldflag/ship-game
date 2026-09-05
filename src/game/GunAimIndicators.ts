import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { GunAimPoint } from './gunAim';

export function projectGunAim(point: Vector3, camera: PerspectiveCamera, width: number, height: number) {
  const local = point.clone().applyMatrix4(camera.matrixWorldInverse);
  const behind = local.z >= 0;
  const distance = Math.max(.001, Math.abs(local.z));
  let x = local.x * camera.projectionMatrix.elements[0] / distance;
  let y = -local.y * camera.projectionMatrix.elements[5] / distance;
  const edge = behind || Math.abs(x) > .88 || Math.abs(y) > .76;
  if (behind) { x = Math.sign(x) || 1; y = 0; }
  const angle = Math.atan2(y * height, x * width);
  if (edge) {
    // Direction cues sit around the clear center, away from edge instruments.
    x = Math.cos(angle) * .68;
    y = Math.sin(angle) * .58;
  }
  return { x: (x + 1) * width / 2, y: (y + 1) * height / 2, edge, behind, angle };
}

type Marker = ReturnType<typeof projectGunAim> & { points: GunAimPoint[]; state: string; reload: number; };

function markerState(point: GunAimPoint): string {
  if (['disabled', 'empty', 'blocked'].includes(point.status)) return point.status;
  if (!point.aligned) return 'turning';
  return point.status === 'ready' ? 'aligned' : 'reloading';
}

export function groupGunAim(points: GunAimPoint[], camera: PerspectiveCamera, width: number, height: number): Marker[] {
  const groups: Marker[] = [];
  for (const point of points) {
    const screen = projectGunAim(new Vector3(...point.point), camera, width, height);
    const state = markerState(point), reload = Math.ceil(point.reload);
    // A shared number/countdown must mean the same thing for every listed gun.
    const group = groups.find(group => group.state === state && group.reload === reload && group.points[0].status === point.status && group.edge === screen.edge && group.behind === screen.behind && Math.hypot(group.x - screen.x, group.y - screen.y) < 24);
    if (group) group.points.push(point);
    else groups.push({ ...screen, points: [point], state, reload });
  }
  return groups;
}

type LabelBox = { x: number; y: number; width: number; height: number };
export function placeGunAimLabels(labels: LabelBox[], width: number, height: number): LabelBox[] {
  const placed: LabelBox[] = [];
  for (const label of labels) {
    const box = { ...label, x: Math.max(8, Math.min(width - label.width - 8, label.x - label.width / 2)), y: label.y + 19 };
    const overlap = (other: LabelBox) => box.x < other.x + other.width + 3 && box.x + box.width + 3 > other.x && box.y < other.y + other.height + 3 && box.y + box.height + 3 > other.y;
    let collision: LabelBox | undefined;
    while ((collision = placed.find(overlap))) box.y = collision.y + collision.height + 3;
    if (box.y + box.height > height - 8) {
      box.y = label.y - 19 - box.height;
      while ((collision = placed.find(overlap))) box.y = collision.y - box.height - 3;
    }
    placed.push(box);
  }
  return placed;
}

/** Frame-rate DOM overlay, like ship labels: no React render or combat mutation. */
export class GunAimIndicators {
  private root = document.createElement('div');
  private marks: { root: HTMLDivElement; arrow: HTMLSpanElement; label: HTMLSpanElement }[] = [];
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement) {
    this.root.className = 'gun-aim-layer';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Current gun aim, numbered by turret');
    this.root.hidden = true;
    host.appendChild(this.root);
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; }

  update(points: GunAimPoint[], camera: PerspectiveCamera, visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) return;
    const groups = groupGunAim(points, camera, this.width, this.height);
    groups.forEach((group, i) => {
      let mark = this.marks[i];
      if (!mark) {
        const root = document.createElement('div'), ring = document.createElement('span');
        const arrow = document.createElement('span'), label = document.createElement('span');
        ring.className = 'gun-aim-circle'; arrow.className = 'gun-aim-arrow'; label.className = 'gun-aim-label';
        ring.setAttribute('aria-hidden', 'true'); arrow.setAttribute('aria-hidden', 'true');
        root.append(ring, arrow, label); this.root.appendChild(root);
        mark = { root, arrow, label }; this.marks.push(mark);
      }
      const reload = group.reload;
      const status = group.state === 'aligned' ? 'On aim' : group.state === 'reloading' ? `On aim · ${reload}s` : group.state === 'turning' ? `Turning${reload ? ` · ${reload}s` : ''}` : group.state === 'blocked' ? 'Blocked' : group.state === 'empty' ? 'Empty' : 'Disabled';
      const label = `${group.points.map(point => point.number).join(', ')} · ${status}${group.behind ? ' · Aft' : ''}`;
      mark.root.hidden = false;
      mark.root.className = `gun-aim-marker gun-aim-${group.state}${group.edge ? ' gun-aim-offscreen' : ''}`;
      mark.root.style.transform = `translate(${group.x.toFixed(2)}px, ${group.y.toFixed(2)}px)`;
      mark.root.setAttribute('aria-label', `${group.points.map(point => point.name).join(', ')}: ${status}${group.edge ? ', outside view' : ''}`);
      mark.arrow.style.transform = `rotate(${group.angle}rad)`;
      if (mark.label.textContent !== label) mark.label.textContent = label;
    });
    for (let i = groups.length; i < this.marks.length; i++) this.marks[i].root.hidden = true;
    // Batch measurements after content writes, then move labels only. Rings keep
    // the actual projected aim even when readiness differs at the same point.
    const boxes = placeGunAimLabels(groups.map((group, i) => ({ x: group.x, y: group.y, width: this.marks[i].label.offsetWidth, height: this.marks[i].label.offsetHeight })), this.width, this.height);
    boxes.forEach((box, i) => {
      this.marks[i].label.style.left = `${box.x - groups[i].x}px`;
      this.marks[i].label.style.top = `${box.y - groups[i].y}px`;
    });
  }

  dispose(): void { this.root.remove(); }
}

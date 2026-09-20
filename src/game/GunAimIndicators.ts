import { HUD_LAYERS } from '../ui/hudLayers';
import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { GunAimPoint } from './gunAim';

// An 80 ms time constant damps small corrections and settles 95% in 240 ms.
const AIM_SMOOTHING_SECONDS = .08;

export function projectGunAim(point: Vector3, camera: PerspectiveCamera, width: number, height: number) {
  const local = point.clone().applyMatrix4(camera.matrixWorldInverse);
  return projectLocalGunAim(local, camera, width, height);
}

function projectLocalGunAim(local: Vector3, camera: PerspectiveCamera, width: number, height: number) {
  const behind = local.z >= 0;
  const distance = Math.max(0.001, Math.abs(local.z));
  let x = (local.x * camera.projectionMatrix.elements[0]) / distance;
  let y = (-local.y * camera.projectionMatrix.elements[5]) / distance;
  const edge = behind || Math.abs(x) > 0.88 || Math.abs(y) > 0.76;
  if (behind) {
    x = Math.sign(x) || 1;
    y = 0;
  }
  const angle = Math.atan2(y * height, x * width);
  if (edge) {
    // Direction cues sit around the clear center, away from edge instruments.
    x = Math.cos(angle) * 0.68;
    y = Math.sin(angle) * 0.58;
  }
  return { x: ((x + 1) * width) / 2, y: ((y + 1) * height) / 2, edge, behind, angle };
}

type Marker = ReturnType<typeof projectGunAim> & { points: GunAimPoint[]; state: string; reload: number };

function markerState(point: GunAimPoint): string {
  if (['disabled', 'empty', 'blocked', 'out-of-arc', 'out-of-range', 'submerged'].includes(point.status)) return point.status;
  if (!point.aligned) return 'turning';
  return point.status === 'ready' ? 'aligned' : 'reloading';
}

export function groupGunAim(points: GunAimPoint[], camera: PerspectiveCamera, width: number, height: number): Marker[] {
  return groupProjectedGunAim(points, point => projectGunAim(new Vector3(...point.point), camera, width, height));
}

function groupProjectedGunAim(points: GunAimPoint[], project: (point: GunAimPoint) => ReturnType<typeof projectGunAim>): Marker[] {
  const groups: Marker[] = [];
  for (const point of points) {
    const screen = project(point);
    const state = markerState(point),
      reload = Math.ceil(point.reload);
    // A shared number/countdown must mean the same thing for every listed gun.
    const group = groups.find(
      (group) =>
        group.state === state &&
        group.reload === reload &&
        group.points[0].status === point.status &&
        group.edge === screen.edge &&
        group.behind === screen.behind &&
        Math.hypot(group.x - screen.x, group.y - screen.y) < 24,
    );
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
    const overlap = (other: LabelBox) =>
      box.x < other.x + other.width + 3 &&
      box.x + box.width + 3 > other.x &&
      box.y < other.y + other.height + 3 &&
      box.y + box.height + 3 > other.y;
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
  private aimDirections = new Map<string, Vector3>();
  private source?: object;
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement) {
    this.root.className = HUD_LAYERS.gunAim.className;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Current gun aim, numbered by turret');
    this.root.hidden = true;
    host.appendChild(this.root);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  update(points: GunAimPoint[], camera: PerspectiveCamera, visible: boolean, dt: number, source: object): void {
    this.root.hidden = !visible;
    if (!visible || this.source !== source) this.aimDirections.clear();
    this.source = source;
    if (!visible) return;
    // Smooth angular error in the current sight, not old world positions: a
    // trained gun must stay centered as its aim and the camera move together.
    // Unit depth removes range weighting; the current projection preserves zoom.
    // Track turrets, not DOM groups, which can split/reorder with readiness.
    const blend = -Math.expm1(-Math.max(0, dt) / AIM_SMOOTHING_SECONDS);
    const active = new Set(points.map(point => point.id));
    for (const id of this.aimDirections.keys()) if (!active.has(id)) this.aimDirections.delete(id);
    const groups = groupProjectedGunAim(points, point => {
      const local = new Vector3(...point.point).applyMatrix4(camera.matrixWorldInverse);
      const raw = projectLocalGunAim(local, camera, this.width, this.height);
      // Edge arrows are categorical direction cues. Never interpolate through
      // the camera plane or retain a circle's old position on re-entry.
      if (raw.edge) {
        this.aimDirections.delete(point.id);
        return raw;
      }
      local.multiplyScalar(1 / -local.z);
      let direction = this.aimDirections.get(point.id);
      if (!direction) {
        direction = local;
        this.aimDirections.set(point.id, direction);
      } else {
        direction.lerp(local, blend);
      }
      return projectLocalGunAim(direction, camera, this.width, this.height);
    });
    groups.forEach((group, i) => {
      let mark = this.marks[i];
      if (!mark) {
        const root = document.createElement('div'),
          ring = document.createElement('span');
        const arrow = document.createElement('span'),
          label = document.createElement('span');
        ring.className = 'gun-aim-circle';
        arrow.className = 'gun-aim-arrow';
        label.className = 'gun-aim-label';
        ring.setAttribute('aria-hidden', 'true');
        arrow.setAttribute('aria-hidden', 'true');
        root.append(ring, arrow, label);
        this.root.appendChild(root);
        mark = { root, arrow, label };
        this.marks.push(mark);
      }
      const reload = group.reload;
      const status =
        group.state === 'aligned'
          ? 'On aim'
          : group.state === 'reloading'
            ? `On aim · Reload ${reload}s`
            : group.state === 'turning'
              ? `Turning${reload ? ` · Reload ${reload}s` : ''}`
              : group.state === 'out-of-arc'
                ? 'Out of arc'
                : group.state === 'out-of-range'
                  ? 'Out of range'
                  : group.state === 'blocked'
                    ? 'Blocked'
                    : group.state === 'empty'
                      ? 'Empty'
                      : group.state === 'submerged'
                        ? 'Submerged'
                        : 'Disabled';
      const label = `${group.points.map((point) => point.number).join(', ')} · ${status}${group.behind ? ' · Aft' : ''}`;
      mark.root.hidden = false;
      mark.root.className = `gun-aim-marker gun-aim-${group.state}${group.edge ? ' gun-aim-offscreen' : ''}`;
      mark.root.style.transform = `translate(${group.x.toFixed(2)}px, ${group.y.toFixed(2)}px)`;
      mark.root.setAttribute(
        'aria-label',
        `${group.points.map((point) => point.name).join(', ')}: ${status}${group.edge ? ', outside view' : ''}`,
      );
      mark.arrow.style.transform = `rotate(${group.angle}rad)`;
      if (mark.label.textContent !== label) mark.label.textContent = label;
    });
    for (let i = groups.length; i < this.marks.length; i++) this.marks[i].root.hidden = true;
    // Batch measurements after content writes, then move labels only. Rings keep
    // the smoothed projected aim even when readiness differs at the same point.
    const boxes = placeGunAimLabels(
      groups.map((group, i) => ({
        x: group.x,
        y: group.y,
        width: this.marks[i].label.offsetWidth,
        height: this.marks[i].label.offsetHeight,
      })),
      this.width,
      this.height,
    );
    boxes.forEach((box, i) => {
      this.marks[i].label.style.left = `${box.x - groups[i].x}px`;
      this.marks[i].label.style.top = `${box.y - groups[i].y}px`;
    });
  }

  dispose(): void {
    this.root.remove();
  }
}

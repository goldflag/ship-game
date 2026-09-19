import * as THREE from 'three';
import type { Vec3 } from '../../../ships/blueprint';
import type { BuilderScene } from '../builderScene';
import { snapCoordinate } from '../editorNumbers';
import { SnapOverlay } from '../SnapOverlay';
import { resolveSnap, DEFAULT_SNAPPING, SHIP_AXES, type SnapFeature, type SnapGuide } from '../snapping';

/** Smart-alignment state for every viewport gesture: the source's features, the latched guides and their overlay. */
export class ViewportSnapping {
  features: SnapFeature[] = [];
  workingAxis = 1;
  bounds = new THREE.Box3();
  /** The guides latched by the last resolve; drawn each frame. */
  guides: SnapGuide[] = [];
  private snapLatched: string[] = [];
  private snapContext = '';
  private overlay: SnapOverlay;

  constructor(
    private host: HTMLElement,
    private camera: () => THREE.Camera,
    private scene: () => BuilderScene,
    private hullSize: THREE.Vector3,
  ) {
    this.overlay = new SnapOverlay(host);
  }

  clear() {
    this.guides = [];
    this.snapLatched = [];
    this.snapContext = '';
  }
  private project = (point: Vec3, width = this.host.clientWidth, height = this.host.clientHeight): [number, number] | undefined => {
    const p = new THREE.Vector3(...point).project(this.camera());
    return p.z >= -1 && p.z <= 1 ? [((p.x + 1) * width) / 2, ((1 - p.y) * height) / 2] : undefined;
  };
  resolve(context: string, raw: Vec3, grid: Vec3, directions: Vec3[], moving: SnapFeature[], excluded: Set<string>): Vec3 {
    if (context !== this.snapContext) {
      this.snapContext = context;
      this.snapLatched = [];
    }
    // Read layout once per pointer sample, not once per geometry projection.
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    const project = (point: Vec3) => this.project(point, width, height);
    const result = resolveSnap({
      raw,
      grid,
      directions,
      moving,
      targets: this.features.filter((f) => !excluded.has(f.owner)),
      settings: this.scene().snapping ?? DEFAULT_SNAPPING,
      project,
      previous: this.snapLatched,
    });
    this.guides = result.guides;
    this.snapLatched = result.latched;
    return result.delta;
  }
  move(ids: string[], raw: Vec3, free: boolean[]): Vec3 {
    const selected = new Set(ids),
      all = this.features.filter((f) => selected.has(f.owner));
    const centers = all.filter((f) => f.kind === 'center');
    // A group centers as a group while retaining its relative arrangement.
    const moving = all.filter((f) => f.kind === 'corner');
    if (centers.length) {
      const center = [0, 1, 2].map(
        (k) => (Math.min(...centers.map((f) => f.point[k])) + Math.max(...centers.map((f) => f.point[k]))) / 2,
      ) as Vec3;
      moving.unshift({ id: 'selection:center', owner: 'selection', kind: 'center', point: center });
    }
    this.workingAxis = free.indexOf(false);
    return this.resolve(
      `move:${ids.join(',')}`,
      raw,
      raw.map((v) => snapCoordinate(v, this.scene().gridStep)) as Vec3,
      SHIP_AXES.filter((_, k) => free[k]),
      moving,
      selected,
    );
  }
  draw() {
    const settings = this.scene().snapping ?? DEFAULT_SNAPPING;
    const guides =
      settings.enabled && settings.guides
        ? this.guides.filter((g) => g.active && (g.centerline ? settings.centerline && settings.showCenterline : settings.geometry))
        : [];
    const centered = guides.find((g) => g.centerline);
    let centerline: [Vec3, Vec3] | undefined;
    if (centered) {
      const point = centered.from;
      const padding = Math.max(2, this.hullSize.z * 0.05);
      centerline =
        this.workingAxis === 2 || this.scene().view === 'bow'
          ? [
              [0, this.bounds.min.y - padding, point[2]],
              [0, this.bounds.max.y + padding, point[2]],
            ]
          : [
              [0, point[1], this.bounds.min.z - padding],
              [0, point[1], this.bounds.max.z + padding],
            ];
    }
    this.overlay.frame(this.project, guides, centerline);
  }

  dispose() {
    this.overlay.dispose();
  }
}

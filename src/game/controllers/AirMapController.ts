import * as THREE from 'three/webgpu';
import type { Vec3 } from '../../ships/blueprint';
import { reportPosition } from '../../ui/reconReports';
import { airborne } from '../airWing';
import { projectAirMapPolygon } from '../AirMapPolygon';
import { projectAirMapPath } from '../AirMapProjection';
import type { AircraftView } from '../AircraftView';
import type { BattlefieldCamera } from '../BattlefieldCamera';
import type { ObservedShipViews } from '../ObservedShipViews';
import type { BattleSession } from '../session/BattleSession';
import { projectShipLabel } from '../ShipLabels';
import type { ShipView } from '../ShipView';

/** What the chart reads from `Game`. Every member is read at the moment of use, so a
 * battle, fleet or HUD scale that `Game` replaces is seen without re-creating the controller. */
export interface AirMapContext {
  readonly simulation: BattleSession;
  readonly camera: THREE.PerspectiveCamera;
  readonly battlefieldCamera: BattlefieldCamera;
  readonly fleetViews: readonly ShipView[];
  readonly aircraftView: Pick<AircraftView, 'observedPosition'>;
  readonly observedShipViews?: Pick<ObservedShipViews, 'position'>;
  /** The game's host element: the chart's CSS-pixel viewport. */
  readonly host: { readonly clientWidth: number; readonly clientHeight: number };
  /** The renderer's canvas: its framebuffer follows every resize without forcing a layout. */
  readonly canvas: { readonly width: number; readonly height: number };
  readonly hudScale: number;
}

/** The air and fleet chart's camera gestures and its world-to-overlay projections.
 * `Game` keeps the public methods and delegates here; opening and closing the chart is
 * part of the battle view's state and stays in `Game.setAirOperationsOpen`. */
export class AirMapController {
  private readonly projectionState = new Float64Array(35);
  private projectionVersion = 0;
  /** Label anchor height per rendered hull, measured once from the authored model. */
  private readonly fleetShipTops = new WeakMap<ShipView, number>();

  constructor(private readonly context: AirMapContext) {}

  private get width(): number {
    return this.context.host.clientWidth;
  }
  private get height(): number {
    return this.context.host.clientHeight;
  }
  private get logicalWidth(): number {
    return this.context.host.clientWidth / this.context.hudScale;
  }
  private get logicalHeight(): number {
    return this.context.host.clientHeight / this.context.hudScale;
  }

  pan(dx: number, dy: number, x?: number, y?: number): void {
    this.context.battlefieldCamera.pan(dx, dy, this.width, this.height, x, y);
  }
  zoom(delta: number, x = this.width / 2, y = this.height / 2): void {
    this.context.battlefieldCamera.zoom(delta, x, y, this.width, this.height);
  }
  fit(): void {
    this.context.battlefieldCamera.fit(this.reportedPoints(), this.width, this.height);
  }
  center(): void {
    this.centerOn(this.context.simulation.ship.x, this.context.simulation.ship.z);
  }
  /** Bring a unit chosen off the chart into view without changing zoom or angle. */
  centerOn(x: number, z: number): void {
    const view = this.context.battlefieldCamera.view;
    view.x = x;
    view.z = z;
  }
  orbit(dx: number, dy: number): void {
    this.context.battlefieldCamera.orbit(dx, dy);
  }
  setTilt(degrees: number): void {
    this.context.battlefieldCamera.setTilt((degrees * Math.PI) / 180);
  }
  resetAngle(): void {
    this.context.battlefieldCamera.resetAngle();
  }

  /** Everything the chart frames when it opens or fits: the fleet and every reported contact. */
  reportedPoints(): { x: number; z: number }[] {
    const { simulation } = this.context;
    return [
      ...simulation.actors.map((a) => a.motion),
      ...(simulation.observationTracks ?? []).map((c) => ({ x: c.estimatedPosition[0], z: c.estimatedPosition[2] })),
    ];
  }

  /** Counts the moves of everything an air-map projection reads: pose, lens and viewport.
   * An unchanged count means an overlay may reuse the points it projected last frame. */
  get projectionStamp(): number {
    const { camera, canvas, hudScale } = this.context;
    const view = camera.matrixWorldInverse.elements,
      lens = camera.projectionMatrix.elements,
      state = this.projectionState;
    // The framebuffer follows every resize, and reading it cannot force a layout mid-overlay.
    const width = canvas.width,
      height = canvas.height;
    let moved = state[32] !== width || state[33] !== height || state[34] !== hudScale;
    for (let i = 0; i < 16 && !moved; i++) moved = state[i] !== view[i] || state[16 + i] !== lens[i];
    if (!moved) return this.projectionVersion;
    state.set(view);
    state.set(lens, 16);
    state[32] = width;
    state[33] = height;
    state[34] = hudScale;
    return ++this.projectionVersion;
  }

  project(x: number, z: number, altitude = 0): [number, number] | null {
    // Use the same depth and viewport clipping as ship-view nametags.
    const point = projectShipLabel(new THREE.Vector3(x, altitude, z), this.context.camera, this.logicalWidth, this.logicalHeight);
    return point ? [point.x, point.y] : null;
  }

  /** Screen point above a friendly hull's rendered top, where the ship-view nametag sits, so a
   * fleet-chart marker rides over the ship however low the camera is. Null off screen or when
   * the hull has no rendered model, in which case the marker stays at the telemetry position. */
  projectFleetShip(id: string): [number, number] | null {
    const view = this.context.fleetViews.find((v) => v.actor.motion.id === id);
    if (!view || !view.root.visible || view.motion.y <= -40) return null;
    let top = this.fleetShipTops.get(view);
    if (top === undefined) {
      const bounds = new THREE.Box3().setFromObject(view.root.children[0]);
      top = (bounds.isEmpty() ? view.definition.hull.depth : bounds.max.y - view.root.position.y) + 5;
      this.fleetShipTops.set(view, top);
    }
    view.root.updateWorldMatrix(true, false);
    const anchor = new THREE.Vector3(0, top, 0).applyMatrix4(view.root.matrixWorld);
    const point = projectShipLabel(anchor, this.context.camera, this.logicalWidth, this.logicalHeight);
    return point ? [point.x, point.y] : null;
  }

  private contactPosition(id: string): Vec3 | undefined {
    const { simulation, aircraftView, observedShipViews } = this.context;
    const report = simulation.observationTracks?.find((contact) => contact.id === id);
    if (!report) return;
    const exterior =
      report.status === 'tracked'
        ? report.kind === 'aircraft'
          ? aircraftView.observedPosition(id)
          : observedShipViews?.position(id)
        : undefined;
    return exterior ? [exterior.x, exterior.y, exterior.z] : reportPosition(report, simulation.tick);
  }

  projectContact(id: string): [number, number] | null {
    const position = this.contactPosition(id);
    return position ? this.project(position[0], position[2], position[1]) : null;
  }

  projectContactGroup(ids: string[]): [number, number] | null {
    const positions = ids.flatMap((id) => {
      const position = this.contactPosition(id);
      return position ? [position] : [];
    });
    if (!positions.length) return null;
    const center = positions.reduce<Vec3>(
      (sum, p) => [sum[0] + p[0] / positions.length, sum[1] + p[1] / positions.length, sum[2] + p[2] / positions.length],
      [0, 0, 0],
    );
    return this.project(center[0], center[2], center[1]);
  }

  projectAircraft(id: string): [number, number] | null {
    const { simulation } = this.context;
    const plane = simulation.aircraft.find((p) => p.id === id && airborne(p));
    if (!plane) return null;
    const position = new THREE.Vector3(...plane.previousPosition).lerp(new THREE.Vector3(...plane.position), simulation.interpolationAlpha);
    return this.project(position.x, position.z, position.y);
  }

  projectPath(points: Vec3[], closed = false, filled = false): string {
    return filled
      ? projectAirMapPolygon(points, this.context.camera, this.logicalWidth, this.logicalHeight)
      : projectAirMapPath(points, this.context.camera, this.logicalWidth, this.logicalHeight, closed);
  }

  projectSquadron(ownerId: string, flightId: string): { x: number; y: number } | null {
    const { simulation } = this.context;
    const actor = simulation.actors.find((a) => a.motion.id === ownerId);
    const planes = actor?.airWing?.planes.filter((p) => p.flightId === flightId && airborne(p)) ?? [];
    if (!planes.length) return null;
    const anchor = new THREE.Vector3();
    for (const plane of planes) {
      anchor.add(new THREE.Vector3(...plane.previousPosition).lerp(new THREE.Vector3(...plane.position), simulation.interpolationAlpha));
    }
    anchor.divideScalar(planes.length).y += 24;
    return projectShipLabel(anchor, this.context.camera, this.logicalWidth, this.logicalHeight);
  }

  /** The sea-level point under a viewport pixel, or undefined above the horizon. */
  waterAt(x: number, y: number): [number, number] | undefined {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2), this.context.camera);
    const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return p ? [p.x, p.z] : undefined;
  }
}

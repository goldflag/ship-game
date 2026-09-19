import { hullPaintBands } from "../../ships/hullPaintBands";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ConstructionSource, Vec3 } from "../../ships/blueprint";
import {
  influence,
  outline,
  worldPoint,
  type Hull,
} from "../../ships/customHullModel";
import { createBuilderGrid } from "./builderGrid";
import { hullGeometry, hullMaterial } from "./CustomHullPreview";
import { levelRing, pointName, type Blend } from "./customHullEditing";

/** Orbit edits on the model; Section slices the hull at the selected section and looks forward
 * (port on the left); Plan looks down and Profile looks from port, both with the bow to the left. */
export type HullView = "orbit" | "section" | "plan" | "profile";
export type HullDragKind =
  | "point"
  | "station"
  | "width"
  | "deck"
  | "keel"
  | "rake"
  | "bulb"
  | "paint";
export interface HullDrag {
  kind: HullDragKind;
  bandId?: string;
  stationId?: string;
  point?: number;
}
export interface HullDragMove {
  /** Metres moved along ship X, Y and Z since the press. */
  delta: Vec3;
  /** Screen pixels per metre along each ship axis at the handle, for snap distances. */
  pixels: Vec3;
  /** Alt/Option inverts snapping for this sample. */
  alt: boolean;
}
/** Snap feedback: a line to the aligned geometry, or a level drawn across the view. */
export interface HullGuide {
  from: Vec3;
  to?: Vec3;
  level?: number;
}
/** Screen margins kept clear by the editor's bars and panels. */
export interface SafeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface HullViewportProps {
  hull: Hull;
  view: HullView;
  /** Bumped to reframe the hull. */
  fit: number;
  /** Bumped to bring the Orbit camera close to the selected section. */
  focus: number;
  selected: string[];
  primary: string;
  point: number;
  blend: Blend;
  invalid: boolean;
  appearance?: ConstructionSource['construction'];
  waterline?: number;
  guides: HullGuide[];
  safe: SafeArea;
  /** Where the section tag docks in the flat views. */
  dock: [number, number];
  /** Section tag positioned by the viewport: beside the ring in Orbit, docked in the flat views. */
  tag: React.RefObject<HTMLElement | null>;
  onSelectStation(id: string, additive: boolean): void;
  onSelectPoint(k: number): void;
  onDragStart(drag: HullDrag): void;
  onDragMove(move: HullDragMove): void;
  onDragEnd(): void;
  onDragCancel(): void;
  onNudge(k: number, axis: 0 | 1, sign: 1 | -1): void;
  onRemovePair(k: number): void;
}

const MINT = "#86e4c5",
  BRASS = "#e0c58d",
  IVORY = "#edf1ec",
  WATER = "#93b8c8";
const DIRECTIONS: Record<HullView, Vec3> = {
  orbit: [-0.64, 0.53, -0.56],
  section: [0, 0, 1],
  plan: [0, 1, 0],
  profile: [-1, 0, 0],
};
const UPS: Record<HullView, Vec3> = {
  orbit: [0, 1, 0],
  section: [0, 1, 0],
  plan: [1, 0, 0],
  profile: [0, 1, 0],
};
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const pad = (i: number) => String(i + 1).padStart(2, "0");
const SVG = "http://www.w3.org/2000/svg";

interface DragState {
  pointer: number;
  target: HTMLElement;
  plane: THREE.Plane;
  origin: THREE.Vector3;
  /** Unit direction for single-axis drags; free drags keep the plane's in-plane motion. */
  axis?: THREE.Vector3;
  anchor: THREE.Vector3;
  x: number;
  y: number;
  moved: boolean;
}
interface HandleSpec {
  key: string;
  className: string;
  label: string;
  world: Vec3;
  state?: string;
  axis?: "X" | "Y" | "Z";
  locked?: boolean;
  /** Screen pixels from its anchor, for a handle that would otherwise sit on another one. */
  offset?: [number, number];
  /** Hidden when its axis points at the camera. */
  direction?: THREE.Vector3;
  press?(event: PointerEvent, button: HTMLButtonElement): void;
  keyDown?(event: KeyboardEvent): void;
}

class HullScene {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private perspective = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
    this.perspective;
  private controls: OrbitControls;
  private model = new THREE.Group();
  private grid?: THREE.Group;
  private svg = document.createElementNS(SVG, "svg");
  private buttons = new Map<string, HTMLButtonElement>();
  private specs: HandleSpec[] = [];
  private lines = new Map<string, SVGPathElement>();
  private texts = new Map<string, SVGTextElement>();
  private drag?: DragState;
  private press?: { x: number; y: number; id: number };
  private hover?: string;
  private modelKey = "";
  private fitKey = "";
  private focusKey = 0;
  private gridKey = "";
  private frame = 0;
  private resize: ResizeObserver;

  constructor(
    private host: HTMLDivElement,
    private overlay: HTMLDivElement,
    private props: HullViewportProps,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    // The builder's studio light, so hull paint reads the same as on the slipway.
    this.scene.add(new THREE.HemisphereLight("#edf0f2", "#595c5f", 2.6));
    const sun = new THREE.DirectionalLight("#fff2d2", 3);
    sun.position.set(-80, 150, -120);
    this.scene.add(sun, this.model);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.zoomToCursor = true;
    this.svg.classList.add("hs-overlay-lines");
    this.svg.setAttribute("aria-hidden", "true");
    overlay.append(this.svg);
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.canvasDown);
    canvas.addEventListener("pointerup", this.canvasUp);
    canvas.addEventListener("pointermove", this.canvasHover);
    canvas.addEventListener("pointerleave", this.canvasLeave);
    window.addEventListener("keydown", this.escape, true);
    window.addEventListener("blur", this.cancel);
    window.addEventListener("pointerdown", this.secondary, true);
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(host);
    this.measure();
    this.update(props);
    this.animate();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.cancel();
    this.resize.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.grid?.traverse((o) => this.disposeObject(o));
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.svg.remove();
    for (const button of this.buttons.values()) button.remove();
    window.removeEventListener("keydown", this.escape, true);
    window.removeEventListener("blur", this.cancel);
    window.removeEventListener("pointerdown", this.secondary, true);
  }

  update(props: HullViewportProps) {
    this.props = props;
    const h = props.hull;
    const fitKey = `${props.view}:${props.fit}:${h.length}:${h.beam}:${h.depth}:${props.safe.left}`;
    if (fitKey !== this.fitKey) {
      this.fitKey = fitKey;
      this.fitView();
    }
    if (props.focus !== this.focusKey) {
      this.focusKey = props.focus;
      if (props.focus) this.focusSection();
    }
    const gridKey = `${h.length}:${h.beam}:${h.depth}:${h.offset}`;
    if (gridKey !== this.gridKey) {
      this.gridKey = gridKey;
      this.grid?.traverse((o) => this.disposeObject(o));
      this.grid?.removeFromParent();
      this.grid = createBuilderGrid(this.bounds(), 1);
      // The ruler and the hull's own bow give direction; floor chevrons near the camera only add noise.
      for (const name of ["Bow direction markers", "Bow label"])
        this.grid.getObjectByName(name)?.removeFromParent();
      this.scene.add(this.grid);
    }
    if (this.grid) this.grid.visible = props.view === "orbit";
    this.rebuildModel();
    this.specs = this.handleSpecs();
    this.syncButtons();
  }

  private disposeObject(o: THREE.Object3D) {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (material)
      (Array.isArray(material) ? material : [material]).forEach((m) => {
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      });
  }
  private clearModel() {
    this.model.traverse((o) => this.disposeObject(o));
    this.model.clear();
  }

  private bounds() {
    const h = this.props.hull,
      box = new THREE.Box3();
    for (const s of h.stations)
      for (const p of outline(h, s))
        box.expandByPoint(v3(worldPoint(h, s.t, p)));
    return box;
  }
  private cutIndex() {
    const i = this.props.hull.stations.findIndex(
      (s) => s.id === this.props.primary,
    );
    return Math.max(0, i);
  }

  /** Hull, rings and waterline for the current view, selection and hover. */
  private rebuildModel() {
    const p = this.props,
      h = p.hull;
    const key = [
      p.view,
      p.selected.join(","),
      p.primary,
      p.blend.soft,
      p.blend.reach,
      p.invalid,
      p.waterline,
      this.hover,
    ].join("|");
    if (key === this.modelKey && this.model.userData.hull === h && this.model.userData.appearance === p.appearance) return;
    this.modelKey = key;
    this.clearModel();
    this.model.userData.hull = h;
    this.model.userData.appearance = p.appearance;
    const cut = p.view === "section" ? this.cutIndex() : undefined;
    const mesh = new THREE.Mesh(
      hullGeometry(h, cut, p.appearance),
      hullMaterial(h, p.invalid),
    );
    mesh.name = "Custom hull";
    this.model.add(mesh);
    h.stations.forEach((s, i) => {
      if (cut !== undefined && i > cut) return;
      const chosen = p.selected.includes(s.id),
        blended =
          !chosen &&
          influence(h, p.selected, s.t, p.blend.soft, p.blend.reach) > 0,
        ahead = cut !== undefined && i < cut;
      const ring = outline(h, s).map((q) => v3(worldPoint(h, s.t, q)));
      ring.push(ring[0].clone());
      const geometry = new THREE.BufferGeometry().setFromPoints(ring);
      const line = (material: THREE.LineBasicMaterial, order: number) => {
        const l = new THREE.Line(geometry.clone(), material);
        if (material instanceof THREE.LineDashedMaterial)
          l.computeLineDistances();
        l.renderOrder = order;
        this.model.add(l);
      };
      if (chosen) {
        line(new THREE.LineBasicMaterial({ color: MINT }), 5);
        // The hidden side stays readable through the hull.
        line(
          new THREE.LineDashedMaterial({
            color: MINT,
            dashSize: h.depth * 0.05,
            gapSize: h.depth * 0.04,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
          }),
          4,
        );
      } else if (blended)
        line(
          new THREE.LineDashedMaterial({
            color: BRASS,
            dashSize: h.depth * 0.06,
            gapSize: h.depth * 0.04,
            depthTest: false,
          }),
          3,
        );
      else
        line(
          new THREE.LineBasicMaterial({
            color: IVORY,
            transparent: true,
            opacity: s.id === this.hover ? 0.9 : ahead ? 0.22 : 0.3,
            depthTest: !ahead,
          }),
          ahead ? 2 : 1,
        );
      geometry.dispose();
    });
    if (p.waterline !== undefined && p.view === "orbit")
      for (const side of levelRing(h, p.waterline)) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(side.map(v3)),
          new THREE.LineBasicMaterial({ color: WATER }),
        );
        line.name = "Waterline";
        line.renderOrder = 2;
        this.model.add(line);
      }
  }

  private measure() {
    const width = Math.max(1, this.host.clientWidth),
      height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height);
    this.fitView();
  }

  /** Frame the hull (or, in Section, every section outline) inside the safe area. */
  private fitView() {
    const p = this.props,
      width = Math.max(1, this.host.clientWidth),
      height = Math.max(1, this.host.clientHeight);
    const safe = p.safe,
      safeWidth = Math.max(80, width - safe.left - safe.right),
      safeHeight = Math.max(80, height - safe.top - safe.bottom);
    const box = this.bounds(),
      center = box.getCenter(new THREE.Vector3());
    if (p.view === "section") center.z = box.max.z;
    const back = v3(DIRECTIONS[p.view]).normalize(),
      up = v3(UPS[p.view]);
    const right = up.clone().cross(back).normalize(),
      top = back.clone().cross(right).normalize();
    let spanX = 0,
      spanY = 0,
      depth = 0;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const d = new THREE.Vector3(x, y, z).sub(center);
          if (p.view === "section") d.z = 0;
          spanX = Math.max(spanX, Math.abs(d.dot(right)) * 2);
          spanY = Math.max(spanY, Math.abs(d.dot(top)) * 2);
          depth = Math.max(depth, Math.abs(d.dot(back)));
        }
    const fill = p.view === "section" ? 0.72 : p.view === "orbit" ? 0.8 : 0.86;
    const radius = box.getSize(new THREE.Vector3()).length() + 10;
    if (p.view === "orbit") {
      this.camera = this.perspective;
      const tan = Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      const distance =
        Math.max(
          spanY / 2 / (tan * (safeHeight / height) * fill),
          spanX / 2 / (tan * (width / height) * (safeWidth / width) * fill),
        ) + depth;
      this.perspective.aspect = width / height;
      this.perspective.position.copy(center).addScaledVector(back, distance);
    } else {
      this.camera = this.ortho;
      const scale = Math.min(
        (safeWidth * fill) / spanX,
        (safeHeight * fill) / spanY,
      );
      Object.assign(this.ortho, {
        left: -width / 2 / scale,
        right: width / 2 / scale,
        top: height / 2 / scale,
        bottom: -height / 2 / scale,
        zoom: 1,
        near: 0.1,
        far: radius * 8,
      });
      this.ortho.position.copy(center).addScaledVector(back, radius * 3);
    }
    this.camera.up.copy(up);
    this.camera.lookAt(center);
    // Centre the safe area, not the canvas, on the hull.
    const x = width / 2 - (safe.left + safeWidth / 2),
      y = height / 2 - (safe.top + safeHeight / 2);
    this.camera.setViewOffset(width, height, x, y, width, height);
    this.camera.updateProjectionMatrix();
    this.controls.object = this.camera;
    this.controls.target.copy(center);
    this.controls.enableRotate = p.view === "orbit";
    this.controls.mouseButtons = {
      LEFT: p.view === "orbit" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.update();
  }

  /** Keep the orbit direction and move in until the selected section fills about half the safe height. */
  private focusSection() {
    const p = this.props,
      h = p.hull,
      s = h.stations.find((st) => st.id === p.primary);
    if (p.view !== "orbit" || !s) return;
    const box = new THREE.Box3().setFromPoints(
      outline(h, s).map((q) => v3(worldPoint(h, s.t, q))),
    );
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()),
      height = Math.max(1, this.host.clientHeight),
      share = (height - p.safe.top - p.safe.bottom) / height;
    const direction = this.perspective.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const tan = Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    const distance = Math.max(size.x, size.y, 2) / 2 / (tan * share * 0.5);
    this.controls.target.copy(center);
    this.perspective.position.copy(center).addScaledVector(direction, distance);
    this.controls.update();
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.place();
  };

  private project(point: THREE.Vector3) {
    const q = point.clone().project(this.camera);
    return {
      x: ((q.x + 1) * this.host.clientWidth) / 2,
      y: ((1 - q.y) * this.host.clientHeight) / 2,
      visible: q.z >= -1 && q.z <= 1,
    };
  }
  private ray(clientX: number, clientY: number) {
    const r = this.host.getBoundingClientRect(),
      caster = new THREE.Raycaster();
    caster.setFromCamera(
      new THREE.Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    return caster.ray;
  }
  private pixels(anchor: THREE.Vector3): Vec3 {
    const a = this.project(anchor);
    return AXES.map((axis) => {
      const b = this.project(anchor.clone().add(axis));
      return Math.hypot(b.x - a.x, b.y - a.y);
    }) as Vec3;
  }

  /** Handles for the current view. Positions follow the camera every frame. */
  private handleSpecs(): HandleSpec[] {
    const p = this.props,
      h = p.hull,
      specs: HandleSpec[] = [];
    const i = h.stations.findIndex((s) => s.id === p.primary);
    const s = h.stations[i];
    if (!s) return specs;
    const points = outline(h, s),
      last = points.length - 1,
      keel = last / 2,
      k0 = Math.min(p.point, last);
    const world = (k: number) => worldPoint(h, s.t, points[k]);
    if (p.view === "orbit" || p.view === "section") {
      points.forEach((_, k) => {
        if (k === k0) return;
        specs.push({
          key: `dot:${k}`,
          className: "hs-dot",
          label: `${pointName(s, k)}, section ${pad(i)}: select, or drag in the section's plane`,
          world: world(k),
          state: k === last - k0 ? "mirror" : undefined,
          press: (e, b) => {
            p.onSelectPoint(k);
            this.beginPointDrag(e, b, k, s.id, v3(world(k)));
          },
          keyDown: (e) => this.pointKey(e, k),
        });
      });
      const anchor = world(k0),
        side = k0 < keel ? -1 : 1,
        end = i === 0 || i === h.stations.length - 1;
      specs.push({
        key: "plane",
        className: "hs-plane",
        label: `${pointName(s, k0)}, section ${pad(i)}: drag in the section's plane; arrow keys nudge`,
        world: anchor,
        press: (e, b) => this.beginPointDrag(e, b, k0, s.id, v3(anchor)),
        keyDown: (e) => this.pointKey(e, k0),
      });
      const axis = (
        name: "X" | "Y" | "Z",
        direction: THREE.Vector3,
        locked: boolean,
        label: string,
      ) =>
        specs.push({
          key: `axis:${name}`,
          className: "hs-axis",
          axis: name,
          label,
          world: anchor,
          direction,
          locked,
          press: (e, b) => {
            if (locked) return;
            const station = name === "Z";
            p.onDragStart(
              station
                ? { kind: "station", stationId: s.id }
                : { kind: "point", stationId: s.id, point: k0 },
            );
            this.beginDrag(e, b, v3(anchor), { axis: direction });
          },
          keyDown: (e) => {
            if (name !== "Z") this.pointKey(e, k0);
          },
        });
      axis(
        "X",
        new THREE.Vector3(side, 0, 0),
        k0 === keel,
        k0 === keel
          ? "The keel stays on the centerline"
          : `Move ${pointName(s, k0).toLowerCase()} out or in`,
      );
      axis(
        "Y",
        new THREE.Vector3(0, 1, 0),
        false,
        `Move ${pointName(s, k0).toLowerCase()} up or down`,
      );
      axis(
        "Z",
        new THREE.Vector3(0, 0, 1),
        end,
        end
          ? "The bow and stern sections stay put"
          : `Slide section ${pad(i)} along the hull`,
      );
    }
    if (p.view === "plan")
      h.stations.forEach((st, j) => {
        const m = outline(h, st),
          w = worldPoint(h, st.t, m[m.length - 1]),
          chosen = p.selected.includes(st.id);
        specs.push({
          key: `width:${st.id}`,
          className: "hs-knob",
          state: chosen ? "selected" : undefined,
          label: `Section ${pad(j)} width`,
          world: w,
          press: (e, b) => {
            if (!chosen && !e.shiftKey) p.onSelectStation(st.id, false);
            p.onDragStart({ kind: "width", stationId: st.id });
            this.beginDrag(e, b, v3(w), { axis: AXES[0] });
          },
        });
      });
    if (p.view === "profile") {
      h.stations.forEach((st, j) => {
        const m = outline(h, st),
          chosen = p.selected.includes(st.id);
        (["deck", "keel"] as const).forEach((kind) => {
          const w = worldPoint(
            h,
            st.t,
            m[kind === "deck" ? 0 : (m.length - 1) / 2],
          );
          specs.push({
            key: `${kind}:${st.id}`,
            className: "hs-knob",
            state: chosen ? "selected" : undefined,
            label: `Section ${pad(j)} ${kind} height`,
            world: w,
            press: (e, b) => {
              if (!chosen && !e.shiftKey) p.onSelectStation(st.id, false);
              p.onDragStart({ kind, stationId: st.id });
              this.beginDrag(e, b, v3(w), { axis: AXES[1] });
            },
          });
        });
      });
      const bow = h.stations[0].points,
        mid = (bow[0].y + bow[(bow.length - 1) / 2].y) / 2;
      for (const [kind, y, label] of [
        [
          "rake",
          mid,
          `Stem rake ${Math.round(h.rake * 100)} %: drag along the hull`,
        ],
        [
          "bulb",
          -0.24,
          `Bow bulb ${Math.round(h.bulb * 100)} %: drag forward to grow it`,
        ],
      ] as const) {
        const w = worldPoint(h, 0, { x: 0, y });
        specs.push({
          key: kind,
          className: "hs-diamond",
          label,
          world: w,
          // The bulb's nose starts on the forefoot, where the bow section's keel handle sits; hold it just ahead.
          offset: kind === "bulb" ? [-22, 0] : undefined,
          press: (e, b) => {
            p.onDragStart({ kind });
            this.beginDrag(e, b, v3(w), { axis: AXES[2] });
          },
        });
      }
    }
    if (p.view === "profile" || p.view === "section") {
      for (const [index, band] of hullPaintBands(h).entries()) {
        const w = this.paintGrip(band.upperY, index);
        specs.push({ key: `paint:${band.id}`, className: "hs-grip",
          label: `Band ${index + 1} height: drag up or down`, world: w,
          press: (e, b) => { p.onDragStart({ kind: "paint", bandId: band.id }); this.beginDrag(e, b, v3(w), { axis: AXES[1] }); },
        });
      }
    }
    return specs;
  }

  /** Where the flat views draw their full-width levels, and the paint grip at its right end. */
  private levelSpan(): [Vec3, Vec3] {
    const p = this.props,
      h = p.hull,
      box = this.bounds();
    if (p.view === "section") {
      const s = h.stations[this.cutIndex()],
        z = worldPoint(h, s.t, { x: 0, y: 0 })[2],
        reach = Math.max(-box.min.x, box.max.x) + h.beam * 0.15 + 1;
      return [
        [h.offset - reach, 0, z],
        [h.offset + reach, 0, z],
      ];
    }
    const margin = h.length * 0.04 + 1;
    return [
      [h.offset, 0, box.min.z - margin],
      [h.offset, 0, box.max.z + margin],
    ];
  }
  private paintGrip(y: number, index: number): Vec3 {
    const [start, end] = this.levelSpan(), t = 1 - index * .055;
    // Stagger close boundaries horizontally so a narrow boot-top remains draggable.
    return [start[0] + (end[0] - start[0]) * t, y, start[2] + (end[2] - start[2]) * t];
  }

  private beginPointDrag(
    e: PointerEvent,
    b: HTMLButtonElement,
    k: number,
    stationId: string,
    anchor: THREE.Vector3,
  ) {
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    this.props.onDragStart({ kind: "point", stationId, point: k });
    // Points stay in their section's plane; seen edge-on, only height can follow the pointer.
    if (Math.abs(direction.z) >= 0.15)
      this.beginDrag(e, b, anchor, { normal: AXES[2] });
    else this.beginDrag(e, b, anchor, { axis: AXES[1] });
  }

  private beginDrag(
    e: PointerEvent,
    target: HTMLButtonElement,
    anchor: THREE.Vector3,
    constraint: { axis?: THREE.Vector3; normal?: THREE.Vector3 },
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.camera.updateMatrixWorld();
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    let normal = constraint.normal?.clone();
    if (constraint.axis) {
      const a = constraint.axis.clone().normalize();
      normal = direction.clone().addScaledVector(a, -direction.dot(a));
      if (normal.lengthSq() < 1e-8) {
        this.props.onDragCancel();
        return;
      }
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal!.normalize(),
      anchor,
    );
    const origin =
      this.ray(e.clientX, e.clientY).intersectPlane(
        plane,
        new THREE.Vector3(),
      ) ?? anchor.clone();
    this.drag = {
      pointer: e.pointerId,
      target,
      plane,
      origin,
      axis: constraint.axis?.clone().normalize(),
      anchor,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    target.setPointerCapture(e.pointerId);
    this.controls.enabled = false;
  }

  private dragMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    d.moved = true;
    const hit = this.ray(e.clientX, e.clientY).intersectPlane(
      d.plane,
      new THREE.Vector3(),
    );
    if (!hit) return;
    let raw = hit.sub(d.origin);
    if (d.axis) raw = d.axis.clone().multiplyScalar(raw.dot(d.axis));
    this.props.onDragMove({
      delta: [raw.x, raw.y, raw.z],
      pixels: this.pixels(d.anchor),
      alt: e.altKey,
    });
  };
  private dragUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer || e.button !== 0) return;
    this.dragMove(e);
    this.release();
    if (d.moved) this.props.onDragEnd();
    else this.props.onDragCancel();
  };
  private release() {
    const d = this.drag;
    this.drag = undefined;
    this.controls.enabled = true;
    if (d?.target.hasPointerCapture(d.pointer))
      d.target.releasePointerCapture(d.pointer);
  }
  cancel = () => {
    if (!this.drag) return;
    this.release();
    this.props.onDragCancel();
  };
  private escape = (e: KeyboardEvent) => {
    if (this.drag && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cancel();
    }
  };
  private secondary = (e: PointerEvent) => {
    if (e.button === 2 && this.drag) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cancel();
    }
  };
  private pointKey(e: KeyboardEvent, k: number) {
    const move = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [1, 1],
      ArrowDown: [1, -1],
    }[e.key] as [0 | 1, 1 | -1] | undefined;
    if (move) {
      e.preventDefault();
      e.stopPropagation();
      this.props.onNudge(k, move[0], move[1]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      this.props.onRemovePair(k);
    }
  }

  /** Buttons for the current specs; kept by key so focus and pointer capture survive re-renders. */
  private syncButtons() {
    const keys = new Set(this.specs.map((s) => s.key));
    for (const [key, button] of this.buttons)
      if (!keys.has(key) && this.drag?.target !== button) {
        button.remove();
        this.buttons.delete(key);
      }
    for (const spec of this.specs) {
      let button = this.buttons.get(spec.key);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        const b = button,
          key = spec.key;
        b.addEventListener("pointerdown", (e) =>
          this.specs.find((s) => s.key === key)?.press?.(e, b),
        );
        b.addEventListener("pointermove", this.dragMove);
        b.addEventListener("pointerup", this.dragUp);
        b.addEventListener("pointercancel", this.cancel);
        b.addEventListener("lostpointercapture", () => {
          if (this.drag?.target === b) this.cancel();
        });
        b.addEventListener("contextmenu", (e) => e.preventDefault());
        b.addEventListener("keydown", (e) =>
          this.specs.find((s) => s.key === key)?.keyDown?.(e),
        );
        this.overlay.append(b);
        this.buttons.set(key, b);
      }
      button.className = spec.className;
      if (spec.axis) {
        button.dataset.axis = spec.axis;
        button.textContent = spec.axis;
      }
      button.dataset.state = spec.state ?? "";
      button.disabled = !!spec.locked;
      button.setAttribute("aria-label", spec.label);
      button.title = spec.label;
    }
  }

  private line(key: string, className: string, d: string) {
    let path = this.lines.get(key);
    if (!path) {
      path = document.createElementNS(SVG, "path");
      this.svg.append(path);
      this.lines.set(key, path);
    }
    path.setAttribute("class", className);
    path.setAttribute("d", d);
    return path;
  }
  private text(
    key: string,
    className: string,
    x: number,
    y: number,
    value: string,
    anchor = "start",
  ) {
    let t = this.texts.get(key);
    if (!t) {
      t = document.createElementNS(SVG, "text");
      this.svg.append(t);
      this.texts.set(key, t);
    }
    t.setAttribute("class", className);
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", anchor);
    t.textContent = value;
  }

  /** Per frame: handle positions, gizmo arms, level lines, snap guides and the section tag. */
  private place() {
    this.camera.updateMatrixWorld();
    const p = this.props,
      used = new Set<string>(),
      usedText = new Set<string>();
    const segment = (a: THREE.Vector3, b: THREE.Vector3) => {
      const s = this.project(a),
        e = this.project(b);
      return `M${s.x.toFixed(1)},${s.y.toFixed(1)}L${e.x.toFixed(1)},${e.y.toFixed(1)}`;
    };
    // Gizmo arms share one screen length, like the builder's move handles.
    const arms = this.specs.filter((s) => s.axis);
    const anchor = arms[0] ? v3(arms[0].world) : undefined;
    const origin = anchor && this.project(anchor);
    const vectors = arms.map((s) => {
      const end = this.project(anchor!.clone().add(s.direction!));
      return new THREE.Vector2(end.x - origin!.x, end.y - origin!.y);
    });
    const scale = 76 / Math.max(1e-6, ...vectors.map((v) => v.length()));
    for (const spec of this.specs) {
      const button = this.buttons.get(spec.key);
      if (!button) continue;
      let at = this.project(v3(spec.world));
      if (spec.offset) {
        const from = at;
        at = { ...at, x: at.x + spec.offset[0], y: at.y + spec.offset[1] };
        used.add(`offset:${spec.key}`);
        this.line(
          `offset:${spec.key}`,
          "hs-offset",
          `M${from.x.toFixed(1)},${from.y.toFixed(1)}L${at.x.toFixed(1)},${at.y.toFixed(1)}`,
        );
      }
      if (spec.axis) {
        const v = vectors[arms.indexOf(spec)].clone().multiplyScalar(scale);
        const headOn = v.length() < 18;
        at = {
          x: origin!.x + v.x,
          y: origin!.y + v.y,
          visible: origin!.visible && !headOn,
        };
        if (at.visible) {
          used.add(`arm:${spec.axis}`);
          const arm = this.line(
            `arm:${spec.axis}`,
            "hs-axis-line",
            `M${origin!.x.toFixed(1)},${origin!.y.toFixed(1)}L${at.x.toFixed(1)},${at.y.toFixed(1)}`,
          );
          arm.dataset.axis = spec.axis;
          arm.dataset.locked = String(!!spec.locked);
        }
      }
      button.hidden = !at.visible;
      button.style.transform = `translate(${at.x}px,${at.y}px)`;
    }
    // Waterline and paint levels drawn across the flat views that show heights.
    if (p.view === "profile" || p.view === "section") {
      const [a, b] = this.levelSpan();
      const levels: [string, number | undefined, string][] = [
        ["waterline", p.waterline, "WL"],
        ...hullPaintBands(p.hull).map((band, i): [string, number, string] => [`paint:${band.id}`, band.upperY, `Band ${i + 1}`]),
      ];
      for (const [key, y, label] of levels) {
        if (y === undefined) continue;
        const s = v3([a[0], y, a[2]]),
          e = v3([b[0], y, b[2]]);
        used.add(`level:${key}`);
        this.line(`level:${key}`, `hs-level hs-level-${key.startsWith("paint:") ? "paint" : key}`, segment(s, e));
        const bandIndex = key.startsWith('paint:') ? hullPaintBands(p.hull).findIndex(band => `paint:${band.id}` === key) : -1;
        const start = this.project(bandIndex >= 0 ? v3(this.paintGrip(y, bandIndex)) : s);
        usedText.add(key);
        this.text(
          key,
          `hs-level-label hs-level-${key.startsWith("paint:") ? "paint" : key}`,
          start.x + (bandIndex >= 0 ? 11 : 0),
          start.y + (bandIndex >= 0 ? 4 : -6),
          bandIndex >= 0 ? String(bandIndex + 1) : label,
        );
      }
    }
    // Snap guides: mint to the aligned point, or a level across the section or hull.
    p.guides.forEach((g, n) => {
      if (g.to) {
        used.add(`guide:${n}`);
        this.line(`guide:${n}`, "hs-guide", segment(v3(g.from), v3(g.to)));
      } else if (g.level !== undefined) {
        const [a, b] = this.levelSpan();
        const across =
          p.view === "section" || p.view === "orbit"
            ? [v3([a[0], g.level, g.from[2]]), v3([b[0], g.level, g.from[2]])]
            : [v3([a[0], g.level, a[2]]), v3([b[0], g.level, b[2]])];
        used.add(`guide:${n}`);
        this.line(`guide:${n}`, "hs-guide", segment(across[0], across[1]));
      }
    });
    this.placeTag(used);
    for (const [key, path] of this.lines)
      path.style.display = used.has(key) ? "" : "none";
    for (const [key, t] of this.texts)
      t.style.display = usedText.has(key) ? "" : "none";
  }

  /** Beside the selected ring in Orbit with a leader, docked at the safe area's corner otherwise. */
  private placeTag(used: Set<string>) {
    const tag = this.props.tag.current,
      p = this.props;
    if (!tag) return;
    const width = tag.offsetWidth,
      height = tag.offsetHeight,
      W = this.host.clientWidth,
      H = this.host.clientHeight;
    let [x, y] = p.dock;
    const s = p.hull.stations.find((st) => st.id === p.primary);
    if (p.view === "orbit" && s) {
      const top = outline(p.hull, s)
        .map((q) => this.project(v3(worldPoint(p.hull, s.t, q))))
        .reduce((a, b) => (b.y < a.y ? b : a));
      if (top.visible) {
        x = Math.min(
          Math.max(top.x + 56, p.safe.left),
          W - p.safe.right - width,
        );
        y = Math.min(
          Math.max(top.y - height - 48, p.safe.top),
          H - p.safe.bottom - height,
        );
        used.add("leader");
        this.line(
          "leader",
          "hs-leader",
          `M${top.x.toFixed(1)},${top.y.toFixed(1)}L${x.toFixed(1)},${(y + height - 1).toFixed(1)}`,
        );
      }
    }
    tag.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    tag.style.visibility = "visible";
  }

  // Canvas picking: a click (not a drag) takes the nearest ring within reach, else the hull under the pointer.
  private canvasDown = (e: PointerEvent) => {
    if (e.button === 0)
      this.press = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  private canvasUp = (e: PointerEvent) => {
    const press = this.press;
    this.press = undefined;
    if (
      !press ||
      e.button !== 0 ||
      Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5
    )
      return;
    const id = this.pick(e.clientX, e.clientY);
    if (id) this.props.onSelectStation(id, e.shiftKey);
  };
  private canvasHover = (e: PointerEvent) => {
    if (e.buttons || this.drag || this.props.view === "section") return;
    const r = this.host.getBoundingClientRect(),
      id = this.nearestRing(e.clientX - r.left, e.clientY - r.top, 10);
    if (id !== this.hover) {
      this.hover = id;
      this.rebuildModel();
    }
  };
  private canvasLeave = () => {
    if (this.hover) {
      this.hover = undefined;
      this.rebuildModel();
    }
  };
  private nearestRing(x: number, y: number, reach: number) {
    const h = this.props.hull,
      cut = this.props.view === "section" ? this.cutIndex() : h.stations.length;
    let best: string | undefined,
      bestDistance = reach;
    h.stations.forEach((s, i) => {
      if (i > cut) return;
      const ring = outline(h, s).map((q) =>
        this.project(v3(worldPoint(h, s.t, q))),
      );
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k],
          b = ring[(k + 1) % ring.length],
          vx = b.x - a.x,
          vy = b.y - a.y,
          length = vx * vx + vy * vy || 1;
        const t = Math.min(
          1,
          Math.max(0, ((x - a.x) * vx + (y - a.y) * vy) / length),
        );
        const d = Math.hypot(a.x + vx * t - x, a.y + vy * t - y);
        if (d < bestDistance) {
          bestDistance = d;
          best = s.id;
        }
      }
    });
    return best;
  }
  private pick(clientX: number, clientY: number) {
    const r = this.host.getBoundingClientRect(),
      ring = this.nearestRing(clientX - r.left, clientY - r.top, 12);
    if (ring) return ring;
    const h = this.props.hull,
      hit = new THREE.Raycaster();
    hit.ray.copy(this.ray(clientX, clientY));
    const found = hit.intersectObjects(
      this.model.children.filter((o) => o instanceof THREE.Mesh),
    )[0];
    if (!found) return undefined;
    const t = found.point.z / h.length + 0.5;
    return h.stations.reduce((a, b) =>
      Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b,
    ).id;
  }
}

/** The editing viewport: the hull alone in the builder's studio with handles laid over it. */
export function CustomHullViewport(props: HullViewportProps) {
  const host = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLDivElement>(null),
    scene = useRef<HullScene | undefined>(undefined);
  useEffect(() => {
    const instance = new HullScene(host.current!, overlay.current!, props);
    scene.current = instance;
    if (import.meta.env.DEV)
      (
        window as unknown as { hullSectionsViewport?: HullScene }
      ).hullSectionsViewport = instance;
    return () => {
      instance.dispose();
      scene.current = undefined;
    };
  }, []);
  useEffect(() => {
    scene.current?.update(props);
  });
  return (
    <div className="hs-viewport">
      <div className="hs-canvas" ref={host} />
      <div
        className="hs-handles"
        ref={overlay}
        role="group"
        aria-label="Hull handles"
      />
    </div>
  );
}

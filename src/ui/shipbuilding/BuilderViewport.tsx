import { visualMemory, type VisualMemory } from './modelMemory';
import { SnapOverlay } from './SnapOverlay';
import { constructionSnapFeatures, primitiveSnapFeatures, resolveSnap, DEFAULT_SNAPPING, SHIP_AXES, type SnapFeature, type SnapGuide } from './snapping';
import { add } from '../../ships/freeformShape';
import { boundaryGeometry } from './boundaryGeometry';
import { envelopeVertices } from '../../ships/freeformShape';
import { paintedHullFace } from '../../ships/constructionHullPaint';
import { surfaceOutline } from './surfaceOutline';
import { itemOutlineGeometry } from './itemOutline';
import { internalSelectionIds } from './internalSelection';
import { createBuilderGrid } from './builderGrid';
import { FreeformHandles } from './FreeformHandles';
import { MoveHandles } from './MoveHandles';
import { blockMoveConstraint } from './blockMovement';
import { cornerVertices, worldVertex, selectionCenter, selectionCorners, rotateVertex } from '../../ships/constructionVertex';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { armorThicknessColor } from '../../ships/inspection';
import { projectConstructionSurfaces, surfaceSelectionKey } from '../../ships/constructionEditor';
import { constructionPaintColor } from '../../ships/constructionPaints';
import { normalizedBearing, snapCoordinate, gridCoordinate } from './editorNumbers';
import { attachmentOffset, dominantAxis, fillLattice, pieceExtents, physicalPlacementHit, placementCenter, strokeSegment } from './placement';
import { primitiveOutlineGeometry, primitiveGeometry, placementGeometry, placementRotation } from './primitiveGeometry';
import type { BuilderPick, BuilderPlacement, BuilderPointerEvent, BuilderScene, BuilderView } from './builderScene';
import { createConstructionHull } from '../../game/constructionModel';
import { createConstructionPathModel } from '../../game/constructionPathModel';
import { equipmentPathBounds } from '../../ships/constructionPaths';
import { appendPathPoint, pathAnchor } from './pathDrawing';
import { EquipmentPreview } from './equipmentPreview';
import { boxSelectedPieces } from './boxSelection';
import { BuilderOrientation, updateBuilderOrientation } from './BuilderOrientation';

export type { BuilderArc, BuilderDisplay, BuilderGesture, BuilderMoveTargets, BuilderPick, BuilderPointerEvent, BuilderProposal, BuilderScene, BuilderView } from './builderScene';
export interface BuilderTag { key: string; anchor: Vec3; dx: number; dy: number; tone: 'mint' | 'brass' | 'bad'; passive?: boolean; content: ReactNode }
export type ConstructionModelFactory = (source: ConstructionSource, result: ConstructionResult, signal: AbortSignal) => Promise<THREE.Group>;
/** The three.js adapter's interface: the scene to draw, HTML overlays React owns, and one door for finished gestures. */
export interface ViewportProps {
  scene: BuilderScene;
  tags: BuilderTag[]; coords(position: Vec3): string;
  /** The cursor piece readout under the palette; the coordinates readout follows it. */
  status?: ReactNode;
  /** Every pointer gesture, with its targets already raycast, snapped and filtered by the scene's targets. */
  onPointer(event: BuilderPointerEvent): void;
  onHover?(id: string | undefined): void;
  createModel?: ConstructionModelFactory;
  onMemory?(memory: VisualMemory): void;
}
/** A secondary drag rotates installed fittings, or the cursor at its held placement. */
interface RotationDrag { ids: string[]; degrees: number; travelDegrees: number; lastX: number; position?: Vec3 }
/** A primary drag that began on a piece: the pieces it carries, the plane it slides in and the snapped offset so far. */
interface MoveDrag { ids: string[]; plane: THREE.Plane; origin: THREE.Vector3; free: [boolean, boolean, boolean]; delta: Vec3; built: boolean; constrain(delta: Vec3): Vec3 }

const BRASS = '#e0c58d', BRASS_LIGHT = '#efd5a0', MINT = '#86e4c5', READY = '#94d9bf', SALMON = '#ffb5a6', IVORY = '#edf1ec';
const LEADER: Record<BuilderTag['tone'], string> = { mint: MINT, brass: BRASS, bad: SALMON };

/** Two-letter tag for a center-of-gravity or center-of-buoyancy dot, drawn over the ship like the dot itself. */
function centerTag(text: string, color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.font = '600 44px Barlow, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.lineWidth = 8; context.strokeStyle = 'rgba(10, 16, 20, .85)'; context.strokeText(text, 64, 34);
  context.fillStyle = color; context.fillText(text, 64, 34);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
  tag.name = `${text} tag`;
  return tag;
}

function release(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(child => {
    if (child.userData.sharedPreviewResources) return;
    if (child instanceof THREE.InstancedMesh) child.dispose();
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
  object.clear();
}

function fan(surface: ConstructionSurface, position: number[], colors?: number[], color?: THREE.Color) {
  for (let i = 1; i < surface.vertices.length - 1; i++) for (const vertex of [surface.vertices[0], surface.vertices[i], surface.vertices[i + 1]]) {
    position.push(...vertex); if (colors && color) colors.push(color.r, color.g, color.b);
  }
}

/** A translucent sector on the water, clockwise bearings from the bow (−Z). */
function arcMesh(arc: { bearingDeg: number; traverseDeg: number; radius: number; color: string }): THREE.Group {
  const traverse = Math.min(180, Math.max(0, arc.traverseDeg)) * Math.PI / 180, bearing = arc.bearingDeg * Math.PI / 180;
  const shape = new THREE.Shape();
  if (traverse >= Math.PI - 1e-6) shape.absarc(0, 0, arc.radius, 0, Math.PI * 2, false);
  else { shape.moveTo(0, 0); shape.absarc(0, 0, arc.radius, Math.PI / 2 - bearing - traverse, Math.PI / 2 - bearing + traverse, false); shape.closePath(); }
  const group = new THREE.Group();
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), new THREE.MeshBasicMaterial({ color: arc.color, transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide }));
  const points = shape.getPoints(48).map(point => new THREE.Vector3(point.x, point.y, 0));
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: arc.color, transparent: true, opacity: .7 }));
  group.add(fill, edge); group.rotation.x = -Math.PI / 2; group.renderOrder = 5;
  return group;
}

const same = (a: Vec3, b: Vec3) => a.every((value, index) => Math.abs(value - b[index]) < 1e-6);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const signedMetres = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Number(Math.abs(value).toFixed(2))}`;

class Viewport {
  private renderer: THREE.WebGLRenderer;
  private ortho = new THREE.OrthographicCamera(-50, 50, 35, -35, .1, 6000);
  private perspectiveCamera = new THREE.PerspectiveCamera(40, 1, .1, 5000);
  private camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = this.ortho;
  private freeformHandles: FreeformHandles;
  private moveHandles: MoveHandles;
  private snapOverlay: SnapOverlay;
  private snapFeatures: SnapFeature[] = [];
  private snapFeaturesKey = '';
  private snapGuides: SnapGuide[] = [];
  private snapLatched: string[] = [];
  private snapContext = '';
  private workingPoint?: Vec3;
  private nearCenterline = false;
  private workingAxis = 1;
  private snapBounds = new THREE.Box3();
  private moveConstraintKey = '';
  private constrainMove: (delta: Vec3) => Vec3 = delta => delta;
  private moveOffset?: Vec3;
  private moveBlocked = false;
  private vertexPreview = new THREE.Group();
  private pathPreview = new THREE.Group();
  private pathPreviewKey = '';
  private scene = new THREE.Scene();
  private floorGrid = new THREE.Group();
  private gridKey = '';
  private controls: OrbitControls;
  private hull = new THREE.Group();
  private details = new THREE.Group();
  private selection = new THREE.Group();
  private hoverGroup = new THREE.Group();
  private composed = new THREE.Group();
  private equipment: EquipmentPreview;
  private ghost = new THREE.Group();
  private ghostMirror = new THREE.Group();
  private ghostArc = new THREE.Group();
  private arcGroup = new THREE.Group();
  private proposedGroup = new THREE.Group();
  private measureGroup = new THREE.Group();
  private fillPreview: THREE.LineSegments;
  private strokePreview = new THREE.Group();
  private movePreview = new THREE.Group();
  private strokeKey = '';
  private measureLine: THREE.Line;
  private resize: ResizeObserver;
  private pickMeshes: THREE.Object3D[] = [];
  private hullMeshes: THREE.Object3D[] = [];
  private surfaceTriangles: ConstructionSurface[] = [];
  private props: ViewportProps;
  private frame = 0;
  private dead = false;
  private span = 70;
  private fitExtent = 70;
  private hullSize = new THREE.Vector3(20, 10, 50);
  private contentKey = '';
  private modelKey = '';
  private ghostKey = '';
  private arcKey = '';
  private proposedKey = '';
  private hoverSurface = '';
  private hoveredPart?: string;
  private modelAbort?: AbortController;
  private pointerStart?: { id: number; button: number; x: number; y: number; moved: boolean; box: boolean; additive: boolean; start?: BuilderPick; rotate?: RotationDrag; move?: MoveDrag; points: Vec3[]; faces?: Set<string> };
  /** The faces a Paint or Opening drag has crossed so far, drawn as brass over the hull until release commits them. */
  private facesPreview = new THREE.Group();
  private facesKey = '';
  /** The drawn faces by selection key: the hull's logical faces, for outlines and sweep previews. */
  private surfacesByKey = new Map<string, ConstructionSurface[]>();
  private geometry?: { sourceId: string; revision: string; key: string };
  private compiledGeometry?: { result: ConstructionResult; key: string };
  private carried?: { sourceId: string; revision: string; result: ConstructionResult; surfaces: ConstructionSurface[] };
  private hover?: { clientX: number; clientY: number };
  private ghostPosition?: Vec3;
  private currentView: BuilderView = 'orbit';
  private modelError: (message: string) => void;
  private orientationRotation = new THREE.Quaternion(0, 0, 0, 0);

  constructor(private host: HTMLDivElement, private overlay: HTMLDivElement, private orientation: HTMLDivElement, props: ViewportProps, modelError: (message: string) => void) {
    this.props = props; this.modelError = modelError;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#edf0f2', '#595c5f', 2.6));
    const sun = new THREE.DirectionalLight('#fff2d2', 3); sun.position.set(-80, 150, -120); this.scene.add(sun);
    this.equipment = new EquipmentPreview(() => { this.ghostKey = ''; this.update(this.props); }, modelError);
    this.ghost.name = 'Placement preview'; this.ghost.userData.placementPreview = true;
    this.fillPreview = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false, transparent: true, opacity: .9 }));
    this.fillPreview.visible = false; this.fillPreview.renderOrder = 21;
    this.measureLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: MINT, depthTest: false }));
    this.measureLine.renderOrder = 22; this.measureGroup.add(this.measureLine); this.measureGroup.visible = false;
    this.strokePreview.name = 'Pieces in current drag'; this.strokePreview.userData.strokePreview = true;
    this.movePreview.name = 'Selection being moved'; this.movePreview.userData.movePreview = true; this.movePreview.visible = false;
    this.facesPreview.name = 'Faces in current sweep';
    this.scene.add(this.floorGrid, this.hull, this.details, this.selection, this.hoverGroup, this.composed, this.equipment.group, this.arcGroup, this.proposedGroup, this.ghost, this.ghostMirror, this.ghostArc, this.fillPreview, this.strokePreview, this.movePreview, this.facesPreview, this.measureGroup);
    this.snapOverlay = new SnapOverlay(host);
    this.freeformHandles = new FreeformHandles(host, () => this.camera, replacements => this.previewVertices(replacements), {
      clear: () => this.clearSnap(),
      resolve: (raw, free, primitive, options) => {
        const corners = cornerVertices(primitive), selected = selectionCorners(options.selection);
        const moving: SnapFeature[] = selected.map(i => ({ id: `edit:${i}`, owner: primitive.id, point: worldVertex(primitive, corners[i]), kind: 'corner' }));
        moving.unshift({ id: 'edit:center', owner: primitive.id, point: add(primitive.position, rotateVertex(selectionCenter(primitive, options.selection), primitive.rotationDeg)), kind: 'center' });
        const directions = SHIP_AXES.filter((_, k) => free[k]).map(v => rotateVertex(v, primitive.rotationDeg));
        const grid = raw.map(v => snapCoordinate(v, options.unit)) as Vec3;
        const delta = this.resolveSnapping(`freeform:${primitive.id}`, rotateVertex(raw, primitive.rotationDeg), rotateVertex(grid, primitive.rotationDeg), directions, moving, new Set([primitive.id]));
        return rotateVertex(delta, -primitive.rotationDeg);
      },
    });
    this.moveHandles = new MoveHandles(host, () => this.camera);
    this.scene.add(this.vertexPreview, this.pathPreview);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .15;
    this.controls.minZoom = .08; this.controls.maxZoom = 100; this.controls.maxPolarAngle = Math.PI * .95;
    this.camera.position.set(65, 45, -75); this.controls.update();
    this.resize = new ResizeObserver(() => this.measure()); this.resize.observe(host); this.measure();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.down, true); canvas.addEventListener('pointermove', this.move); canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('contextmenu', this.contextMenu);
    canvas.addEventListener('dblclick', this.finishPath); canvas.addEventListener('pointercancel', this.cancel); canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('lostpointercapture', this.cancel); window.addEventListener('keydown', this.key);
    window.addEventListener('blur', this.cancel);
    if (import.meta.env.DEV) (window as unknown as { shipbuilderViewport?: Viewport }).shipbuilderViewport = this;
    this.update(props); this.fit(); this.animate();
  }

  private measure() {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.span = this.fitExtent / Math.min(1, width / height);
    this.renderer.setSize(width, height); this.ortho.left = -this.span * width / height / 2; this.ortho.right = -this.ortho.left;
    this.ortho.top = this.span / 2; this.ortho.bottom = -this.ortho.top; this.ortho.updateProjectionMatrix();
    this.perspectiveCamera.aspect = width / height; this.perspectiveCamera.updateProjectionMatrix();
  }

  fit() {
    const bounds = new THREE.Box3();
    // Source bounds remain available before compilation and for invalid drafts.
    for (const primitive of this.props.scene.source.construction.primitives) {
      for (const v of envelopeVertices(primitive)) bounds.expandByPoint(new THREE.Vector3(...worldVertex(primitive, v)));
    }
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-10, -5, -25), new THREE.Vector3(10, 5, 25));
    this.hullSize.copy(bounds.getSize(new THREE.Vector3()));
    // Keep the bow datum in frame in the views where the floor is readable.
    if (this.props.scene.view === 'orbit' || this.props.scene.view === 'top') bounds.union(this.floorGrid.children[0]?.userData.frame ?? new THREE.Box3());
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const view = this.props.scene.view, aspect = Math.max(1, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    // Frame the ship for the chosen view: plan and profile need the length upright, the bow view only the section.
    const framed = view === 'top' ? Math.max(size.z, size.x * aspect) : view === 'side' ? Math.max(size.z, size.y * aspect) : view === 'bow' ? Math.max(size.x, size.y * aspect) : size.length() * .95;
    this.fitExtent = Math.max(15, framed * 1.12);
    this.controls.target.copy(center); this.camera.zoom = 1;
    this.measure(); this.setView(view); this.ghostKey = '';
  }

  private setView(view: BuilderView) {
    const direction = view === 'top' ? [0, 1, .0001] : view === 'side' ? [1, 0, 0] : view === 'bow' ? [0, 0, -1] : [1, .7, -1.15];
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(this.camera instanceof THREE.PerspectiveCamera ? this.span / (2 * Math.tan(20 * Math.PI / 180)) : Math.max(200, this.span * 3)));
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.controls.target); this.controls.enableRotate = view === 'orbit'; this.controls.update(); this.currentView = view;
  }

  /** The source's hull geometry as one string, once per revision: whether a pending compile changes anything but face assignments. */
  private geometryKey(source: ConstructionSource) {
    if (!this.geometry || this.geometry.sourceId !== source.id || this.geometry.revision !== source.revision) this.geometry = { sourceId: source.id, revision: source.revision, key: JSON.stringify(source.construction.primitives) };
    return this.geometry.key;
  }
  /** While a compile is pending after an armor, paint or opening edit, the last compile's faces stay up with the
   * source's new assignments over them, so the ship never drops to a gray draft. A geometry edit still shows the draft. */
  private carriedSurfaces(scene: BuilderScene): ConstructionSurface[] | undefined {
    const { source, current, result } = scene;
    if (current?.surfaces.length) { this.compiledGeometry = { result: current, key: this.geometryKey(source) }; return undefined; }
    if (current || !result || this.compiledGeometry?.result !== result || this.compiledGeometry.key !== this.geometryKey(source)) return undefined;
    if (!this.carried || this.carried.sourceId !== source.id || this.carried.revision !== source.revision || this.carried.result !== result) this.carried = { sourceId: source.id, revision: source.revision, result, surfaces: projectConstructionSurfaces(source, result.surfaces) };
    return this.carried.surfaces;
  }

  update(props: ViewportProps) {
    const old = this.props; this.props = props;
    const snapFeaturesKey = `${props.scene.source.id}:${props.scene.source.revision}:${props.scene.catalog.revision}`;
    if (snapFeaturesKey !== this.snapFeaturesKey) {
      this.snapFeaturesKey = snapFeaturesKey; this.snapFeatures = constructionSnapFeatures(props.scene.source, props.scene.catalog); this.clearSnap();
    }
    this.freeformHandles.update(props.scene.source, props.scene.freeform);
    this.updateMoveHandles();
    if (JSON.stringify(old.scene.snapping) !== JSON.stringify(props.scene.snapping)) {
      this.snapLatched = []; this.moveHandles.refresh(); this.freeformHandles.refresh();
      if (this.pointerStart?.move && this.hover) this.updateMove(this.hover);
    }
    if (!!props.scene.perspective !== (this.camera instanceof THREE.PerspectiveCamera)) {
      const previous=this.camera, distance=previous.position.distanceTo(this.controls.target);
      this.camera=props.scene.perspective?this.perspectiveCamera:this.ortho;
      const extent=previous instanceof THREE.PerspectiveCamera?2*distance*Math.tan(20*Math.PI/180)/previous.zoom:this.span/previous.zoom;
      this.camera.position.copy(previous.position); this.camera.quaternion.copy(previous.quaternion);
      if(this.camera instanceof THREE.PerspectiveCamera) {
        this.camera.zoom=1;this.camera.position.sub(this.controls.target).setLength(extent/(2*Math.tan(20*Math.PI/180))).add(this.controls.target);
      } else this.camera.zoom=this.span/extent;
      this.controls.object=this.camera;this.camera.updateProjectionMatrix();this.controls.update();
    }
    if (props.scene.source.id !== old.scene.source.id || props.scene.source.revision !== old.scene.source.revision || props.scene.gesture !== old.scene.gesture || props.scene.placementPiece !== old.scene.placementPiece || props.scene.moveTargets !== old.scene.moveTargets || props.scene.view !== old.scene.view || props.scene.perspective !== old.scene.perspective || props.scene.selected !== old.scene.selected) {
      // A changed cursor bearing must not forget a stationary pointer and hide the ghost.
      const hover = this.hover;
      this.cancel();
      if (props.scene.source.id === old.scene.source.id) this.hover = hover;
    }
    // The primary button orbits (pans in construction views) and the secondary button pans. A primary press on the hull while placing lays pieces instead; `down` holds the controls for that drag.
    this.controls.mouseButtons = { LEFT: props.scene.perspective || props.scene.view === 'orbit' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.enableRotate = props.scene.view === 'orbit' || !!props.scene.perspective;
    const gridKey = `${props.scene.source.id}:${props.scene.source.revision}:${props.scene.gridStep}`;
    if (gridKey !== this.gridKey) {
      this.gridKey = gridKey; release(this.floorGrid);
      const bounds = new THREE.Box3();
      for (const primitive of props.scene.source.construction.primitives) {
        for (const corner of envelopeVertices(primitive)) bounds.expandByPoint(new THREE.Vector3(...worldVertex(primitive, corner)));
      }
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
      this.snapBounds.copy(bounds);
      this.floorGrid.add(createBuilderGrid(bounds, props.scene.gridStep));
    }
    if (props.scene.view !== this.currentView || props.scene.fitRequest !== old.scene.fitRequest || props.scene.source.id !== old.scene.source.id || (!old.scene.result && props.scene.result)) this.fit();
    // `current` is the compile of exactly this revision; `result` is the last accepted one, kept for rooms and centers.
    const invalid = new Set((props.scene.current?.diagnostics ?? []).filter(d => d.severity === 'error' && d.sourceId).map(d => d.sourceId!));
    const carried = this.carriedSurfaces(props.scene), compiled = props.scene.current?.surfaces.length ? props.scene.current : carried ? props.scene.result : undefined;
    const nativeSurfaces = props.scene.current?.surfaces.length ? props.scene.current.surfaces : carried;
    const armorScale = props.scene.display === 'armor' ? `${props.scene.armorScale.fromMm}-${props.scene.armorScale.toMm}` : '';
    const key = `${props.scene.source.id}:${props.scene.current?.surfaces.length ? props.scene.current.contentHash : `${props.scene.source.revision}:${carried ? 'carried' : 'draft'}`}:${props.scene.display}:${armorScale}:${[...invalid].sort().join(',')}`;
    if (key !== this.contentKey) {
      this.contentKey = key; release(this.hull); this.surfaceTriangles = []; this.pickMeshes = []; this.hullMeshes = []; this.surfacesByKey = new Map();
      const vertices: number[] = [], colors: number[] = [];
      const armorGroups: { start: number; count: number; materialIndex: number }[] = [];
      for (const surface of nativeSurfaces ?? []) {
        if (surface.open && props.scene.display === 'paint') continue;
        const color = new THREE.Color(invalid.has(surface.primitiveId) ? SALMON : props.scene.display === 'armor' ? armorThicknessColor(surface.thicknessMm, props.scene.armorScale) : constructionPaintColor(surface.paint));
        const primitive = props.scene.source.construction.primitives.find(p => p.id === surface.primitiveId);
        const painted = props.scene.display === 'armor' ? [{ vertices: surface.vertices, paint: surface.paint }] : paintedHullFace(surface, primitive);
        for (const face of painted) {
          fan({ ...surface, vertices: face.vertices }, vertices, colors, props.scene.display === 'armor' || invalid.has(surface.primitiveId) ? color : new THREE.Color(constructionPaintColor(face.paint)));
          for (let i = 1; i < face.vertices.length - 1; i++) this.surfaceTriangles.push(surface);
        }
        if (props.scene.display === 'armor') {
          const count = Math.max(0, surface.vertices.length - 2) * 3;
          const materialIndex = surface.material === 'armor-steel' && !surface.open ? 0 : 1;
          const previous = armorGroups.at(-1);
          if (previous?.materialIndex === materialIndex) previous.count += count;
          else armorGroups.push({ start: vertices.length / 3 - count, count, materialIndex });
        }
        const selectionKey = surfaceSelectionKey(surface), group = this.surfacesByKey.get(selectionKey);
        if (group) group.push(surface); else this.surfacesByKey.set(selectionKey, [surface]);
      }
      if (nativeSurfaces) {
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
        if (props.scene.display === 'armor') for (const group of armorGroups) geometry.addGroup(group.start, group.count, group.materialIndex);
        const mesh = new THREE.Mesh(geometry, props.scene.display === 'armor' ? [new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: .12, depthWrite: false })] : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: 0, side: THREE.DoubleSide, transparent: props.scene.display === 'internals', opacity: props.scene.display === 'internals' ? .15 : 1, depthWrite: props.scene.display !== 'internals' }));
        mesh.userData.hull = true; this.hull.add(mesh); this.pickMeshes.push(mesh); this.hullMeshes.push(mesh);
        // The Armor layer outlines every logical face of every piece, in one batch, so plates read as plates on the flat colour scale.
        if (props.scene.display === 'armor') {
          const points: THREE.Vector3[] = [];
          for (const group of this.surfacesByKey.values()) for (const edge of surfaceOutline(group)) {
            if (edge.surface.material !== 'armor-steel' || edge.surface.open) continue;
            const normal = new THREE.Vector3(...edge.surface.normal);
            points.push(new THREE.Vector3(...edge.a).addScaledVector(normal, .025), new THREE.Vector3(...edge.b).addScaledVector(normal, .025));
          }
          if (points.length) this.hull.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#142a31', transparent: true, opacity: .4 })));
        }
      } else for (const primitive of props.scene.source.construction.primitives) {
        const mesh = new THREE.Mesh(primitiveGeometry(primitive.kind, primitive.size, primitive.vertices, primitive.customHull, primitive.shaping), new THREE.MeshStandardMaterial({ color: invalid.has(primitive.id) ? SALMON : constructionPaintColor('naval-gray'), roughness: .78, side: THREE.DoubleSide, transparent: props.scene.display !== 'paint', opacity: props.scene.display !== 'paint' ? .12 : 1, depthWrite: props.scene.display === 'paint' }));
        mesh.position.set(...primitive.position); mesh.rotation.y = primitive.rotationDeg * Math.PI / 180;
        mesh.userData.sourceId = primitive.id; this.hull.add(mesh); this.pickMeshes.push(mesh); this.hullMeshes.push(mesh);
      }
      this.hoverSurface = ''; release(this.hoverGroup);
    }
    this.equipment.update(props.scene.source, props.scene.catalog, compiled?.propellerSupports, invalid);
    this.equipment.setDisplay(props.scene.display, props.scene.source, props.scene.catalog);
    const modelKey = `${props.scene.source.id}:${props.scene.source.revision}:${props.scene.result?.contentHash}`;
    if (modelKey !== this.modelKey) {
      this.modelKey = modelKey; this.modelAbort?.abort(); release(this.composed);
      if (props.scene.current && nativeSurfaces) {
        const abort = new AbortController(); this.modelAbort = abort;
        const model = props.createModel ? props.createModel(props.scene.source, props.scene.current, abort.signal) : Promise.resolve(createConstructionHull(nativeSurfaces, props.scene.source.construction.primitives));
        model.then(group => {
          if (this.dead || abort.signal.aborted || modelKey !== this.modelKey) { release(group); return; }
          this.composed.add(group); this.update(this.props); this.modelError('');
        }).catch(error => { if (!abort.signal.aborted && !this.dead) this.modelError(`Equipment preview: ${error instanceof Error ? error.message : String(error)}`); });
      }
    }
    this.composed.visible = props.scene.display === 'paint' && !!nativeSurfaces && !invalid.size;
    this.equipment.group.visible = !(props.createModel && this.composed.visible && this.composed.children.length);
    // Native surfaces remain the pick target even when shared composition renders the exterior.
    this.hull.visible = !this.composed.visible || !this.composed.children.length;
    release(this.details); release(this.selection); this.selection.visible=true;
    this.pickMeshes = this.pickMeshes.filter(mesh => mesh.parent === this.hull);
    this.equipment.group.traverse(node => { if (node instanceof THREE.Mesh) this.pickMeshes.push(node); });
    if (!nativeSurfaces) for (const object of this.hull.children) {
      const mesh = object as THREE.Mesh;
      if (!props.scene.selected.has(mesh.userData.sourceId)) continue;
      const primitive = props.scene.source.construction.primitives.find(p => p.id === mesh.userData.sourceId);
      const edges = new THREE.LineSegments(primitive ? primitiveOutlineGeometry(primitive) : new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }));
      edges.position.copy(mesh.position); edges.rotation.copy(mesh.rotation); this.selection.add(edges);
    }
    for (const part of props.scene.source.construction.equipment) {
      const entry = props.scene.catalog.equipment.find(entry => entry.id === part.partId);
      if (!entry || this.equipment.has(part.id)) continue;
      const pathBounds = equipmentPathBounds(entry, part);
      const box = new THREE.Mesh(new THREE.BoxGeometry(...pathBounds.size), new THREE.MeshBasicMaterial({ visible: false }));
      const datum = new THREE.Group(); datum.position.set(...part.position); datum.rotation.y = -part.bearingDeg * Math.PI / 180; box.position.set(...pathBounds.center);
      box.userData.sourceId = part.id; datum.add(box); this.details.add(datum);
      this.pickMeshes.push(box); // Invisible pick proxy while the model loads.
    }
    if (props.scene.display === 'internals' && props.scene.source.construction.version === 2) {
      for (const module of props.scene.result?.definition?.modules ?? []) {
        if (module.kind !== 'magazine') continue;
        const owner = props.scene.source.construction.equipment.find(e => module.id === `${e.id}-magazine`);
        if (!owner) continue;
        const box = new THREE.Mesh(new THREE.BoxGeometry(...module.size), new THREE.MeshBasicMaterial({ color: props.scene.selected.has(owner.id) ? BRASS : SALMON, transparent: true, opacity: .55, depthWrite: false }));
        box.position.set(...module.center);
        if (module.torpedoLauncherId) {
          const local = box.position.clone().sub(new THREE.Vector3(...owner.position));
          local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -owner.bearingDeg * Math.PI / 180);
          box.position.copy(local.add(new THREE.Vector3(...owner.position)));
          box.rotation.y = -owner.bearingDeg * Math.PI / 180;
        }
        box.userData.sourceId = owner.id; this.details.add(box); this.pickMeshes.push(box);
      }
    }
    for (const wall of props.scene.source.construction.boundaries) {
      const geometry = boundaryGeometry(props.scene.source.construction.primitives, wall.axis, wall.offset);
      const plane = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: invalid.has(wall.id) ? SALMON : BRASS, transparent: true, opacity: invalid.has(wall.id) ? .5 : props.scene.selected.has(wall.id) ? .3 : .09, depthWrite: false, side: THREE.DoubleSide }));
      plane.userData.sourceId = wall.id; plane.visible = invalid.has(wall.id) || props.scene.display === 'internals' || props.scene.selected.has(wall.id); this.details.add(plane); if (plane.visible) this.pickMeshes.push(plane);
    }
    const outlinedHulls = new Set<string>();
    if (nativeSurfaces) for (const primitive of props.scene.source.construction.primitives) {
      if (primitive.kind !== 'custom-hull' || !props.scene.selected.has(primitive.id)) continue;
      outlinedHulls.add(primitive.id);
      const edges = new THREE.LineSegments(primitiveOutlineGeometry(primitive), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }));
      edges.position.set(...primitive.position); edges.rotation.y = primitive.rotationDeg * Math.PI / 180;
      this.selection.add(edges);
    }
    for (const group of this.surfacesByKey.values()) {
      const surface = group[0], chosen = props.scene.selectedSurfaces.has(surfaceSelectionKey(surface));
      const selected = chosen || (props.scene.selected.has(surface.primitiveId) && !outlinedHulls.has(surface.primitiveId));
      if (!selected) continue;
      const outline: THREE.Vector3[] = [], thickness: THREE.Vector3[] = [];
      for (const edge of surfaceOutline(group)) {
        const normal = new THREE.Vector3(...edge.surface.normal), a = new THREE.Vector3(...edge.a), b = new THREE.Vector3(...edge.b);
        outline.push(a.clone().addScaledVector(normal, .025), b.clone().addScaledVector(normal, .025));
        if (chosen && props.scene.display === 'armor' && !edge.surface.open) {
          const innerA = a.clone().addScaledVector(normal, -edge.surface.thicknessMm / 1000), innerB = b.clone().addScaledVector(normal, -edge.surface.thicknessMm / 1000);
          thickness.push(a, innerA, innerA, innerB);
        }
      }
      this.selection.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false })));
      if (thickness.length) this.selection.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(thickness), new THREE.LineBasicMaterial({ color: READY, depthTest: false })));
    }
    const loading = props.scene.result?.loading;
    // Gravity is tagged above its dot and buoyancy below, so the tags stay apart when the centers nearly coincide.
    if (props.scene.showCenters && loading) for (const [point, color, text, side] of [[loading.centerOfGravity, BRASS, 'CG', 1], [loading.buoyancyCenter, READY, 'CB', -1]] as const) {
      const radius = Math.max(.1, this.span / 360);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      marker.position.set(...point); marker.renderOrder = 10; this.details.add(marker);
      const tag = centerTag(text, color), height = radius * 5;
      tag.position.set(point[0], point[1] + side * (radius + height * .55), point[2]); tag.scale.set(height * 2, height, 1); tag.renderOrder = 10; this.details.add(tag);
    }
    const arcKey = JSON.stringify(props.scene.arcs);
    if (arcKey !== this.arcKey) {
      this.arcKey = arcKey; release(this.arcGroup);
      for (const arc of props.scene.arcs) { const mesh = arcMesh(arc); mesh.position.set(arc.position[0], arc.position[1] + .08, arc.position[2]); this.arcGroup.add(mesh); }
    }
    const proposedKey = JSON.stringify(props.scene.proposed);
    if (proposedKey !== this.proposedKey) {
      this.proposedKey = proposedKey; release(this.proposedGroup);
      for (const item of props.scene.proposed) {
        const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...item.size)), new THREE.LineDashedMaterial({ color: MINT, dashSize: .6, gapSize: .3, depthTest: false }));
        box.computeLineDistances(); box.position.set(...item.boundsCenter);
        const datum = new THREE.Group(); datum.position.set(...item.position); datum.rotation.y = -item.bearingDeg * Math.PI / 180; datum.add(box); this.proposedGroup.add(datum);
      }
    }
    // Models can finish loading, move or repaint beneath a stationary pointer.
    release(this.hoverGroup); this.hoverSurface = '';
    this.measureGroup.visible = !!props.scene.measure;
    // A held corner is already dragging, but has no preview until it moves.
    if(this.vertexPreview.visible && this.vertexPreview.children.length) {this.hull.visible=false;this.composed.visible=false;this.selection.visible=false;}
    if (this.pointerStart?.rotate) this.previewRotation(this.pointerStart.rotate, this.pointerStart.rotate.degrees);
    this.updatePathPreview(); this.updateGhost(); this.updateStrokePreview(); this.updateFacesPreview(); if (this.hover) this.highlight(this.hover);
  }

  private previewVertices(replacements?: ConstructionPrimitive[]) {
    release(this.vertexPreview);
    this.vertexPreview.visible=!!replacements;
    if (!replacements) { this.update(this.props); return; }
    this.hull.visible=false; this.composed.visible=false; this.selection.visible=false;
    const map=new Map(replacements.map(p=>[p.id,p]));
    for(const original of this.props.scene.source.construction.primitives) {
      const p=map.get(original.id)??original;
      const geometry=primitiveGeometry(p.kind,p.size,p.vertices,p.customHull,p.shaping);
      const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:constructionPaintColor('naval-gray'),roughness:.78,side:THREE.DoubleSide}));
      mesh.position.set(...p.position);mesh.rotation.y=p.rotationDeg*Math.PI/180;this.vertexPreview.add(mesh);
      if(map.has(p.id)) {const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:BRASS_LIGHT}));edges.position.copy(mesh.position);edges.rotation.copy(mesh.rotation);this.vertexPreview.add(edges);}
    }
  }

  private updateGhost() {
    const rotation = this.pointerStart?.rotate;
    const original = this.props.scene.placementPiece;
    const piece = rotation?.position && original?.kind === 'equipment' ? { ...original, bearingDeg: normalizedBearing(original.bearingDeg + rotation.degrees) } : original;
    const originalMirror = this.props.scene.placementMirror;
    const mirror = rotation?.position && originalMirror?.kind === 'equipment' ? { ...originalMirror, bearingDeg: normalizedBearing(originalMirror.bearingDeg - rotation.degrees) } : originalMirror;
    // Bearing changes transform the cached preview; they do not rebuild its meshes.
    const shape = (item?: BuilderPlacement) => item?.kind === 'equipment' ? { ...item, bearingDeg: 0 } : item;
    const pick = rotation?.position ? { placement: rotation.position } : this.hover ? this.pick(this.hover, 'hull') : undefined;
    const offset = piece?.kind === 'boundary' && pick ? pick.placement[{ x: 0, y: 1, z: 2 }[piece.axis]] : undefined;
    const key = JSON.stringify([shape(piece), shape(mirror), piece?.kind === 'boundary' ? [this.props.scene.source.revision, offset] : undefined]);
    if (key !== this.ghostKey) {
      this.strokeKey = ''; this.strokePreview.clear();
      this.ghostKey = key; release(this.ghost); release(this.ghostMirror); release(this.ghostArc);
      if (piece) {
        const build = (item: BuilderPlacement, group: THREE.Group, opacity: number) => {
          const equipment = item.kind === 'equipment' && item.partId ? this.equipment.clone(item.partId, true) : undefined;
          if (equipment) { group.add(equipment); group.rotation.y = placementRotation(item); return; }
          const geometry = item.kind === 'boundary' ? boundaryGeometry(this.props.scene.source.construction.primitives, item.axis, offset ?? NaN) : placementGeometry(item);
          const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity, depthWrite: false, depthTest: item.kind === 'boundary', side: THREE.DoubleSide }));
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false, transparent: true, opacity: opacity * 3.6 }));
          fill.renderOrder = 20; edges.renderOrder = 21; group.add(fill, edges); group.rotation.y = placementRotation(item);
        };
        build(piece, this.ghost, piece.kind === 'boundary' ? .12 : .25);
        if (mirror) build(mirror, this.ghostMirror, .12);
        if (piece.kind === 'equipment' && piece.arc) this.ghostArc.add(arcMesh({ bearingDeg: 0, traverseDeg: piece.arc.traverseDeg, radius: piece.arc.radius, color: BRASS }));
      }
    }
    if (piece) this.ghost.rotation.y = placementRotation(piece);
    if (mirror) this.ghostMirror.rotation.y = placementRotation(mirror);
    this.ghostArc.rotation.y = piece?.kind === 'equipment' ? -piece.bearingDeg * Math.PI / 180 : 0;
    const visible = !!piece && !!pick && (!!rotation?.position || !this.navigating());
    this.ghost.visible = visible;
    if (!visible) { this.ghostMirror.visible = false; this.ghostArc.visible = false; this.ghostPosition = undefined; if (piece && !this.pointerStart?.move && !this.moveHandles.dragging) this.clearSnap(); return; }
    const position = [...pick!.placement] as Vec3;
    this.ghostPosition = pick!.placement;
    // Boundary geometry is already in ship coordinates, independent of orbit target.
    this.ghost.position.set(...(piece!.kind === 'boundary' ? [0, 0, 0] as Vec3 : position));
    this.ghostMirror.visible = !!this.props.scene.placementMirror && Math.abs(position[0]) > 1e-6;
    if (this.ghostMirror.visible) this.ghostMirror.position.set(-position[0], position[1], position[2]);
    this.ghostArc.visible = this.ghostArc.children.length > 0;
    if (this.ghostArc.visible) this.ghostArc.position.set(position[0], position[1] + .08, position[2]);
  }

  private clearSnap() { this.snapGuides = []; this.snapLatched = []; this.snapContext = ''; this.workingPoint = undefined; this.nearCenterline = false; }
  private projectSnap = (point: Vec3): [number, number] | undefined => {
    const p = new THREE.Vector3(...point).project(this.camera);
    return p.z >= -1 && p.z <= 1 ? [(p.x + 1) * this.host.clientWidth / 2, (1 - p.y) * this.host.clientHeight / 2] : undefined;
  };
  private resolveSnapping(context: string, raw: Vec3, grid: Vec3, directions: Vec3[], moving: SnapFeature[], excluded: Set<string>): Vec3 {
    if (context !== this.snapContext) { this.snapContext = context; this.snapLatched = []; }
    const result = resolveSnap({ raw, grid, directions, moving, targets: this.snapFeatures.filter(f => !excluded.has(f.owner)),
      settings: this.props.scene.snapping ?? DEFAULT_SNAPPING, project: this.projectSnap, previous: this.snapLatched });
    this.snapGuides = result.guides; this.snapLatched = result.latched;
    this.nearCenterline = moving.some(feature => {
      if (feature.kind !== 'center') return false;
      const point = add(feature.point, raw), a = this.projectSnap(point), b = this.projectSnap([0, point[1], point[2]]);
      return !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 14;
    });
    this.workingPoint = add(moving[0]?.point ?? [0, 0, 0], result.delta);
    return result.delta;
  }
  private snapMove(ids: string[], raw: Vec3, free: boolean[]): Vec3 {
    const selected = new Set(ids), all = this.snapFeatures.filter(f => selected.has(f.owner));
    const centers = all.filter(f => f.kind === 'center');
    // A group centers as a group while retaining its relative arrangement.
    const moving = all.filter(f => f.kind === 'corner');
    if (centers.length) {
      const center = [0, 1, 2].map(k => (Math.min(...centers.map(f => f.point[k])) + Math.max(...centers.map(f => f.point[k]))) / 2) as Vec3;
      moving.unshift({ id: 'selection:center', owner: 'selection', kind: 'center', point: center });
    }
    this.workingAxis = free.indexOf(false);
    return this.resolveSnapping(`move:${ids.join(',')}`, raw, raw.map(v => snapCoordinate(v, this.props.scene.gridStep)) as Vec3, SHIP_AXES.filter((_, k) => free[k]), moving, selected);
  }
  private drawSnapGuides() {
    const settings = this.props.scene.snapping ?? DEFAULT_SNAPPING;
    const dragging = this.moveHandles.moving || this.freeformHandles.moving || !!(this.pointerStart?.moved && (this.pointerStart.move || this.pointerStart.start && this.props.scene.placementPiece));
    const showCenterline = settings.showCenterline && dragging && this.nearCenterline;
    let centerline: [Vec3, Vec3] | undefined;
    if (showCenterline && this.workingPoint) {
      const point = this.workingPoint;
      const padding = Math.max(2, this.hullSize.z * .05);
      centerline = this.workingAxis === 2 || this.props.scene.view === 'bow'
        ? [[0, this.snapBounds.min.y - padding, point[2]], [0, this.snapBounds.max.y + padding, point[2]]]
        : [[0, point[1], this.snapBounds.min.z - padding], [0, point[1], this.snapBounds.max.z + padding]];
    }
    this.snapOverlay.frame(this.projectSnap, settings.guides ? this.snapGuides.filter(g => !g.centerline || showCenterline) : [], centerline);
  }

  /** Empty space is never a placement or selection surface. */
  private pick(event: { clientX: number; clientY: number; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }, targets: BuilderScene['pickTargets']): BuilderPick | undefined {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    // Hull raycasts still support placement, but every object interaction in Internals
    // passes through the skin and external fittings to the internal packages/walls.
    const allowed = targets !== 'hull' && this.props.scene.pickTargets === 'internals' ? internalSelectionIds(this.props.scene.source, this.props.scene.catalog) : undefined;
    const hit = ray.intersectObjects(targets === 'hull' ? this.hullMeshes : this.pickMeshes, false).find(hit =>
      !allowed || allowed.has(hit.object.userData.sourceId));
    if (!hit) return undefined;
    const surface = hit.object.userData.hull ? this.surfaceTriangles[hit.faceIndex ?? -1] : undefined;
    const facing = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : ray.ray.direction.clone().negate();
    if (facing.dot(ray.ray.direction) > 0) facing.negate();
    const { point: raw, normal } = physicalPlacementHit({ point: hit.point.toArray() as Vec3, normal: facing.toArray() as Vec3 }, surface);
    const axis = dominantAxis(normal);
    const supportId = surface?.primitiveId.startsWith('equipment:') ? surface.primitiveId.slice('equipment:'.length) : undefined;
    const id = supportId && this.props.scene.source.construction.equipment.some(item => item.id === supportId) ? supportId : surface?.primitiveId ?? hit.object.userData.sourceId;
    const primitive = this.props.scene.source.construction.primitives.find(part => part.id === id), piece = this.props.scene.placementPiece;
    const extents = primitive && pieceExtents({ kind: 'hull', shape: primitive.kind, size: primitive.size, rotationDeg: primitive.rotationDeg });
    const snapOrigin = primitive && extents ? primitive.position.map((value, index) => value - extents[index] / 2) as Vec3 : undefined;
    const settings = this.props.scene.snapping ?? DEFAULT_SNAPPING;
    const step = settings.enabled && settings.grid ? this.props.scene.gridStep : null;
    let placement = piece ? placementCenter(piece, { point: raw, normal, snapOrigin }, step) : raw.map(value => gridCoordinate(value, step)) as Vec3;
    if (piece && !this.pointerStart?.move && !this.moveHandles.dragging) {
      const unsnapped = placementCenter(piece, { point: raw, normal, snapOrigin }, null);
      const moving = piece.kind === 'hull' ? primitiveSnapFeatures({ id: 'cursor', kind: piece.shape, position: [0, 0, 0], rotationDeg: piece.rotationDeg, size: piece.size })
        : [{ id: 'cursor:center', owner: 'cursor', point: piece.kind === 'equipment' ? attachmentOffset(piece, piece.bearingDeg) : [0, 0, 0] as Vec3, kind: 'center' as const }];
      const free = SHIP_AXES.filter((_, k) => piece.kind === 'boundary' ? k === 'xyz'.indexOf(piece.axis) : k !== axis);
      this.workingAxis = axis;
      placement = this.resolveSnapping(`placement:${piece.kind}:${id}`, unsnapped, placement, free, moving, new Set());
      // Smart alignment must preserve the exact support plane, including slopes.
      if (piece.kind !== 'boundary') placement[axis] -= placement.reduce((sum, v, k) => sum + (v - unsnapped[k]) * normal[k], 0) / normal[axis];
      this.workingPoint = piece.kind === 'equipment' ? add(placement, attachmentOffset(piece, piece.bearingDeg)) : [...raw];
    }
    return { id, surface: surface && surfaceSelectionKey(surface), point: raw, normal, axis, placement, additive: !!(event.shiftKey || event.ctrlKey || event.metaKey) };
  }

  private showArmorTooltip(event?: { clientX: number; clientY: number }, pick?: BuilderPick) {
    const tooltip = this.overlay.querySelector<HTMLElement>('[data-armor-tooltip]')!;
    const surface = this.props.scene.display === 'armor' && pick?.surface ? this.surfacesByKey.get(pick.surface)?.[0] : undefined;
    tooltip.hidden = !surface || !event;
    if (!surface || !event) return;
    tooltip.querySelector('b')!.textContent = surface.open ? 'Open to sea' : `Nominal armor: ${surface.thicknessMm.toLocaleString()} mm`;
    tooltip.querySelector('span')!.textContent = surface.open ? 'No protective plate' : surface.material === 'armor-steel' ? 'Armor steel' : 'Structural steel';
    const bounds = this.overlay.getBoundingClientRect();
    let x = event.clientX - bounds.left + 16, y = event.clientY - bounds.top + 18;
    if (x + tooltip.offsetWidth > bounds.width - 8) x = event.clientX - bounds.left - tooltip.offsetWidth - 16;
    if (y + tooltip.offsetHeight > bounds.height - 8) y = event.clientY - bounds.top - tooltip.offsetHeight - 18;
    tooltip.style.left = `${Math.max(8, x)}px`; tooltip.style.top = `${Math.max(8, y)}px`;
  }

  private reportHover(id?: string) {
    if (id === this.hoveredPart) return;
    this.hoveredPart = id; this.props.onHover?.(id);
  }

  private highlight(event: { clientX: number; clientY: number }) {
    // During placement, the ghost/path already identifies the action. Keep its support block clear.
    const placing = !!this.props.scene.placementPiece || !!this.props.scene.pathDraft;
    const hit = this.navigating() ? undefined : this.pick(event, this.props.scene.pickTargets);
    this.reportHover(hit?.id);
    this.showArmorTooltip(event, hit);
    const supportBlock = this.props.scene.source.construction.primitives.some(part => part.id === hit?.id);
    const pick = placing && supportBlock ? undefined : hit;
    const primitive = this.props.scene.source.construction.primitives.find(part => part.id === pick?.id);
    const face = this.props.scene.highlightFaces && !!primitive;
    const key = face ? pick?.surface ?? '' : pick?.id ?? '';
    if (key === this.hoverSurface) return;
    this.hoverSurface = key; release(this.hoverGroup);
    if (!key) return;
    const material = () => new THREE.LineBasicMaterial({ color: IVORY, depthTest: false, transparent: true, opacity: .95 });
    if (!primitive) {
      const edges = new THREE.LineSegments(itemOutlineGeometry(this.pickMeshes, key), material());
      edges.renderOrder = 25; this.hoverGroup.add(edges);
      return;
    }
    if (!face) {
      const edges = new THREE.LineSegments(primitiveOutlineGeometry(primitive), material());
      edges.position.set(...primitive.position); edges.rotation.y = primitive.rotationDeg * Math.PI / 180;
      edges.renderOrder = 25; this.hoverGroup.add(edges);
      return;
    }
    const groups = this.props.scene.highlightFaces ? [this.surfacesByKey.get(key) ?? []] : [...this.surfacesByKey.values()].filter(group => group[0].primitiveId === key);
    for (const group of groups) {
      const points = surfaceOutline(group).flatMap(edge => [edge.a, edge.b].map(point => new THREE.Vector3(...point).addScaledVector(new THREE.Vector3(...edge.surface.normal), .03)));
      const outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material());
      outline.renderOrder = 25; this.hoverGroup.add(outline);
    }
  }

  private updateFillPreview() {
    const start = this.pointerStart?.start, piece = this.props.scene.placementPiece;
    if (!start || !piece || this.props.scene.gesture !== 'fill' || !this.hover) { this.fillPreview.visible = false; return; }
    const hit = this.pick(this.hover, 'hull');
    if (!hit) { this.fillPreview.visible = false; return; }
    const end = hit.placement, extents = pieceExtents(piece);
    const low = start.placement.map((value, index) => Math.min(value, end[index]) - extents[index] / 2), high = start.placement.map((value, index) => Math.max(value, end[index]) + extents[index] / 2);
    this.fillPreview.visible = true;
    this.fillPreview.position.set((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2);
    this.fillPreview.scale.set(Math.max(.01, high[0] - low[0]), Math.max(.01, high[1] - low[1]), Math.max(.01, high[2] - low[2]));
  }

  /** Draw the pending gesture each frame; source/history commits once on release. */
  private updateStrokePreview() {
    const drag = this.pointerStart, piece = this.props.scene.placementPiece;
    const hit = this.hover ? this.pick(this.hover, 'hull') : undefined;
    const points = drag?.start && piece && hit
      ? this.props.scene.gesture === 'fill' ? fillLattice(drag.start.placement, hit.placement, pieceExtents(piece), drag.start.axis) : drag.points
      : [];
    const key = JSON.stringify([this.ghostKey, this.ghost.rotation.y, this.ghostMirror.rotation.y, points]);
    if (key === this.strokeKey) return;
    this.strokeKey = key;
    // These clones borrow the cursor template's resources.
    this.strokePreview.clear();
    for (const point of points) {
      const instance = this.ghost.clone(true); instance.position.set(...point); instance.visible = true; instance.userData.placementPreview = false;
      this.strokePreview.add(instance);
      if (this.props.scene.placementMirror && Math.abs(point[0]) > 1e-6) {
        const twin = this.ghostMirror.clone(true); twin.position.set(-point[0], point[1], point[2]); twin.visible = true;
        this.strokePreview.add(twin);
      }
    }
  }

  /** Brass over the faces a sweep has crossed, as the cursor piece's ghost is for laid pieces. */
  private updateFacesPreview() {
    const faces = this.pointerStart?.faces, key = faces && this.pointerStart?.moved ? `${this.contentKey}|${[...faces].join('|')}` : '';
    if (key === this.facesKey) return;
    this.facesKey = key; release(this.facesPreview);
    if (!key) return;
    const fill: number[] = [], outline: THREE.Vector3[] = [];
    for (const face of faces!) {
      const group = this.surfacesByKey.get(face);
      if (!group) continue;
      for (const surface of group) for (let i = 1; i < surface.vertices.length - 1; i++) for (const vertex of [surface.vertices[0], surface.vertices[i], surface.vertices[i + 1]]) fill.push(...vertex.map((value, axis) => value + surface.normal[axis] * .02));
      for (const edge of surfaceOutline(group)) {
        const normal = new THREE.Vector3(...edge.surface.normal);
        outline.push(new THREE.Vector3(...edge.a).addScaledVector(normal, .03), new THREE.Vector3(...edge.b).addScaledVector(normal, .03));
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(fill, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide }));
    const edges = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }));
    mesh.renderOrder = 20; edges.renderOrder = 21; this.facesPreview.add(mesh, edges);
  }

  private boxRect(event: { clientX: number; clientY: number }) {
    const start = this.pointerStart!, bounds = this.renderer.domElement.getBoundingClientRect();
    return { left: Math.min(start.x, event.clientX) - bounds.left, top: Math.min(start.y, event.clientY) - bounds.top,
      right: Math.max(start.x, event.clientX) - bounds.left, bottom: Math.max(start.y, event.clientY) - bounds.top };
  }

  private showBox(event?: { clientX: number; clientY: number }) {
    const box = this.overlay.querySelector<HTMLElement>('[data-selection-box]')!;
    const visible = !!event && !!this.pointerStart?.box && !!this.pointerStart.moved;
    box.hidden = !visible;
    if (!visible) return;
    const rect = this.boxRect(event!);
    Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
  }

  private project(point: THREE.Vector3): { x: number; y: number } | undefined {
    const projected = point.clone().project(this.camera);
    if (projected.z > 1 || !Number.isFinite(projected.x)) return undefined;
    return { x: (projected.x + 1) / 2 * this.host.clientWidth, y: (1 - projected.y) / 2 * this.host.clientHeight };
  }

  /** HTML tags follow their world anchors each frame; React owns their content. */
  private placeTags() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    const narrow = width <= 1100, builder = this.props.tags.length ? this.host.closest('.shipbuilder') : null;
    const header = narrow ? builder?.querySelector<HTMLElement>('.sb-top') : null, palette = narrow ? builder?.querySelector<HTMLElement>('.sb-dock') : null;
    const ledger = builder?.querySelector<HTMLElement>('.sb-ledger'), hostRect = builder ? this.host.getBoundingClientRect() : null;
    const ledgerRect = ledger?.offsetWidth && ledger.offsetHeight ? ledger.getBoundingClientRect() : null;
    const hostTop = hostRect?.top ?? 0;
    // Keep editable tags beside the tool rail and between the wrapped header and palette.
    const left = narrow ? 80 : 8, top = header ? header.getBoundingClientRect().bottom - hostTop + 12 : 60;
    const bottom = narrow && palette?.offsetHeight ? palette.getBoundingClientRect().top - hostTop - 12 : height - 90;
    let leaders = '';
    for (const tag of this.props.tags) {
      const element = this.overlay.querySelector<HTMLElement>(`[data-tag="${CSS.escape(tag.key)}"]`);
      if (!element) continue;
      const screen = this.project(new THREE.Vector3(...tag.anchor));
      if (!screen) { element.style.visibility = 'hidden'; continue; }
      element.style.maxHeight = narrow ? `${Math.max(80, bottom - top)}px` : '';
      const tagWidth = element.offsetWidth, tagHeight = element.offsetHeight;
      let x = clamp(screen.x + tag.dx, left, Math.max(left, width - tagWidth - 8)), y = clamp(screen.y + tag.dy, top, Math.max(top, bottom - tagHeight));
      if (ledgerRect) {
        const ledgerLeft = ledgerRect.left - (hostRect?.left ?? 0) - 12, ledgerTop = ledgerRect.top - hostTop - 12;
        const ledgerRight = ledgerRect.right - (hostRect?.left ?? 0) + 12, ledgerBottom = ledgerRect.bottom - hostTop + 12;
        if (x < ledgerRight && x + tagWidth > ledgerLeft && y < ledgerBottom && y + tagHeight > ledgerTop) {
          const beside = ledgerLeft - tagWidth, below = ledgerBottom;
          // Choose the smallest move that leaves the whole editor clear of the Ledger.
          if (below + tagHeight <= bottom && (beside < left || below - y < x - beside)) y = below;
          else if (beside >= left) x = beside;
        }
      }
      // Compact layouts may push the position tag back over the selection.
      // Keep its inputs clear of the actual projected movement handles.
      const handles = this.moveHandles.screenBounds;
      if (handles && (tag.key.startsWith('piece-') || tag.key === 'group')
        && x < handles.right && x + tagWidth > handles.left && y < handles.bottom && y + tagHeight > handles.top) {
        if (handles.bottom + 12 + tagHeight <= bottom) y = handles.bottom + 12;
        else if (handles.top - 12 - tagHeight >= top) y = handles.top - 12 - tagHeight;
      }
      element.style.visibility = 'visible'; element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const endX = screen.x < x + tagWidth / 2 ? x : x + tagWidth, endY = y + tagHeight / 2;
      leaders += `<line x1="${screen.x.toFixed(1)}" y1="${screen.y.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="${LEADER[tag.tone]}"/><circle cx="${screen.x.toFixed(1)}" cy="${screen.y.toFixed(1)}" r="2.5" fill="${LEADER[tag.tone]}"/>`;
    }
    // The readout sits under the palette: the ghost's cell while placing, the offset while moving a selection.
    const coords = this.overlay.querySelector<HTMLElement>('[data-coords]'), move = this.pointerStart?.move;
    const offset = move?.built ? move.delta : this.moveOffset;
    if (coords) {
      if (this.pointerStart?.rotate) { coords.textContent = `Rotate ${signedMetres(this.pointerStart.rotate.degrees)}° · Shift for fine control · Esc cancel`; coords.style.visibility = 'visible'; }
      else if (offset) { coords.textContent = `Δx ${signedMetres(offset[0])} · Δy ${signedMetres(offset[1])} · Δz ${signedMetres(offset[2])}${this.moveBlocked ? ' · Stopped at another block' : ''}`; coords.style.visibility = 'visible'; }
      else if (this.ghost.visible && this.ghostPosition) { coords.textContent = this.props.coords(this.ghostPosition); coords.style.visibility = 'visible'; }
      else coords.style.visibility = 'hidden';
    }
    const measure = this.overlay.querySelector<HTMLElement>('[data-measure]');
    if (measure) {
      const from = this.props.scene.measure?.from, to = this.props.scene.measure?.to ?? (from && this.hover ? this.pick(this.hover, 'hull')?.point : undefined);
      if (from && to) {
        const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
        this.measureLine.geometry.setFromPoints([a, b]);
        const middle = this.project(a.clone().add(b).multiplyScalar(.5));
        const delta = to.map((value, index) => value - from[index]);
        if (middle) {
          measure.innerHTML = `<b>${a.distanceTo(b).toFixed(2)} m</b>Δx ${delta[0].toFixed(2)} · Δy ${delta[1].toFixed(2)} · Δz ${delta[2].toFixed(2)}${this.props.scene.measure?.to ? '' : ' · click to end'}`;
          measure.style.visibility = 'visible'; measure.style.transform = `translate(${(middle.x + 14).toFixed(1)}px, ${(middle.y - 30).toFixed(1)}px)`;
        }
      } else measure.style.visibility = 'hidden';
    }
    const svg = this.overlay.querySelector('svg');
    if (svg) { svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.innerHTML = leaders; }
  }

  /** Only an already-selected piece, fitting or wall can capture a primary drag.
   * A drag over anything else stays with the camera; a separate click selects it. */
  private movePick(event: PointerEvent): MoveDrag | undefined {
    const targets = this.props.scene.moveTargets;
    if (targets === 'none') return undefined;
    const hit = this.pick(event, 'all');
    if (!hit?.id || !this.props.scene.selected.has(hit.id)) return undefined;
    const { primitives, equipment, boundaries } = this.props.scene.source.construction;
    const isPrimitive = (id: string) => primitives.some(part => part.id === id), isEquipment = (id: string) => equipment.some(part => part.id === id);
    const wall = boundaries.find(entry => entry.id === hit.id);
    if (!isPrimitive(hit.id) && !isEquipment(hit.id) && !wall) return undefined;
    if (targets === 'equipment' && !isEquipment(hit.id)) return undefined;
    const allowed = this.props.scene.pickTargets === 'internals' ? internalSelectionIds(this.props.scene.source, this.props.scene.catalog) : undefined;
    const ids = [...this.props.scene.selected].filter(id => (!allowed || allowed.has(id)) && (isPrimitive(id) || isEquipment(id) || boundaries.some(entry => entry.id === id)));
    const origin = new THREE.Vector3(...hit.point), normal = new THREE.Vector3(), free: MoveDrag['free'] = [true, true, true];
    if (wall && ids.length === 1) {
      // A wall slides along its own axis only: drag in the plane that contains the axis and faces the camera.
      const axis = { x: 0, y: 1, z: 2 }[wall.axis];
      normal.copy(this.camera.getWorldDirection(new THREE.Vector3())).setComponent(axis, 0);
      if (normal.lengthSq() < 1e-6) normal.set(axis === 0 ? 0 : 1, 0, axis === 0 ? 1 : 0);
      free.fill(false); free[axis] = true;
    } else {
      // Pieces slide in the plane of the pressed face; press a side face to move vertically.
      normal.setComponent(hit.axis, Math.sign(hit.normal?.[hit.axis] ?? 1) || 1);
      free[hit.axis] = false;
    }
    return { ids, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), origin), origin, free, delta: [0, 0, 0], built: false, constrain: blockMoveConstraint(this.props.scene.source, new Set(ids)) };
  }

  private updateMoveHandles() {
    const props = this.props;
    const { primitives, equipment, boundaries } = props.scene.source.construction;
    const internals = props.scene.pickTargets === 'internals';
    const allowed = internals ? internalSelectionIds(props.scene.source, props.scene.catalog) : undefined;
    const ids = [...props.scene.selected].filter(id => (!allowed || allowed.has(id)) && (props.scene.moveTargets !== 'equipment' || equipment.some(item => item.id === id)));
    const selected = new Set(ids), blocks = primitives.filter(p => selected.has(p.id));
    if (props.scene.freeform || props.scene.moveTargets === 'none' || (!internals && (props.scene.moveTargets !== 'all' || !blocks.length)) || !ids.length) { this.moveHandles.update(); return; }
    const anchors: Vec3[] = blocks.map(p => p.position);
    const modules = internals ? equipment.filter(p => selected.has(p.id)) : [];
    const walls = internals ? boundaries.filter(p => selected.has(p.id)) : [];
    for (const item of modules) {
      const part = props.scene.catalog.equipment.find(p => p.id === item.partId);
      const center = new THREE.Vector3(...(part ? equipmentPathBounds(part, item).center : [0, 0, 0] as Vec3));
      center.applyAxisAngle(new THREE.Vector3(0, 1, 0), -item.bearingDeg * Math.PI / 180).add(new THREE.Vector3(...item.position));
      anchors.push(center.toArray() as Vec3);
    }
    for (const wall of walls) {
      const center = this.controls.target.clone(); center.setComponent({ x: 0, y: 1, z: 2 }[wall.axis], wall.offset);
      anchors.push(center.toArray() as Vec3);
    }
    if (!anchors.length) { this.moveHandles.update(); return; }
    const axes = [0, 1, 2].map(k => !!blocks.length || !!modules.length || walls.some(wall => 'xyz'.indexOf(wall.axis) === k)) as [boolean, boolean, boolean];
    const key = JSON.stringify([props.scene.source.id, props.scene.source.revision, ids, props.scene.view, props.scene.perspective, props.scene.gridStep, props.scene.moveTargets, props.scene.pickTargets]);
    if (key !== this.moveConstraintKey) {
      this.moveConstraintKey = key; this.constrainMove = blockMoveConstraint(props.scene.source, selected);
    }
    const anchor = anchors.reduce<Vec3>((sum, p) => sum.map((v, k) => v + p[k] / anchors.length) as Vec3, [0, 0, 0]);
    this.moveHandles.update({ key, anchor, axes, unit: props.scene.gridStep, snap: (raw, free) => this.snapMove(ids, raw, free), constrain: this.constrainMove,
      preview: (delta, blocked) => {
        if (!delta) { this.finishMove(); return; }
        this.moveOffset = delta; this.moveBlocked = !!blocked; if (blocked) this.clearSnap();
        if (!this.movePreview.children.length) this.buildMovePreview(ids);
        this.positionMovePreview(delta); this.movePreview.visible = delta.some(v => v !== 0);
      },
      commit: delta => props.onPointer({ kind: 'move', ids, delta }),
    });
  }

  /** Brass copies of the moved pieces; the originals stay until the source commits on release. */
  private buildMovePreview(ids: string[]) {
    release(this.movePreview);
    const { primitives, equipment, boundaries } = this.props.scene.source.construction;
    for (const id of ids) {
      const primitive = primitives.find(part => part.id === id);
      if (primitive) {
        const geometry = primitiveGeometry(primitive.kind, primitive.size, primitive.vertices, primitive.customHull, primitive.shaping);
        const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: .22, depthWrite: false }));
        const edges = new THREE.LineSegments(primitiveOutlineGeometry(primitive), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }));
        for (const object of [fill, edges]) { object.position.set(...primitive.position); object.rotation.y = primitive.rotationDeg * Math.PI / 180; object.renderOrder = 20; this.movePreview.add(object); }
        continue;
      }
      const item = equipment.find(part => part.id === id);
      if (item) {
        const datum = new THREE.Group(); datum.position.set(...item.position); datum.rotation.y = -item.bearingDeg * Math.PI / 180;
        const ghost = this.equipment.clone(item.partId, true, item.path), part = this.props.scene.catalog.equipment.find(entry => entry.id === item.partId);
        if (ghost) datum.add(ghost);
        else if (part) { const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...part.size)), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false })); box.position.set(...part.boundsCenter); datum.add(box); }
        this.movePreview.add(datum); continue;
      }
      const wall = boundaries.find(entry => entry.id === id);
      if (wall) {
        const plane = new THREE.Mesh(boundaryGeometry(primitives, wall.axis, wall.offset), new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: .25, depthWrite: false, side: THREE.DoubleSide }));
        plane.userData.boundary = wall; plane.userData.offset = wall.offset; this.movePreview.add(plane);
      }
    }
    this.movePreview.position.set(0, 0, 0);
  }

  private positionMovePreview(delta: Vec3) {
    this.movePreview.position.set(...delta);
    for (const child of this.movePreview.children) {
      const wall = child.userData.boundary;
      if (!wall || !(child instanceof THREE.Mesh)) continue;
      const offset = wall.offset + delta[{ x: 0, y: 1, z: 2 }[wall.axis as 'x' | 'y' | 'z']];
      if (offset !== child.userData.offset) {
        child.geometry.dispose();
        child.geometry = boundaryGeometry(this.props.scene.source.construction.primitives, wall.axis, offset);
        child.userData.offset = offset;
      }
      // Only the normal offset moves a boundary, including in mixed selections.
      child.position.set(-delta[0], -delta[1], -delta[2]);
    }
  }

  private updateMove(event: { clientX: number; clientY: number }) {
    const move = this.pointerStart?.move;
    if (!move) return;
    if (!move.built) { this.buildMovePreview(move.ids); move.built = true; this.renderer.domElement.style.cursor = 'move'; }
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    const point = ray.ray.intersectPlane(move.plane, new THREE.Vector3());
    if (point) {
      const raw = point.sub(move.origin);
      const requested = this.snapMove(move.ids, raw.toArray().map((v, k) => move.free[k] ? v : 0) as Vec3, move.free);
      move.delta = move.constrain(requested);
      this.moveBlocked = move.delta.some((v, k) => Math.abs(v - requested[k]) > 1e-7);
      if (this.moveBlocked) this.clearSnap();
    }
    this.positionMovePreview(move.delta); this.movePreview.visible = true;
  }

  private finishMove() { this.clearSnap(); release(this.movePreview); this.movePreview.visible = false; this.moveOffset = undefined; this.moveBlocked = false; this.renderer.domElement.style.cursor = ''; }

  /** A press that is not laying pieces hides the ghost and hover outline: box selection, the secondary button, a move or a camera drag. */
  private navigating() { const press = this.pointerStart; return !!press && !press.start && !press.faces && (press.box || press.button === 2 || press.moved); }
  private rotationPick(event: PointerEvent): RotationDrag | undefined {
    const scene = this.props.scene;
    if (scene.freeform || scene.pathDraft || scene.moveTargets === 'none') return undefined;
    const hit = this.pick(event, scene.pickTargets);
    if (hit?.id && scene.source.construction.equipment.some(item => item.id === hit.id)) {
      const allowed = scene.pickTargets === 'internals' ? internalSelectionIds(scene.source, scene.catalog) : undefined;
      const ids = scene.source.construction.equipment.filter(item => (!allowed || allowed.has(item.id)) && (scene.selected.has(hit.id!) ? scene.selected.has(item.id) : item.id === hit.id)).map(item => item.id);
      return { ids, degrees: 0, travelDegrees: 0, lastX: event.clientX };
    }
    if (scene.placementPiece?.kind === 'equipment' && this.ghost.visible && this.ghostPosition) return { ids: [], degrees: 0, travelDegrees: 0, lastX: event.clientX, position: [...this.ghostPosition] };
    return undefined;
  }

  private previewRotation(rotation: RotationDrag, degrees: number) {
    for (const item of this.props.scene.source.construction.equipment) {
      if (!rotation.ids.includes(item.id)) continue;
      const object = this.equipment.group.getObjectByName(item.id);
      if (object) { object.rotation.y = -(item.bearingDeg + degrees) * Math.PI / 180; object.updateMatrixWorld(true); }
      for (const datum of this.details.children) if (datum.children.some(child => child.userData.sourceId === item.id)) datum.rotation.y = -(item.bearingDeg + degrees) * Math.PI / 180;
    }
  }
  private down = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 2) || this.pointerStart) return;
    this.hover = { clientX: event.clientX, clientY: event.clientY }; this.updateGhost();
    const rotate = event.button === 2 ? this.rotationPick(event) : undefined;
    if (rotate) { this.controls.enabled = false; event.stopImmediatePropagation(); event.preventDefault(); }
    const box = event.button === 0 && event.shiftKey;
    if (box) {
      // Finish OrbitControls' damped deltas without moving the visible camera.
      const position = this.camera.position.clone(), rotation = this.camera.quaternion.clone(), target = this.controls.target.clone();
      const damping = this.controls.enableDamping;
      this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
      this.camera.position.copy(position); this.camera.quaternion.copy(rotation); this.controls.target.copy(target); this.camera.updateMatrixWorld(true);
      this.controls.enabled = false; event.stopImmediatePropagation(); event.preventDefault();
    }
    const path = !box && event.button === 0 && this.props.scene.pathDraft ? this.pathPick(event) : undefined;
    if (path) { this.controls.enabled = false; event.stopImmediatePropagation(); event.preventDefault(); }
    const move = !box && !this.props.scene.pathDraft && event.button === 0 ? this.movePick(event) : undefined;
    const start = !box && !move && event.button === 0 && this.props.scene.gesture !== 'none' && this.props.scene.placementPiece ? this.pick(event, 'hull') : undefined;
    // A press on a face with Paint or Opening begins a sweep: every face the drag crosses joins it, and release commits them as one edit.
    const face = !box && !move && !path && event.button === 0 && this.props.scene.gesture === 'faces' ? this.pick(event, this.props.scene.pickTargets)?.surface : undefined;
    // A press on the hull lays or moves pieces, so OrbitControls (which listens after this capture handler) must not orbit with the same drag; `up` and `cancel` re-enable it.
    if (start || move || face) this.controls.enabled = false;
    this.pointerStart = { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, moved: false, box, additive: event.ctrlKey || event.metaKey, start, rotate, move, points: start ? [start.placement] : [], faces: face ? new Set([face]) : undefined };
    this.hover = { clientX: event.clientX, clientY: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.updateGhost(); this.updateStrokePreview();
  };
  private move = (event: PointerEvent) => {
    this.hover = { clientX: event.clientX, clientY: event.clientY }; this.updatePathPreview(); this.updateGhost(); this.highlight(event);
    if (!this.pointerStart || event.pointerId !== this.pointerStart.id) return;
    this.pointerStart.moved ||= Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) >= 5;
    if (this.pointerStart.rotate) {
      const rotation = this.pointerStart.rotate;
      if (this.pointerStart.moved) {
        rotation.travelDegrees += (event.clientX - rotation.lastX) * (event.shiftKey ? .1 : .5);
        rotation.degrees = Number(rotation.travelDegrees.toFixed(1));
        rotation.lastX = event.clientX;
        this.previewRotation(rotation, rotation.degrees); this.updateGhost();
      }
      return;
    }
    if (this.pointerStart.box) { this.showBox(event); return; }
    if (this.pointerStart.move) { if (this.pointerStart.moved) this.updateMove(event); return; }
    if (this.pointerStart.faces) {
      const face = this.pointerStart.moved ? this.pick(event, this.props.scene.pickTargets)?.surface : undefined;
      if (face && this.pointerStart.faces.size < 4096) this.pointerStart.faces.add(face);
      this.updateFacesPreview(); return;
    }
    const { start, points } = this.pointerStart, piece = this.props.scene.placementPiece;
    if (!start || !piece) return;
    if (this.props.scene.gesture === 'fill') { this.updateFillPreview(); this.updateStrokePreview(); return; }
    const hit = this.pick(event, 'hull');
    if (!hit) { this.updateStrokePreview(); return; }
    const current = hit.placement, previous = points.at(-1) ?? current;
    for (const point of strokeSegment(previous, current, pieceExtents(piece), start.axis)) {
      if (points.length >= 128) break;
      if (!points.some(existing => same(existing, point))) points.push(point);
    }
    this.updateStrokePreview();
  };
  private up = (event: PointerEvent) => {
    if (event.button !== this.pointerStart?.button || event.pointerId !== this.pointerStart.id) return;
    const start = this.pointerStart, rect = start.box ? this.boxRect(event) : undefined;
    this.pointerStart = undefined; this.controls.enabled = true; this.fillPreview.visible = false;
    this.strokePreview.clear(); this.strokeKey = ''; this.updateFacesPreview(); this.showBox();
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    const clicked = !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5;
    const piece = this.props.scene.placementPiece;
    if (start.rotate && !clicked) {
      this.previewRotation(start.rotate, 0);
      if (Math.abs(start.rotate.degrees % 360) > 1e-6) this.props.onPointer({ kind: 'rotate', ids: start.rotate.ids, degrees: start.rotate.degrees });
      this.updateGhost();
    } else if (start.button === 2) {
      const hit = clicked ? this.pick(event, 'all') : undefined;
      if (hit?.id && !this.props.scene.freeform && !this.props.scene.pathDraft) this.props.onPointer({ kind: 'erase', id: hit.id });
    } else if (this.props.scene.pathDraft && !rect) {
      const point = clicked ? this.pathPick(event) : undefined;
      if (point) this.props.onPointer({ kind: 'path-point', point });
    } else if (rect) {
      if (clicked) { const hit = this.pick(event, 'all'); this.props.onPointer({ kind: 'box', ids: hit?.id ? [hit.id] : [], additive: true }); }
      else this.props.onPointer({ kind: 'box', ids: boxSelectedPieces(this.props.scene.source, this.props.scene.catalog, this.camera, rect, this.host.clientWidth, this.host.clientHeight, this.props.scene.rooms), additive: start.additive });
    } else if (start.move) {
      const moved = start.moved && start.move.delta.some(value => Math.abs(value) > 1e-6);
      this.finishMove();
      if (moved) this.props.onPointer({ kind: 'move', ids: start.move.ids, delta: start.move.delta });
      else if (clicked) this.props.onPointer({ kind: 'pick', hit: this.pick(event, 'all') });
    } else if (start.start && piece) {
      const hit = this.pick(event, 'hull');
      if (!hit) return;
      if (this.props.scene.gesture === 'fill') this.props.onPointer({ kind: 'lay', points: fillLattice(start.start.placement, clicked ? start.start.placement : hit.placement, pieceExtents(piece), start.start.axis) });
      else this.props.onPointer({ kind: 'lay', points: clicked ? [start.start.placement] : start.points });
    } else if (start.faces && !clicked) this.props.onPointer({ kind: 'faces', surfaces: [...start.faces] });
    else if (clicked) this.props.onPointer({ kind: 'pick', hit: this.pick(event, this.props.scene.placementPiece ? 'hull' : this.props.scene.pickTargets) });
  };
  private pathPick(event: { clientX: number; clientY: number }): Vec3 | undefined {
    const draft = this.props.scene.pathDraft;
    if (!draft) return undefined;
    const hit = this.pick(event, draft.part.path?.kind === 'railing' ? 'hull' : 'all');
    if (!hit) return undefined;
    const settings = this.props.scene.snapping ?? DEFAULT_SNAPPING;
    const raw = pathAnchor(draft.part, this.props.scene.source, this.props.scene.catalog, hit, null);
    const grid = pathAnchor(draft.part, this.props.scene.source, this.props.scene.catalog, hit, settings.enabled && settings.grid ? this.props.scene.gridStep : null);
    if (!raw || !grid || this.props.scene.source.construction.equipment.some(p => p.id === hit.id)) return grid;
    const point = this.resolveSnapping('path', raw, grid, SHIP_AXES.filter((_, k) => k !== hit.axis), [{ id: 'path:center', owner: 'path', point: [0, 0, 0], kind: 'center' }, { id: 'path:corner', owner: 'path', point: [0, 0, 0], kind: 'corner' }], new Set());
    const normal = hit.normal ?? [0, 1, 0]; point[hit.axis] -= point.reduce((sum, v, k) => sum + (v - raw[k]) * normal[k], 0) / normal[hit.axis];
    this.workingPoint = point; this.workingAxis = hit.axis; return point;
  }
  private updatePathPreview() {
    const draft = this.props.scene.pathDraft, point = draft && this.hover && !this.navigating() ? this.pathPick(this.hover) : undefined;
    const points = draft ? point ? appendPathPoint(draft.points, point) : draft.points : [];
    const key = JSON.stringify([draft?.part.id, points, draft?.slackM, draft?.mirror]);
    if (key === this.pathPreviewKey) return;
    this.pathPreviewKey = key; release(this.pathPreview);
    if (!draft || !points.length) return;
    if (points.length > 1) {
      this.pathPreview.add(createConstructionPathModel(draft.part, { points, slackM: draft.slackM }, true));
      if (draft.mirror && points.some(p => Math.abs(p[0]) > 1e-6)) this.pathPreview.add(createConstructionPathModel(draft.part, { points: points.map(p => [-p[0], p[1], p[2]]), slackM: draft.slackM }, true));
    }
    const geometry = new THREE.SphereGeometry(.075, 8, 6), material = new THREE.MeshBasicMaterial({ color: BRASS_LIGHT, depthTest: false });
    for (const p of points) { const marker = new THREE.Mesh(geometry, material); marker.position.set(...p); marker.renderOrder = 30; this.pathPreview.add(marker); }
  }
  private contextMenu = (event: MouseEvent) => event.preventDefault();
  private finishPath = (event: MouseEvent) => { if (this.props.scene.pathDraft) { event.preventDefault(); this.props.onPointer({ kind: 'path-finish' }); } };
  private leave = () => { this.clearSnap(); this.showArmorTooltip(); this.reportHover(); this.hover = undefined; this.updatePathPreview(); this.ghost.visible = false; this.ghostMirror.visible = false; this.ghostArc.visible = false; this.ghostPosition = undefined; release(this.hoverGroup); this.hoverSurface = ''; };
  private cancel = () => {
    const pointer = this.pointerStart; this.pointerStart = undefined; this.controls.enabled = true;
    if (pointer?.rotate) this.previewRotation(pointer.rotate, 0);
    if (pointer && this.renderer.domElement.hasPointerCapture(pointer.id)) this.renderer.domElement.releasePointerCapture(pointer.id);
    this.fillPreview.visible = false; this.strokePreview.clear(); this.strokeKey = ''; this.updateFacesPreview(); this.showBox(); this.finishMove(); this.leave();
  };
  private key = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.pointerStart) this.cancel(); };
  private animate = () => {
    if (this.dead) return;
    if(!this.freeformHandles.dragging && !this.moveHandles.dragging && !this.pointerStart?.rotate) this.controls.update();
    if (this.hover) { if (this.props.scene.placementPiece) this.updateGhost(); this.highlight(this.hover); }
    this.floorGrid.visible = this.camera.position.y > (this.floorGrid.children[0]?.position.y ?? 0);
    this.drawSnapGuides();
    this.freeformHandles.frame(); this.moveHandles.frame(); this.renderer.render(this.scene, this.camera); this.placeTags();
    if (!this.orientationRotation.equals(this.camera.quaternion)) {
      updateBuilderOrientation(this.orientation, this.camera);
      this.orientationRotation.copy(this.camera.quaternion);
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  measureMemory() {
    const roots = this.composed.children.length ? [this.composed] : [];
    if (!this.props.createModel || !this.composed.children.length) roots.push(this.equipment.group);
    return visualMemory(roots, this.props.scene.source, !!this.composed.children.length && !!this.props.scene.current);
  }

  dispose() {
    this.snapOverlay.dispose();
    this.freeformHandles.dispose();
    this.moveHandles.dispose();
    this.dead = true; cancelAnimationFrame(this.frame); this.modelAbort?.abort(); this.resize.disconnect(); this.controls.dispose();
    this.strokePreview.clear(); this.equipment.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.down, true); canvas.removeEventListener('pointermove', this.move); canvas.removeEventListener('pointerup', this.up);
    canvas.removeEventListener('contextmenu', this.contextMenu);
    canvas.removeEventListener('dblclick', this.finishPath); canvas.removeEventListener('pointercancel', this.cancel); canvas.removeEventListener('pointerleave', this.leave);
    canvas.removeEventListener('lostpointercapture', this.cancel); window.removeEventListener('keydown', this.key);
    window.removeEventListener('blur', this.cancel);
    release(this.scene); this.renderer.dispose(); this.renderer.forceContextLoss(); canvas.remove();
  }
}

export function BuilderViewport(props: ViewportProps) {
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null), viewport = useRef<Viewport | undefined>(undefined);
  const orientation = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    try { viewport.current = new Viewport(host.current!, overlay.current!, orientation.current!, props, setError); }
    catch (error) { setError(`The 3D view could not start: ${error instanceof Error ? error.message : String(error)}. Your source remains editable and saveable.`); }
    return () => { viewport.current?.dispose(); viewport.current = undefined; };
  }, []);
  useEffect(() => { viewport.current?.update(props); }, [props]);
  useEffect(() => {
    if (!props.onMemory) return;
    let previous = '';
    const sample = () => {
      if (!viewport.current) return;
      const memory = viewport.current.measureMemory(), signature = JSON.stringify(memory);
      if (signature !== previous) { previous = signature; props.onMemory?.(memory); }
    };
    sample();
    const timer = window.setInterval(sample, 1500);
    return () => window.clearInterval(timer);
  }, [props.onMemory]);
  return <div className="sb-viewport" aria-label="Ship construction viewport">
    <div ref={host} className="sb-canvas"/>
    <div ref={overlay} className="sb-overlay">
      <svg className="sb-leaders" aria-hidden="true"/>
      {props.tags.map(tag => <div key={tag.key} data-tag={tag.key} className={`sb-tag ${tag.tone}`} style={tag.passive ? { pointerEvents: 'none' } : undefined}>{tag.content}</div>)}
      <div className="sb-cursor">{props.status}<span data-coords className="sb-coords"/></div>
      <div data-armor-tooltip role="tooltip" className="sb-tag brass sb-armor-tooltip" hidden><b/><span/></div>
      <div data-measure className="sb-tag mint"/>
      <div data-selection-box className="sb-selection-box" hidden aria-hidden="true"/>
    </div>
    <BuilderOrientation elementRef={orientation}/>
    {error && <p role="alert" className="sb-view-error">{error}</p>}
  </div>;
}

import { RotateHandles } from './RotateHandles';
import { orientVector, unorientVector, rotateBlock } from '../../ships/constructionOrientation';
import { mirroredBalcony } from '../../ships/constructionBalcony';
import { wallNormal, wallBearing, wallRow } from '../../ships/constructionWallFittings';
import { visualMemory, type VisualMemory } from './modelMemory';
import { constructionSnapFeatures, SHIP_AXES, type SnapFeature } from './snapping';
import { add } from '../../ships/freeformShape';
import { envelopeVertices } from '../../ships/freeformShape';
import { createBuilderGrid } from './builderGrid';
import { FreeformHandles } from './FreeformHandles';
import { MoveHandles } from './MoveHandles';
import { mirroredMoveConstraint, blockPlacementAllowed, placementBlocks, OVERLAP_PREVIEW_NOTICE } from './blockMovement';
import { withTwinReplacements } from './mirrorEditing';
import { cornerVertices, worldVertex, selectionCenter, selectionCorners } from '../../ships/constructionVertex';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { pendingHullSurfaces } from './pendingHull';
import { normalizedBearing, snapCoordinate } from './editorNumbers';
import { fillLattice, pieceExtents, strokeSegment } from './placement';
import { placementRotation } from './primitiveGeometry';
import type { BuilderPick, BuilderPlacement, BuilderPointerEvent, BuilderScene } from './builderScene';
import { createConstructionHull } from '../../game/constructionModel';
import { appendPathPoint } from './pathDrawing';
import { EquipmentPreview } from './equipmentPreview';
import { boxSelectedPieces } from './boxSelection';
import { BuilderOrientation, updateBuilderOrientation } from './BuilderOrientation';
import { armorReading, placeArmorTooltip } from './viewport/armorTooltip';
import { CameraRig } from './viewport/CameraRig';
import { buildGhost, mirroredWallGhostSupported, tintGhosts } from './viewport/ghostPreview';
import { fillHoverOutline } from './viewport/hoverOutline';
import { buildHullContent } from './viewport/hullContent';
import { buildMovePreview, moveDrag, moveHandleTargets, positionMovePreview, twinIds, type MoveDrag } from './viewport/movePreview';
import { fillPathPreview, pathPoint } from './viewport/pathPreview';
import { pickScene, type PickEvent } from './viewport/picking';
import { BRASS, BRASS_LIGHT, MINT, arcMesh, pointerRay, release, same, signedMetres } from './viewport/resources';
import { previewRotation, rotationDrag, type RotationDrag } from './viewport/rotationPreview';
import { fillArcs, fillDetails, fillProposals } from './viewport/sceneDetails';
import { fillFacesPreview, fillStrokePreview, placeFillPreview, rowPoints } from './viewport/strokeFillPreview';
import { boxRect, placeMeasure, placeTags, showGestureFeedback, showSelectionBox } from './viewport/tags';
import { fillVertexPreview } from './viewport/vertexPreview';
import { ViewportSnapping } from './viewport/ViewportSnapping';

export type {
  BuilderArc,
  BuilderDisplay,
  BuilderGesture,
  BuilderMoveTargets,
  BuilderPick,
  BuilderPointerEvent,
  BuilderProposal,
  BuilderScene,
  BuilderView,
} from './builderScene';
export interface BuilderTag {
  key: string;
  anchor: Vec3;
  dx: number;
  dy: number;
  tone: 'mint' | 'brass' | 'bad';
  passive?: boolean;
  content: ReactNode;
}
export type ConstructionModelFactory = (
  source: ConstructionSource,
  result: ConstructionResult,
  signal: AbortSignal,
) => Promise<THREE.Group>;
/** The three.js adapter's interface: the scene to draw, HTML overlays React owns, and one door for finished gestures. */
export interface ViewportProps {
  scene: BuilderScene;
  tags: BuilderTag[];
  /** The placement controls under the palette. */
  status?: ReactNode;
  /** Every pointer gesture, with its targets already raycast, snapped and filtered by the scene's targets. */
  onPointer(event: BuilderPointerEvent): void;
  onHover?(id: string | undefined): void;
  /** Transient block previews never enter source history or compilation. */
  onRotationPreview?(primitive: ConstructionPrimitive | undefined): void;
  onFreeformPreview?(primitive: ConstructionPrimitive | undefined): void;
  createModel?: ConstructionModelFactory;
  onMemory?(memory: VisualMemory): void;
}
class Viewport {
  private renderer: THREE.WebGLRenderer;
  private rig = new CameraRig();
  private get camera() {
    return this.rig.camera;
  }
  private get controls() {
    return this.rig.controls;
  }
  private get span() {
    return this.rig.span;
  }
  /** Browser checks read the active guides through the development handle. */
  private get snapGuides() {
    return this.snap.guides;
  }
  private freeformHandles: FreeformHandles;
  private moveHandles: MoveHandles;
  private rotateHandles: RotateHandles;
  private snap: ViewportSnapping;
  private snapFeaturesKey = '';
  private moveConstraintKey = '';
  private constrainMove: (delta: Vec3) => Vec3 = (delta) => delta;
  private moveOffset?: Vec3;
  private moveBlocked = false;
  private vertexPreview = new THREE.Group();
  private pathPreview = new THREE.Group();
  private pathPreviewKey = '';
  private scene = new THREE.Scene();
  private floorGrid = new THREE.Group();
  private gridKey = '';
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
  /** Deck planes: floors an internal package can land on. */
  private deckMeshes: THREE.Object3D[] = [];
  private surfaceTriangles: ConstructionSurface[] = [];
  private props: ViewportProps;
  private frame = 0;
  private dead = false;
  private hullSize = new THREE.Vector3(20, 10, 50);
  private contentKey = '';
  private modelKey = '';
  private ghostKey = '';
  private arcKey = '';
  private proposedKey = '';
  private hoverSurface = '';
  private hoveredPart?: string;
  private modelAbort?: AbortController;
  /** First click of a two-click window row; the second click on the same wall lays it. */
  private rowStart?: { pick: BuilderPick; partId?: string };
  private pointerStart?: {
    id: number;
    button: number;
    x: number;
    y: number;
    moved: boolean;
    box: boolean;
    additive: boolean;
    start?: BuilderPick;
    rotate?: RotationDrag;
    move?: MoveDrag;
    points: Vec3[];
    faces?: Set<string>;
  };
  /** The faces a Paint or Opening drag has crossed so far, drawn as brass over the hull until release commits them. */
  private facesPreview = new THREE.Group();
  private facesKey = '';
  /** The drawn faces by selection key: the hull's logical faces, for outlines and sweep previews. */
  private surfacesByKey = new Map<string, ConstructionSurface[]>();
  private compiledGeometry?: { result: ConstructionResult; source: ConstructionSource };
  private carried?: { sourceId: string; revision: string; result: ConstructionResult; surfaces: ConstructionSurface[] };
  private hover?: { clientX: number; clientY: number };
  private ghostPosition?: Vec3;
  private placementBlocked = false;
  private strokeBlocked = false;
  private placementCheckKey = '';
  private modelError: (message: string) => void;
  private orientationRotation = new THREE.Quaternion(0, 0, 0, 0);

  constructor(
    private host: HTMLDivElement,
    private overlay: HTMLDivElement,
    private orientation: HTMLDivElement,
    props: ViewportProps,
    modelError: (message: string) => void,
  ) {
    this.props = props;
    this.modelError = modelError;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#edf0f2', '#595c5f', 2.6));
    const sun = new THREE.DirectionalLight('#fff2d2', 3);
    sun.position.set(-80, 150, -120);
    this.scene.add(sun);
    this.equipment = new EquipmentPreview(() => {
      this.ghostKey = '';
      this.update(this.props);
    }, modelError);
    this.ghost.name = 'Placement preview';
    this.ghost.userData.placementPreview = true;
    this.fillPreview = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.fillPreview.visible = false;
    this.fillPreview.renderOrder = 21;
    this.measureLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: MINT, depthTest: false }),
    );
    this.measureLine.renderOrder = 22;
    this.measureGroup.add(this.measureLine);
    this.measureGroup.visible = false;
    this.strokePreview.name = 'Pieces in current drag';
    this.strokePreview.userData.strokePreview = true;
    this.movePreview.name = 'Selection being moved';
    this.movePreview.userData.movePreview = true;
    this.movePreview.visible = false;
    this.facesPreview.name = 'Faces in current sweep';
    this.scene.add(
      this.floorGrid,
      this.hull,
      this.details,
      this.selection,
      this.hoverGroup,
      this.composed,
      this.equipment.group,
      this.arcGroup,
      this.proposedGroup,
      this.ghost,
      this.ghostMirror,
      this.ghostArc,
      this.fillPreview,
      this.strokePreview,
      this.movePreview,
      this.facesPreview,
      this.measureGroup,
    );
    this.snap = new ViewportSnapping(
      host,
      () => this.camera,
      () => this.props.scene,
      this.hullSize,
    );
    this.freeformHandles = new FreeformHandles(
      host,
      () => this.camera,
      (replacements) => this.previewVertices(replacements),
      {
        clear: () => this.snap.clear(),
        resolve: (raw, free, primitive, options) => {
          const corners = cornerVertices(primitive),
            selected = selectionCorners(options.selection, primitive);
          const moving: SnapFeature[] = selected.map((i) => ({
            id: `edit:${i}`,
            owner: primitive.id,
            point: worldVertex(primitive, corners[i]),
            kind: 'corner',
          }));
          moving.unshift({
            id: 'edit:center',
            owner: primitive.id,
            point: add(primitive.position, orientVector(primitive, selectionCenter(primitive, options.selection))),
            kind: 'center',
          });
          const directions = SHIP_AXES.filter((_, k) => free[k]).map((v) => orientVector(primitive, v));
          const grid = raw.map((v) => snapCoordinate(v, options.unit)) as Vec3;
          const delta = this.snap.resolve(
            `freeform:${primitive.id}`,
            orientVector(primitive, raw),
            orientVector(primitive, grid),
            directions,
            moving,
            new Set([primitive.id]),
          );
          return unorientVector(primitive, delta);
        },
      },
    );
    this.moveHandles = new MoveHandles(host, () => this.camera);
    this.rotateHandles = new RotateHandles(host, () => this.camera);
    this.scene.add(this.vertexPreview, this.pathPreview);
    this.rig.attach(this.renderer.domElement);
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(host);
    this.measure();
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Ship construction viewport');
    canvas.addEventListener('pointerdown', this.down, true);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('contextmenu', this.contextMenu);
    canvas.addEventListener('dblclick', this.finishPath);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('lostpointercapture', this.cancel);
    window.addEventListener('keydown', this.key);
    window.addEventListener('blur', this.cancel);
    if (import.meta.env.DEV) (window as unknown as { shipbuilderViewport?: Viewport }).shipbuilderViewport = this;
    this.update(props);
    this.fit();
    this.animate();
  }

  private measure() {
    this.rig.measure(this.renderer, this.host);
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
    if (this.props.scene.view === 'orbit' || this.props.scene.view === 'top')
      bounds.union(this.floorGrid.children[0]?.userData.frame ?? new THREE.Box3());
    this.rig.frame(bounds, this.props.scene.view, this.renderer, this.host);
    this.ghostKey = '';
  }

  /** Keep finished faces for unchanged pieces and immediately display edited source
   * envelopes. These visual faces never enter the compiled result or enable launch. */
  private carriedSurfaces(scene: BuilderScene): ConstructionSurface[] | undefined {
    const { source, current, result } = scene;
    if (current?.surfaces.length) {
      this.compiledGeometry = { result: current, source };
      return undefined;
    }
    if (current || !result || this.compiledGeometry?.result !== result || this.compiledGeometry.source.id !== source.id) return undefined;
    if (!this.carried || this.carried.sourceId !== source.id || this.carried.revision !== source.revision || this.carried.result !== result)
      this.carried = {
        sourceId: source.id,
        revision: source.revision,
        result,
        surfaces: pendingHullSurfaces(source, this.compiledGeometry.source, result.surfaces),
      };
    return this.carried.surfaces;
  }

  update(props: ViewportProps) {
    const old = this.props;
    this.props = props;
    const snapFeaturesKey = `${props.scene.source.id}:${props.scene.source.revision}:${props.scene.catalog.revision}`;
    if (snapFeaturesKey !== this.snapFeaturesKey) {
      this.snapFeaturesKey = snapFeaturesKey;
      this.snap.features = constructionSnapFeatures(props.scene.source, props.scene.catalog);
      this.snap.clear();
    }
    this.freeformHandles.update(props.scene.source, props.scene.freeform);
    this.updateMoveHandles();
    this.updateRotateHandles();
    if (JSON.stringify(old.scene.snapping) !== JSON.stringify(props.scene.snapping)) {
      this.snap.clear();
      this.moveHandles.refresh();
      this.freeformHandles.refresh();
      if (this.pointerStart?.move && this.hover) this.updateMove(this.hover);
    }
    this.rig.setPerspective(!!props.scene.perspective);
    if (
      props.scene.source.id !== old.scene.source.id ||
      props.scene.source.revision !== old.scene.source.revision ||
      props.scene.gesture !== old.scene.gesture ||
      props.scene.placementPiece !== old.scene.placementPiece ||
      props.scene.moveTargets !== old.scene.moveTargets ||
      props.scene.view !== old.scene.view ||
      props.scene.perspective !== old.scene.perspective ||
      props.scene.selected !== old.scene.selected
    ) {
      // A changed cursor bearing must not forget a stationary pointer and hide the ghost.
      const hover = this.hover;
      this.cancel();
      if (props.scene.source.id === old.scene.source.id) this.hover = hover;
    }
    this.rig.configure(props.scene);
    const gridKey = `${props.scene.source.id}:${props.scene.source.revision}:${props.scene.gridStep}`;
    if (gridKey !== this.gridKey) {
      this.gridKey = gridKey;
      release(this.floorGrid);
      const bounds = new THREE.Box3();
      for (const primitive of props.scene.source.construction.primitives) {
        for (const corner of envelopeVertices(primitive)) bounds.expandByPoint(new THREE.Vector3(...worldVertex(primitive, corner)));
      }
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
      this.snap.bounds.copy(bounds);
      this.floorGrid.add(createBuilderGrid(bounds, props.scene.gridStep));
    }
    if (
      props.scene.view !== this.rig.currentView ||
      props.scene.fitRequest !== old.scene.fitRequest ||
      props.scene.source.id !== old.scene.source.id
    )
      this.fit();
    // `current` is the compile of exactly this revision; `result` is the last accepted one, kept for rooms and centers.
    const invalid = new Set(
      (props.scene.current?.diagnostics ?? []).filter((d) => d.severity === 'error' && d.sourceId).map((d) => d.sourceId!),
    );
    const carried = this.carriedSurfaces(props.scene),
      compiled = props.scene.current?.surfaces.length ? props.scene.current : carried ? props.scene.result : undefined;
    const nativeSurfaces = props.scene.current?.surfaces.length ? props.scene.current.surfaces : carried;
    const armorScale = props.scene.display === 'armor' ? `${props.scene.armorScale.fromMm}-${props.scene.armorScale.toMm}` : '';
    const key = `${props.scene.source.id}:${props.scene.current?.surfaces.length ? props.scene.current.contentHash : `${props.scene.source.revision}:${carried ? 'carried' : 'draft'}`}:${props.scene.display}:${armorScale}:${[...invalid].sort().join(',')}`;
    if (key !== this.contentKey) {
      this.contentKey = key;
      release(this.hull);
      const content = buildHullContent(props.scene, nativeSurfaces, invalid);
      if (content.objects.length) this.hull.add(...content.objects);
      this.surfaceTriangles = content.surfaceTriangles;
      this.pickMeshes = [...content.meshes];
      this.hullMeshes = content.meshes;
      this.surfacesByKey = content.surfacesByKey;
      this.hoverSurface = '';
      release(this.hoverGroup);
    }
    this.equipment.update(props.scene.source, props.scene.catalog, compiled?.propellerSupports, invalid, compiled?.surfaces);
    this.equipment.setDisplay(props.scene.display, props.scene.source, props.scene.catalog, props.scene.armorScale);
    const modelKey = `${props.scene.source.id}:${props.scene.source.revision}:${props.scene.result?.contentHash}`;
    if (modelKey !== this.modelKey) {
      this.modelKey = modelKey;
      this.modelAbort?.abort();
      release(this.composed);
      if (nativeSurfaces && (!props.createModel || props.scene.current)) {
        const abort = new AbortController();
        this.modelAbort = abort;
        const model = props.createModel
          ? props.createModel(props.scene.source, props.scene.current!, abort.signal)
          : Promise.resolve(
              createConstructionHull(
                [...nativeSurfaces, ...(props.scene.current?.bilgeKeelSurfaces ?? [])],
                props.scene.source.construction.primitives,
                props.scene.source.construction.finish,
                props.scene.source.construction,
              ),
            );
        model
          .then((group) => {
            if (this.dead || abort.signal.aborted || modelKey !== this.modelKey) {
              release(group);
              return;
            }
            group.traverse((node) => {
              const mesh = node as THREE.Mesh;
              if (!mesh.isMesh || !mesh.userData.constructionSurfaces) return;
              for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                material.polygonOffset = true;
                material.polygonOffsetFactor = 1;
                material.polygonOffsetUnits = 1;
              }
            });
            this.composed.add(group);
            this.update(this.props);
            this.modelError('');
          })
          .catch((error) => {
            if (!abort.signal.aborted && !this.dead)
              this.modelError(`Equipment preview: ${error instanceof Error ? error.message : String(error)}`);
          });
      }
    }
    this.composed.visible = props.scene.display === 'paint' && !!nativeSurfaces && !invalid.size;
    this.equipment.group.visible = !(props.createModel && this.composed.visible && this.composed.children.length);
    // Keep hull creases visible when shared composition renders the exterior.
    // Native surface meshes remain the pick targets, but their duplicate fills are hidden.
    this.hull.visible = true;
    for (const mesh of this.hullMeshes) mesh.visible = !this.composed.visible || !this.composed.children.length;
    release(this.details);
    release(this.selection);
    this.selection.visible = true;
    this.pickMeshes = this.pickMeshes.filter((mesh) => mesh.parent === this.hull);
    this.deckMeshes = [];
    this.equipment.group.traverse((node) => {
      if (node instanceof THREE.Mesh) this.pickMeshes.push(node);
    });
    fillDetails({
      scene: props.scene,
      invalid,
      nativeSurfaces,
      hull: this.hull,
      details: this.details,
      selection: this.selection,
      equipment: this.equipment,
      pickMeshes: this.pickMeshes,
      deckMeshes: this.deckMeshes,
      surfacesByKey: this.surfacesByKey,
      span: this.span,
    });
    const arcKey = JSON.stringify(props.scene.arcs);
    if (arcKey !== this.arcKey) {
      this.arcKey = arcKey;
      release(this.arcGroup);
      fillArcs(this.arcGroup, props.scene.arcs);
    }
    const proposedKey = JSON.stringify(props.scene.proposed);
    if (proposedKey !== this.proposedKey) {
      this.proposedKey = proposedKey;
      release(this.proposedGroup);
      fillProposals(this.proposedGroup, props.scene.proposed);
    }
    // Models can finish loading, move or repaint beneath a stationary pointer.
    release(this.hoverGroup);
    this.hoverSurface = '';
    this.measureGroup.visible = !!props.scene.measure;
    // A held corner is already dragging, but has no preview until it moves.
    if (this.vertexPreview.visible && this.vertexPreview.children.length) {
      this.hull.visible = false;
      this.composed.visible = false;
      this.selection.visible = false;
    }
    if (this.pointerStart?.rotate) this.previewRotation(this.pointerStart.rotate, this.pointerStart.rotate.degrees);
    this.updatePathPreview();
    this.updateGhost();
    this.updateStrokePreview();
    this.updateFacesPreview();
    if (this.hover) this.highlight(this.hover);
  }

  private updateRotateHandles() {
    const { source, rotation } = this.props.scene;
    const p = rotation && source.construction.primitives.find((p) => p.id === rotation.id);
    this.rotateHandles.update(
      p && rotation
        ? {
            key: `${source.id}:${source.revision}:${p.id}:${rotation.snap}`,
            anchor: p.position,
            axis: rotation.axis,
            snap: rotation.snap,
            select: rotation.onAxis,
            commit: rotation.onCommit,
            preview: (axis, degrees) => {
              const preview = axis === undefined || degrees === undefined ? undefined : rotateBlock(p, axis, degrees);
              this.props.onRotationPreview?.(preview);
              this.previewVertices(preview ? [preview] : undefined);
            },
          }
        : undefined,
    );
  }

  private previewVertices(replacements?: ConstructionPrimitive[]) {
    this.props.onFreeformPreview?.(replacements?.find((p) => p.id === this.props.scene.freeform?.id));
    release(this.vertexPreview);
    this.vertexPreview.visible = !!replacements;
    if (!replacements) {
      this.update(this.props);
      return;
    }
    this.hull.visible = false;
    this.composed.visible = false;
    this.selection.visible = false;
    const shaped = new Set(replacements.map((p) => p.id)),
      scene = this.props.scene;
    // The commit reshapes the twins too, so the preview shows them in mint.
    if (scene.mirrorEdits) replacements = withTwinReplacements(scene.source, replacements, scene.freeform?.id ?? scene.rotation?.id);
    const map = new Map(replacements.map((p) => [p.id, p]));
    fillVertexPreview(this.vertexPreview, this.props.scene.source, map, shaped);
  }

  private updateGhost() {
    const rotation = this.pointerStart?.rotate;
    const original = this.props.scene.placementPiece;
    let piece =
      rotation?.position && original?.kind === 'equipment'
        ? { ...original, bearingDeg: normalizedBearing(original.bearingDeg + rotation.degrees) }
        : original;
    const originalMirror = this.props.scene.placementMirror;
    let mirror =
      rotation?.position && originalMirror?.kind === 'equipment'
        ? { ...originalMirror, bearingDeg: normalizedBearing(originalMirror.bearingDeg - rotation.degrees) }
        : originalMirror;
    // Bearing changes transform the cached preview; they do not rebuild its meshes.
    const shape = (item?: BuilderPlacement) => (item?.kind === 'equipment' ? { ...item, bearingDeg: 0 } : item);
    let pick: Pick<BuilderPick, 'placement' | 'bearingDeg' | 'hullPlacement'> | undefined = rotation?.position
      ? { placement: rotation.position, bearingDeg: undefined as number | undefined }
      : this.hover
        ? this.pick(this.hover, 'hull')
        : undefined;
    if (pick?.hullPlacement) {
      piece = pick.hullPlacement;
      if (mirror?.kind === 'hull')
        mirror = {
          ...piece,
          rotationDeg: -piece.rotationDeg,
          balcony: mirroredBalcony({
            id: 'preview',
            kind: 'balcony',
            position: [0, 0, 0],
            size: piece.size,
            rotationDeg: piece.rotationDeg,
            balcony: piece.balcony,
          }),
        };
    }
    const wallStart = this.pointerStart?.start ?? this.pendingRow();
    if (
      piece?.kind === 'equipment' &&
      piece.wall &&
      wallStart?.bearingDeg !== undefined &&
      pick?.bearingDeg !== undefined &&
      Math.cos(((pick.bearingDeg - wallStart.bearingDeg) * Math.PI) / 180) < 0.7
    )
      pick = undefined;
    if (piece?.kind === 'equipment' && piece.wall && pick?.bearingDeg !== undefined) {
      piece = { ...piece, bearingDeg: pick.bearingDeg };
      if (mirror?.kind === 'equipment') mirror = { ...mirror, bearingDeg: normalizedBearing(-pick.bearingDeg) };
    }
    const offset = piece?.kind === 'boundary' && pick ? pick.placement[{ x: 0, y: 1, z: 2 }[piece.axis]] : undefined;
    const key = JSON.stringify([
      shape(piece),
      shape(mirror),
      piece?.kind === 'hull' && piece.shape === 'balcony' ? Math.sign(pick?.placement[0] ?? 0) : undefined,
      piece?.kind === 'boundary'
        ? [this.props.scene.source.revision, offset]
        : piece?.kind === 'equipment' && piece.wall
          ? [this.props.scene.source.revision, pick?.placement, piece.bearingDeg]
          : undefined,
    ]);
    if (key !== this.ghostKey) {
      this.strokeKey = '';
      release(this.strokePreview);
      this.ghostKey = key;
      release(this.ghost);
      release(this.ghostMirror);
      release(this.ghostArc);
      if (piece) {
        const view = { equipment: this.equipment, scene: this.props.scene, pick, offset };
        buildGhost(view, piece, this.ghost, piece.kind === 'boundary' ? 0.12 : 0.25);
        if (mirror) buildGhost(view, mirror, this.ghostMirror, 0.12, true);
        if (piece.kind === 'equipment' && piece.arc)
          this.ghostArc.add(arcMesh({ bearingDeg: 0, traverseDeg: piece.arc.traverseDeg, radius: piece.arc.radius, color: BRASS }));
      }
    }
    if (piece) this.ghost.rotation.copy(placementRotation(piece));
    if (mirror) this.ghostMirror.rotation.copy(placementRotation(mirror));
    this.ghostArc.rotation.y = piece?.kind === 'equipment' ? (-piece.bearingDeg * Math.PI) / 180 : 0;
    const visible = !!piece && !!pick && (!!rotation?.position || !this.navigating());
    this.ghost.visible = visible;
    if (!visible) {
      this.ghostMirror.visible = false;
      this.ghostArc.visible = false;
      this.ghostPosition = undefined;
      if (piece && !this.pointerStart?.move && !this.moveHandles.dragging) this.snap.clear();
      return;
    }
    const position = [...pick!.placement] as Vec3;
    this.ghostPosition = pick!.placement;
    if (piece?.kind === 'hull') {
      const key = JSON.stringify([this.props.scene.source.revision, piece, position, !!this.props.scene.placementMirror]);
      if (key !== this.placementCheckKey) {
        this.placementCheckKey = key;
        let id = 0;
        this.placementBlocked = !blockPlacementAllowed(
          this.props.scene.source,
          placementBlocks(piece, [position], !!this.props.scene.placementMirror, () => `preview-${id++}`),
        );
      }
      this.tintPlacement(this.placementBlocked);
    } else this.placementBlocked = false;

    // Boundary geometry is already in ship coordinates, independent of orbit target.
    this.ghost.position.set(...(piece!.kind === 'boundary' ? ([0, 0, 0] as Vec3) : position));
    this.ghostMirror.visible = !!this.props.scene.placementMirror && Math.abs(position[0]) > 1e-6;
    if (piece?.kind === 'equipment' && piece.wall && this.ghostMirror.visible)
      this.ghostMirror.visible = mirroredWallGhostSupported(this.props.scene, piece, position);
    if (this.ghostMirror.visible) this.ghostMirror.position.set(-position[0], position[1], position[2]);
    this.ghostArc.visible = this.ghostArc.children.length > 0;
    if (this.ghostArc.visible) this.ghostArc.position.set(position[0], position[1] + 0.08, position[2]);
  }

  private tintPlacement(blocked: boolean) {
    this.placementBlocked = blocked;
    tintGhosts([this.ghost, this.ghostMirror], blocked);
  }

  /** Empty space is never a placement or selection surface. */
  private pick(event: PickEvent, targets: BuilderScene['pickTargets']): BuilderPick | undefined {
    return pickScene(
      {
        canvas: this.renderer.domElement,
        camera: this.camera,
        scene: this.props.scene,
        hullMeshes: this.hullMeshes,
        pickMeshes: this.pickMeshes,
        deckMeshes: this.deckMeshes,
        surfaceTriangles: this.surfaceTriangles,
        heldBalcony: this.pointerStart?.start?.hullPlacement,
        moving: !!this.pointerStart?.move || this.moveHandles.dragging,
        snap: (workingAxis, context, raw, grid, directions, moving) => {
          this.snap.workingAxis = workingAxis;
          return this.snap.resolve(context, raw, grid, directions, moving, new Set());
        },
      },
      event,
      targets,
    );
  }

  private showArmorTooltip(event?: { clientX: number; clientY: number }, pick?: BuilderPick) {
    // The hull face under the pointer, or a turret plate in front of it: turrets carry fixed catalog armor.
    const armor =
      this.props.scene.display === 'armor' && event
        ? armorReading(
            {
              canvas: this.renderer.domElement,
              camera: this.camera,
              scene: this.props.scene,
              equipment: this.equipment,
              hullMeshes: this.hullMeshes,
              surfacesByKey: this.surfacesByKey,
              navigating: this.navigating(),
            },
            event,
            pick,
          )
        : undefined;
    placeArmorTooltip(this.overlay, event, armor);
  }

  private reportHover(id?: string) {
    if (id === this.hoveredPart) return;
    this.hoveredPart = id;
    this.props.onHover?.(id);
  }

  private highlight(event: { clientX: number; clientY: number }) {
    // During placement, the ghost/path already identifies the action. Keep supporting hull blocks and fittings clear.
    const placing = !!this.props.scene.placementPiece || !!this.props.scene.pathDraft;
    const hit = this.navigating() || this.props.scene.measuring ? undefined : this.pick(event, this.props.scene.pickTargets);
    this.reportHover(hit?.id);
    this.showArmorTooltip(event, hit);
    const pick = placing ? undefined : hit;
    const primitive = this.props.scene.source.construction.primitives.find((part) => part.id === pick?.id);
    const face = this.props.scene.highlightFaces && !!primitive;
    const key = face ? (pick?.surface ?? '') : (pick?.id ?? '');
    if (key === this.hoverSurface) return;
    this.hoverSurface = key;
    release(this.hoverGroup);
    if (!key) return;
    fillHoverOutline(this.hoverGroup, key, primitive, face, this.props.scene.highlightFaces, this.pickMeshes, this.surfacesByKey);
  }

  private updateFillPreview() {
    const start = this.pointerStart?.start,
      piece = this.props.scene.placementPiece;
    if (!start || !piece || this.props.scene.gesture !== 'fill' || !this.hover) {
      this.fillPreview.visible = false;
      return;
    }
    const hit = this.pick(this.hover, 'hull');
    if (!hit) {
      this.fillPreview.visible = false;
      return;
    }
    placeFillPreview(this.fillPreview, start.placement, hit.placement, piece);
  }

  /** The placed first end of a window row, dropped once the cursor piece stops being that row. */
  private pendingRow() {
    const piece = this.props.scene.placementPiece;
    if (this.rowStart && !(piece?.kind === 'equipment' && piece.rowSpacing && piece.partId === this.rowStart.partId)) {
      this.rowStart = undefined;
      release(this.strokePreview);
      this.strokeKey = '';
    }
    return this.rowStart?.pick;
  }

  /** Draw the pending gesture each frame; source/history commits once on release. */
  private updateStrokePreview() {
    const row = this.pendingRow();
    const drag = this.pointerStart?.start ? this.pointerStart : row ? { start: row, points: [] as Vec3[] } : undefined,
      piece = drag?.start?.hullPlacement ?? this.props.scene.placementPiece;
    const hit = this.hover ? this.pick(this.hover, 'hull') : undefined;
    const points =
      row && drag?.start === row && piece?.kind === 'equipment' && piece.rowSpacing
        ? rowPoints(row, hit, piece.rowSpacing)
        : drag?.start && piece && hit
          ? this.props.scene.gesture === 'fill'
            ? fillLattice(drag.start.placement, hit.placement, pieceExtents(piece), drag.start.axis)
            : drag.points
          : [];
    const key = JSON.stringify([
      this.props.scene.source.revision,
      this.ghostKey,
      this.ghost.rotation.y,
      this.ghostMirror.rotation.y,
      points,
    ]);
    if (piece?.kind === 'hull' && points.length) {
      if (key !== this.strokeKey) {
        let id = 0;
        this.strokeBlocked = !blockPlacementAllowed(
          this.props.scene.source,
          placementBlocks(piece, points, !!this.props.scene.placementMirror, () => `preview-${id++}`),
        );
      }
      this.tintPlacement(this.strokeBlocked);
    }
    if (key === this.strokeKey) return;
    this.strokeKey = key;
    // These clones borrow the cursor template's resources.
    release(this.strokePreview);
    fillStrokePreview(
      { group: this.strokePreview, scene: this.props.scene, equipment: this.equipment, ghost: this.ghost, ghostMirror: this.ghostMirror },
      points,
      piece,
      drag?.start?.bearingDeg,
    );
  }

  /** Brass over the faces a sweep has crossed, as the cursor piece's ghost is for laid pieces. */
  private updateFacesPreview() {
    const faces = this.pointerStart?.faces,
      key = faces && this.pointerStart?.moved ? `${this.contentKey}|${[...faces].join('|')}` : '';
    if (key === this.facesKey) return;
    this.facesKey = key;
    release(this.facesPreview);
    if (!key) return;
    fillFacesPreview(this.facesPreview, faces!, this.surfacesByKey);
  }

  private boxRect(event: { clientX: number; clientY: number }) {
    return boxRect(this.renderer.domElement, this.pointerStart!, event);
  }

  private showBox(event?: { clientX: number; clientY: number }) {
    const visible = !!event && !!this.pointerStart?.box && !!this.pointerStart.moved;
    showSelectionBox(this.overlay, visible ? this.boxRect(event!) : undefined);
  }

  private project(point: THREE.Vector3): { x: number; y: number } | undefined {
    const projected = point.clone().project(this.camera);
    if (projected.z > 1 || !Number.isFinite(projected.x)) return undefined;
    return { x: ((projected.x + 1) / 2) * this.host.clientWidth, y: ((1 - projected.y) / 2) * this.host.clientHeight };
  }

  private placeTags() {
    placeTags({
      host: this.host,
      overlay: this.overlay,
      tags: this.props.tags,
      project: (point) => this.project(point),
      handles: this.rotateHandles.screenBounds ?? this.moveHandles.screenBounds,
    });
    // The readout sits under the palette: the ghost's cell while placing, the offset while moving a selection.
    const angle = this.pointerStart?.rotate?.degrees;
    showGestureFeedback(
      this.overlay,
      angle !== undefined
        ? `Rotate ${signedMetres(angle)}° · Shift fine · Esc cancel`
        : this.moveBlocked || this.placementBlocked
          ? OVERLAP_PREVIEW_NOTICE
          : '',
    );
    placeMeasure(
      this.overlay,
      this.measureLine,
      this.props.scene.measure,
      () => (this.hover ? this.pick(this.hover, 'hull')?.point : undefined),
      (point) => this.project(point),
    );
  }

  private movePick(event: PointerEvent): MoveDrag | undefined {
    if (this.props.scene.moveTargets === 'none') return undefined;
    return moveDrag(this.props.scene, this.pick(event, 'all'), this.camera);
  }

  private twinIds(ids: string[]): string[] {
    return twinIds(this.props.scene, ids);
  }

  private updateMoveHandles() {
    const props = this.props;
    const targets = moveHandleTargets(props.scene, this.controls.target);
    if (!targets) {
      this.moveHandles.update();
      return;
    }
    const { ids, selected, anchors, axes } = targets;
    const twins = this.twinIds(ids);
    const key = JSON.stringify([
      props.scene.source.id,
      props.scene.source.revision,
      ids,
      twins,
      props.scene.view,
      props.scene.perspective,
      props.scene.gridStep,
      props.scene.moveTargets,
      props.scene.pickTargets,
    ]);
    if (key !== this.moveConstraintKey) {
      this.moveConstraintKey = key;
      this.constrainMove = mirroredMoveConstraint(props.scene.source, selected, new Set(twins));
    }
    const anchor = anchors.reduce<Vec3>((sum, p) => sum.map((v, k) => v + p[k] / anchors.length) as Vec3, [0, 0, 0]);
    this.moveHandles.update({
      key,
      anchor,
      axes,
      unit: props.scene.gridStep,
      snap: (raw, free) => this.snap.move(ids, raw, free),
      constrain: this.constrainMove,
      preview: (delta, blocked) => {
        if (!delta) {
          this.finishMove();
          return;
        }
        this.moveOffset = delta;
        this.moveBlocked = !!blocked;
        if (blocked || !this.moveHandles.moving) this.snap.clear();
        if (!this.movePreview.children.length) buildMovePreview(this.moveView, ids, twins);
        positionMovePreview(this.moveView, delta);
        this.movePreview.visible = delta.some((v) => v !== 0);
      },
      commit: (delta) => props.onPointer({ kind: 'move', ids, delta }),
    });
  }

  private get moveView() {
    return { group: this.movePreview, scene: this.props.scene, equipment: this.equipment };
  }

  private updateMove(event: { clientX: number; clientY: number }) {
    const move = this.pointerStart?.move;
    if (!move) return;
    if (!move.built) {
      buildMovePreview(this.moveView, move.ids, move.twins);
      move.built = true;
      this.renderer.domElement.style.cursor = 'move';
    }
    const ray = pointerRay(event, this.renderer.domElement, this.camera);
    const point = ray.ray.intersectPlane(move.plane, new THREE.Vector3());
    if (point) {
      const raw = point.sub(move.origin);
      const requested = this.snap.move(move.ids, raw.toArray().map((v, k) => (move.free[k] ? v : 0)) as Vec3, move.free);
      const fitting = this.props.scene.source.construction.equipment.find((e) => move.ids.includes(e.id) && e.wall);
      if (fitting) {
        const n = wallNormal(fitting.bearingDeg),
          d = requested.reduce((sum, v, k) => sum + v * n[k], 0);
        for (let k = 0; k < 3; k++) requested[k] -= d * n[k];
      }
      move.delta = move.constrain(requested);
      this.moveBlocked = move.delta.some((v, k) => Math.abs(v - requested[k]) > 1e-7);
      if (this.moveBlocked) this.snap.clear();
    }
    positionMovePreview(this.moveView, move.delta);
    this.movePreview.visible = true;
  }

  private finishMove() {
    this.snap.clear();
    release(this.movePreview);
    this.movePreview.visible = false;
    this.moveOffset = undefined;
    this.moveBlocked = false;
    this.renderer.domElement.style.cursor = '';
  }

  /** A press that is not laying pieces hides the ghost and hover outline: box selection, the secondary button, a move or a camera drag. */
  private navigating() {
    const press = this.pointerStart;
    return !!press && !press.start && !press.faces && (press.box || press.button === 2 || press.moved);
  }
  private rotationPick(event: PointerEvent): RotationDrag | undefined {
    return rotationDrag(
      this.props.scene,
      () => this.pick(event, this.props.scene.pickTargets),
      event.clientX,
      this.ghost.visible ? this.ghostPosition : undefined,
    );
  }

  private previewRotation(rotation: RotationDrag, degrees: number) {
    previewRotation(this.props.scene, this.equipment.group, this.details, rotation, degrees);
  }
  private down = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 2) || this.pointerStart) return;
    this.renderer.domElement.focus({ preventScroll: true });
    this.hover = { clientX: event.clientX, clientY: event.clientY };
    this.updateGhost();
    const rotate = event.button === 2 ? this.rotationPick(event) : undefined;
    if (rotate) {
      this.controls.enabled = false;
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    const box = event.button === 0 && event.shiftKey;
    if (box) {
      // Finish OrbitControls' damped deltas without moving the visible camera.
      const position = this.camera.position.clone(),
        rotation = this.camera.quaternion.clone(),
        target = this.controls.target.clone();
      const damping = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = damping;
      this.camera.position.copy(position);
      this.camera.quaternion.copy(rotation);
      this.controls.target.copy(target);
      this.camera.updateMatrixWorld(true);
      this.controls.enabled = false;
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    const path = !box && event.button === 0 && this.props.scene.pathDraft ? this.pathPick(event) : undefined;
    if (path) {
      this.controls.enabled = false;
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    const move = !box && !this.props.scene.pathDraft && event.button === 0 ? this.movePick(event) : undefined;
    const start =
      !box && !move && event.button === 0 && this.props.scene.gesture !== 'none' && this.props.scene.placementPiece
        ? this.pick(event, 'hull')
        : undefined;
    // A press on a face with Paint or Opening begins a sweep: every face the drag crosses joins it, and release commits them as one edit.
    const face =
      !box && !move && !path && event.button === 0 && this.props.scene.gesture === 'faces'
        ? this.pick(event, this.props.scene.pickTargets)?.surface
        : undefined;
    // A press on the hull lays or moves pieces, so OrbitControls (which listens after this capture handler) must not orbit with the same drag; `up` and `cancel` re-enable it.
    if (start || move || face) this.controls.enabled = false;
    this.pointerStart = {
      id: event.pointerId,
      button: event.button,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      box,
      additive: event.ctrlKey || event.metaKey,
      start,
      rotate,
      move,
      points: start ? [start.placement] : [],
      faces: face ? new Set([face]) : undefined,
    };
    this.hover = { clientX: event.clientX, clientY: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.updateGhost();
    this.updateStrokePreview();
  };
  private move = (event: PointerEvent) => {
    this.hover = { clientX: event.clientX, clientY: event.clientY };
    this.updatePathPreview();
    this.updateGhost();
    this.highlight(event);
    if (!this.pointerStart && this.rowStart) this.updateStrokePreview();
    if (!this.pointerStart || event.pointerId !== this.pointerStart.id) return;
    this.pointerStart.moved ||= Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) >= 5;
    if (this.pointerStart.rotate) {
      const rotation = this.pointerStart.rotate;
      if (this.pointerStart.moved) {
        rotation.travelDegrees += (event.clientX - rotation.lastX) * (event.shiftKey ? 0.1 : 0.5);
        rotation.degrees = Number(rotation.travelDegrees.toFixed(1));
        rotation.lastX = event.clientX;
        this.previewRotation(rotation, rotation.degrees);
        this.updateGhost();
      }
      return;
    }
    if (this.pointerStart.box) {
      this.showBox(event);
      return;
    }
    if (this.pointerStart.move) {
      if (this.pointerStart.moved) this.updateMove(event);
      return;
    }
    if (this.pointerStart.faces) {
      const face = this.pointerStart.moved ? this.pick(event, this.props.scene.pickTargets)?.surface : undefined;
      if (face && this.pointerStart.faces.size < 4096) this.pointerStart.faces.add(face);
      this.updateFacesPreview();
      return;
    }
    const { start, points } = this.pointerStart,
      piece = this.props.scene.placementPiece;
    if (!start || !piece) return;
    if (this.props.scene.gesture === 'fill') {
      this.updateFillPreview();
      this.updateStrokePreview();
      return;
    }
    const hit = this.pick(event, 'hull');
    if (!hit) {
      this.updateStrokePreview();
      return;
    }
    if (piece.kind === 'equipment' && piece.wall) {
      if (
        start.bearingDeg === undefined ||
        hit.bearingDeg === undefined ||
        Math.cos(((start.bearingDeg - hit.bearingDeg) * Math.PI) / 180) < 0.7
      )
        return;
      this.pointerStart.points = piece.rowSpacing
        ? wallRow(start.placement, hit.placement, start.bearingDeg, piece.rowSpacing)
        : [hit.placement];
      this.updateStrokePreview();
      return;
    }
    const current = hit.placement,
      previous = points.at(-1) ?? current;
    for (const point of strokeSegment(previous, current, pieceExtents(start.hullPlacement ?? piece), start.axis)) {
      if (points.length >= 128) break;
      if (!points.some((existing) => same(existing, point))) points.push(point);
    }
    this.updateStrokePreview();
  };
  private up = (event: PointerEvent) => {
    if (event.button !== this.pointerStart?.button || event.pointerId !== this.pointerStart.id) return;
    const start = this.pointerStart,
      rect = start.box ? this.boxRect(event) : undefined;
    this.pointerStart = undefined;
    this.controls.enabled = true;
    this.fillPreview.visible = false;
    release(this.strokePreview);
    this.strokeKey = '';
    this.updateFacesPreview();
    this.showBox();
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    const clicked = !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5;
    const piece = this.props.scene.placementPiece;
    if (start.rotate && !clicked) {
      this.previewRotation(start.rotate, 0);
      if (Math.abs(start.rotate.degrees % 360) > 1e-6)
        this.props.onPointer({ kind: 'rotate', ids: start.rotate.ids, degrees: start.rotate.degrees });
      this.updateGhost();
    } else if (start.button === 2 && clicked && this.pendingRow()) {
      this.rowStart = undefined;
      this.updateStrokePreview();
    } else if (start.button === 2) {
      // Right button only pans, rotates or cancels a pending row; removal is the Erase tool or Delete.
    } else if (this.props.scene.pathDraft && !rect) {
      const point = this.pathPick(event);
      if (clicked && point)
        this.props.onPointer({ kind: 'path-point', point, bearingDeg: wallBearing(this.pick(event, 'hull')?.normal ?? [0, 0, -1]) });
    } else if (rect) {
      if (clicked) {
        const hit = this.pick(event, 'all');
        this.props.onPointer({ kind: 'box', ids: hit?.id ? [hit.id] : [], additive: true });
      } else
        this.props.onPointer({
          kind: 'box',
          ids: boxSelectedPieces(
            this.props.scene.source,
            this.props.scene.catalog,
            this.camera,
            rect,
            this.host.clientWidth,
            this.host.clientHeight,
            this.props.scene.rooms,
          ),
          additive: start.additive,
        });
    } else if (start.move) {
      const moved = start.moved && start.move.delta.some((value) => Math.abs(value) > 1e-6);
      this.finishMove();
      if (moved) this.props.onPointer({ kind: 'move', ids: start.move.ids, delta: start.move.delta });
      else if (clicked) this.props.onPointer({ kind: 'pick', hit: this.pick(event, 'all') });
    } else if (start.start && piece) {
      const hit = this.pick(event, 'hull');
      const row = this.pendingRow();
      if (piece.kind === 'equipment' && piece.rowSpacing && (clicked || row)) {
        // Click once for the first window and again for the last; a plain drag still lays a row in one gesture.
        if (!row) {
          this.rowStart = { pick: start.start, partId: piece.partId };
          this.updateStrokePreview();
          return;
        }
        if (
          !hit ||
          row.bearingDeg === undefined ||
          hit.bearingDeg === undefined ||
          Math.cos(((row.bearingDeg - hit.bearingDeg) * Math.PI) / 180) < 0.7
        ) {
          this.updateStrokePreview();
          return;
        }
        this.rowStart = undefined;
        this.props.onPointer({
          kind: 'lay',
          points: wallRow(row.placement, hit.placement, row.bearingDeg, piece.rowSpacing),
          bearingDeg: row.bearingDeg,
        });
        return;
      }
      if (
        !hit ||
        (piece.kind === 'equipment' &&
          piece.wall &&
          Math.cos((((start.start.bearingDeg ?? 0) - (hit.bearingDeg ?? 0)) * Math.PI) / 180) < 0.7)
      )
        return;
      if (this.props.scene.gesture === 'fill')
        this.props.onPointer({
          kind: 'lay',
          hullPlacement: start.start.hullPlacement,
          points: fillLattice(
            start.start.placement,
            clicked ? start.start.placement : hit.placement,
            pieceExtents(start.start.hullPlacement ?? piece),
            start.start.axis,
          ),
        });
      else
        this.props.onPointer({
          kind: 'lay',
          hullPlacement: start.start.hullPlacement,
          points: clicked ? [start.start.placement] : start.points,
          bearingDeg: start.start.bearingDeg,
        });
    } else if (start.faces && !clicked) this.props.onPointer({ kind: 'faces', surfaces: [...start.faces] });
    else if (clicked)
      this.props.onPointer({
        kind: 'pick',
        hit: this.pick(event, this.props.scene.placementPiece ? 'hull' : this.props.scene.pickTargets),
      });
  };
  private pathPick(event: { clientX: number; clientY: number }): Vec3 | undefined {
    const { point, axis } = pathPoint(
      this.props.scene,
      (targets) => this.pick(event, targets),
      (context, raw, grid, directions, moving) => this.snap.resolve(context, raw, grid, directions, moving, new Set()),
    );
    if (axis !== undefined) this.snap.workingAxis = axis;
    return point;
  }
  private updatePathPreview() {
    const draft = this.props.scene.pathDraft;
    const point = draft && this.hover && !this.navigating() ? this.pathPick(this.hover) : undefined;
    const points = draft ? (point ? appendPathPoint(draft.points, point) : draft.points) : [];
    const key = JSON.stringify([draft?.part.id, points, draft?.slackM, draft?.mirror, draft?.bearingDeg, draft?.heightM, draft?.railCount]);
    if (key === this.pathPreviewKey) return;
    this.pathPreviewKey = key;
    release(this.pathPreview);
    if (!draft || !points.length) return;
    fillPathPreview(this.pathPreview, draft, points, this.props.scene.result?.surfaces ?? []);
  }
  private contextMenu = (event: MouseEvent) => event.preventDefault();
  private finishPath = (event: MouseEvent) => {
    if (this.props.scene.pathDraft) {
      event.preventDefault();
      this.props.onPointer({ kind: 'path-finish' });
    }
  };
  private leave = () => {
    this.snap.clear();
    this.showArmorTooltip();
    this.reportHover();
    this.hover = undefined;
    this.updatePathPreview();
    this.ghost.visible = false;
    this.ghostMirror.visible = false;
    this.ghostArc.visible = false;
    this.ghostPosition = undefined;
    release(this.hoverGroup);
    this.hoverSurface = '';
  };
  private cancel = () => {
    const pointer = this.pointerStart;
    this.pointerStart = undefined;
    this.controls.enabled = true;
    if (pointer?.rotate) this.previewRotation(pointer.rotate, 0);
    if (pointer && this.renderer.domElement.hasPointerCapture(pointer.id)) this.renderer.domElement.releasePointerCapture(pointer.id);
    this.fillPreview.visible = false;
    release(this.strokePreview);
    this.strokeKey = '';
    this.updateFacesPreview();
    this.showBox();
    this.finishMove();
    this.leave();
  };
  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && (this.pointerStart || this.rowStart)) {
      this.rowStart = undefined;
      this.cancel();
    }
  };
  private animate = () => {
    if (this.dead) return;
    if (!this.freeformHandles.dragging && !this.moveHandles.dragging && !this.rotateHandles.dragging && !this.pointerStart?.rotate)
      this.controls.update();
    if (this.hover) {
      if (this.props.scene.placementPiece) this.updateGhost();
      this.highlight(this.hover);
    }
    this.floorGrid.visible = this.camera.position.y > (this.floorGrid.children[0]?.position.y ?? 0);
    this.snap.draw();
    this.freeformHandles.frame();
    this.moveHandles.frame();
    this.rotateHandles.frame();
    this.renderer.render(this.scene, this.camera);
    this.placeTags();
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
    this.snap.dispose();
    this.freeformHandles.dispose();
    this.moveHandles.dispose();
    this.rotateHandles.dispose();
    this.dead = true;
    cancelAnimationFrame(this.frame);
    this.modelAbort?.abort();
    this.resize.disconnect();
    this.controls.dispose();
    release(this.strokePreview);
    this.equipment.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.down, true);
    canvas.removeEventListener('pointermove', this.move);
    canvas.removeEventListener('pointerup', this.up);
    canvas.removeEventListener('contextmenu', this.contextMenu);
    canvas.removeEventListener('dblclick', this.finishPath);
    canvas.removeEventListener('pointercancel', this.cancel);
    canvas.removeEventListener('pointerleave', this.leave);
    canvas.removeEventListener('lostpointercapture', this.cancel);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('blur', this.cancel);
    release(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }
}

export function BuilderViewport(props: ViewportProps) {
  const host = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLDivElement>(null),
    viewport = useRef<Viewport | undefined>(undefined);
  const orientation = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      viewport.current = new Viewport(host.current!, overlay.current!, orientation.current!, props, setError);
    } catch (error) {
      setError(
        `The 3D view could not start: ${error instanceof Error ? error.message : String(error)}. Your source remains editable and saveable.`,
      );
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = undefined;
    };
  }, []);
  useEffect(() => {
    viewport.current?.update(props);
  }, [props]);
  useEffect(() => {
    if (!props.onMemory) return;
    let previous = '';
    const sample = () => {
      if (!viewport.current) return;
      const memory = viewport.current.measureMemory(),
        signature = JSON.stringify(memory);
      if (signature !== previous) {
        previous = signature;
        props.onMemory?.(memory);
      }
    };
    sample();
    const timer = window.setInterval(sample, 1500);
    return () => window.clearInterval(timer);
  }, [props.onMemory]);
  return (
    <div className="sb-viewport" aria-label="Ship construction viewport">
      <div ref={host} className="sb-canvas" />
      <div ref={overlay} className="sb-overlay">
        <svg className="sb-leaders" aria-hidden="true" />
        {props.tags.map((tag) => (
          <div
            key={tag.key}
            data-tag={tag.key}
            className={`sb-tag ${tag.tone}`}
            style={tag.passive ? { pointerEvents: 'none' } : undefined}
          >
            {tag.content}
          </div>
        ))}
        <div className="sb-cursor">
          {props.status}
          <span data-gesture-feedback className="sb-gesture-feedback" hidden />
        </div>
        <div data-armor-tooltip role="tooltip" className="sb-tag brass sb-armor-tooltip" hidden>
          <b />
          <span />
        </div>
        <div data-measure className="sb-tag mint" />
        <div data-selection-box className="sb-selection-box" hidden aria-hidden="true" />
      </div>
      <BuilderOrientation elementRef={orientation} />
      {error && (
        <p role="alert" className="sb-view-error">
          {error}
        </p>
      )}
    </div>
  );
}

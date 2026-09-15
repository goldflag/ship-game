import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { armorThicknessColor } from '../../ships/inspection';
import { surfaceKey } from '../../ships/constructionEditor';
import { constructionPaintColor } from './paints';
import { snapCoordinate } from './editorNumbers';
import { dominantAxis, fillLattice, pieceExtents, placementCenter, strokeSegment } from './placement';
import { primitiveGeometry, placementGeometry, placementRotation, type BuilderPlacement } from './primitiveGeometry';
import { createConstructionHull } from '../../game/constructionModel';
import { EquipmentPreview } from './equipmentPreview';
import { boxSelectedPieces } from './boxSelection';
import { BuilderOrientation, updateBuilderOrientation } from './BuilderOrientation';

export type BuilderView = 'orbit' | 'top' | 'side' | 'bow';
export type BuilderDisplay = 'paint' | 'armor' | 'internals';
/** How the primary button behaves: a click picks, a stroke lays a run of pieces, fill covers a rectangle. */
export type BuilderGesture = 'none' | 'stroke' | 'fill';
export interface BuilderPick { id?: string; surface?: string; point: Vec3; normal?: Vec3; axis: 0 | 1 | 2; placement: Vec3; additive: boolean }
export interface BuilderArc { position: Vec3; bearingDeg: number; traverseDeg: number; radius: number; color: string }
export interface BuilderTag { key: string; anchor: Vec3; dx: number; dy: number; tone: 'mint' | 'brass' | 'bad'; content: ReactNode }
export interface BuilderProposal { position: Vec3; bearingDeg: number; size: Vec3; boundsCenter: Vec3 }
/** What a primary drag may move: nothing, fittings only (while placing fittings), or pieces, fittings and walls. */
export type BuilderMoveTargets = 'none' | 'equipment' | 'all';
export type ConstructionModelFactory = (source: ConstructionSource, result: ConstructionResult, signal: AbortSignal) => Promise<THREE.Group>;
export interface ViewportProps {
  source: ConstructionSource; result?: ConstructionResult; catalog: ConstructionCatalog;
  selected: ReadonlySet<string>; selectedSurfaces: ReadonlySet<string>;
  view: BuilderView; display: BuilderDisplay; slice?: number;
  gridStep: number; gesture: BuilderGesture;
  /** What a click may select: hull faces only (armor, paint) or fittings and walls too. */
  pickTargets: 'hull' | 'all';
  moveTargets: BuilderMoveTargets;
  placementPiece?: BuilderPlacement; placementMirror?: BuilderPlacement;
  highlightFaces: boolean; rooms: boolean; showCenters: boolean;
  arcs: BuilderArc[]; proposed: BuilderProposal[];
  measure?: { from: Vec3; to?: Vec3 };
  tags: BuilderTag[]; coords(position: Vec3): string;
  /** The cursor piece readout under the palette; the coordinates readout follows it. */
  status?: ReactNode;
  fitRequest: number;
  onPick(pick?: BuilderPick): void; onStroke(points: Vec3[]): void;
  onBoxSelect(ids: string[], additive: boolean): void; onErase(id: string): void;
  onMove(ids: string[], delta: Vec3): void;
  createModel?: ConstructionModelFactory;
}
/** A primary drag that began on a piece: the pieces it carries, the plane it slides in and the snapped offset so far. */
interface MoveDrag { ids: string[]; plane: THREE.Plane; origin: THREE.Vector3; free: [boolean, boolean, boolean]; step: number; delta: Vec3; built: boolean }

const BRASS = '#e0c58d', BRASS_LIGHT = '#efd5a0', MINT = '#86e4c5', READY = '#94d9bf', SALMON = '#ffb5a6', IVORY = '#edf1ec', ROOM = '#9cc3ff';
const LEADER: Record<BuilderTag['tone'], string> = { mint: MINT, brass: BRASS, bad: SALMON };

function release(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(child => {
    if (child.userData.sharedPreviewResources) return;
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
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-50, 50, 35, -35, .1, 6000);
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
  private modelAbort?: AbortController;
  private pointerStart?: { id: number; button: number; x: number; y: number; moved: boolean; box: boolean; additive: boolean; start?: BuilderPick; move?: MoveDrag; points: Vec3[] };
  private hover?: { clientX: number; clientY: number };
  private ghostPosition?: Vec3;
  private currentView: BuilderView = 'orbit';
  private modelError: (message: string) => void;
  private orientationRotation = new THREE.Quaternion(0, 0, 0, 0);

  constructor(private host: HTMLDivElement, private overlay: HTMLDivElement, private orientation: HTMLDivElement, props: ViewportProps, modelError: (message: string) => void) {
    this.props = props; this.modelError = modelError;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
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
    this.scene.add(this.hull, this.details, this.selection, this.hoverGroup, this.composed, this.equipment.group, this.arcGroup, this.proposedGroup, this.ghost, this.ghostMirror, this.ghostArc, this.fillPreview, this.strokePreview, this.movePreview, this.measureGroup);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .15;
    this.controls.minZoom = .08; this.controls.maxZoom = 100; this.controls.maxPolarAngle = Math.PI * .95;
    this.camera.position.set(65, 45, -75); this.controls.update();
    this.resize = new ResizeObserver(() => this.measure()); this.resize.observe(host); this.measure();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.down, true); canvas.addEventListener('pointermove', this.move); canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel); canvas.addEventListener('pointerleave', this.leave);
    canvas.addEventListener('lostpointercapture', this.cancel); window.addEventListener('keydown', this.key);
    window.addEventListener('blur', this.cancel);
    if (import.meta.env.DEV) (window as unknown as { shipbuilderViewport?: Viewport }).shipbuilderViewport = this;
    this.update(props); this.fit(); this.animate();
  }

  private measure() {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.span = this.fitExtent / Math.min(1, width / height);
    this.renderer.setSize(width, height); this.camera.left = -this.span * width / height / 2; this.camera.right = -this.camera.left;
    this.camera.top = this.span / 2; this.camera.bottom = -this.camera.top; this.camera.updateProjectionMatrix();
  }

  fit() {
    const bounds = new THREE.Box3();
    // Source bounds remain available before compilation and for invalid drafts.
    for (const primitive of this.props.source.construction.primitives) {
      const rotation = new THREE.Euler(0, primitive.rotationDeg * Math.PI / 180, 0);
      for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) bounds.expandByPoint(new THREE.Vector3(x * primitive.size[0], y * primitive.size[1], z * primitive.size[2]).applyEuler(rotation).add(new THREE.Vector3(...primitive.position)));
    }
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-10, -5, -25), new THREE.Vector3(10, 5, 25));
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    this.hullSize.copy(size);
    const view = this.props.view, aspect = Math.max(1, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    // Frame the ship for the chosen view: plan and profile need the length upright, the bow view only the section.
    const framed = view === 'top' ? Math.max(size.z, size.x * aspect) : view === 'side' ? Math.max(size.z, size.y * aspect) : view === 'bow' ? Math.max(size.x, size.y * aspect) : size.length() * .95;
    this.fitExtent = Math.max(15, framed * 1.12);
    this.controls.target.copy(center); this.camera.zoom = 1;
    this.measure(); this.setView(view); this.ghostKey = '';
  }

  private setView(view: BuilderView) {
    const direction = view === 'top' ? [0, 1, .0001] : view === 'side' ? [1, 0, 0] : view === 'bow' ? [0, 0, -1] : [1, .7, -1.15];
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(Math.max(200, this.span * 3)));
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.controls.target); this.controls.enableRotate = view === 'orbit'; this.controls.update(); this.currentView = view;
  }

  update(props: ViewportProps) {
    const old = this.props; this.props = props;
    if (props.source.id !== old.source.id || props.gesture !== old.gesture || props.placementPiece !== old.placementPiece || props.moveTargets !== old.moveTargets) this.cancel();
    if (props.view !== this.currentView || props.fitRequest !== old.fitRequest || props.source.id !== old.source.id || (!old.result && props.result)) this.fit();
    // The primary button orbits (pans in construction views) and the secondary button pans. A primary press on the hull while placing lays pieces instead; `down` holds the controls for that drag.
    this.controls.mouseButtons = { LEFT: props.view === 'orbit' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    const nativeSurfaces = props.result?.sourceId === props.source.id && props.result.revision === props.source.revision && props.result.surfaces.length ? props.result.surfaces : undefined;
    const key = `${props.source.id}:${nativeSurfaces ? props.result!.contentHash : props.source.revision + ':draft'}:${props.display}`;
    if (key !== this.contentKey) {
      this.contentKey = key; release(this.hull); this.surfaceTriangles = []; this.pickMeshes = []; this.hullMeshes = [];
      const vertices: number[] = [], colors: number[] = [];
      for (const surface of nativeSurfaces ?? []) {
        if (surface.open && props.display === 'paint') continue;
        const color = new THREE.Color(props.display === 'armor' ? armorThicknessColor(surface.thicknessMm) : constructionPaintColor(surface.paint));
        fan(surface, vertices, colors, color);
        for (let i = 1; i < surface.vertices.length - 1; i++) this.surfaceTriangles.push(surface);
      }
      if (nativeSurfaces) {
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: 0, side: THREE.DoubleSide, transparent: props.display === 'internals', opacity: props.display === 'internals' ? .15 : 1, depthWrite: props.display !== 'internals' }));
        mesh.userData.hull = true; this.hull.add(mesh); this.pickMeshes.push(mesh); this.hullMeshes.push(mesh);
      } else for (const primitive of props.source.construction.primitives) {
        const mesh = new THREE.Mesh(primitiveGeometry(primitive.kind, primitive.size), new THREE.MeshStandardMaterial({ color: constructionPaintColor('naval-gray'), roughness: .78, side: THREE.DoubleSide, transparent: props.display === 'internals', opacity: props.display === 'internals' ? .15 : 1 }));
        mesh.position.set(...primitive.position); mesh.rotation.y = primitive.rotationDeg * Math.PI / 180;
        mesh.userData.sourceId = primitive.id; this.hull.add(mesh); this.pickMeshes.push(mesh); this.hullMeshes.push(mesh);
      }
      this.hoverSurface = ''; release(this.hoverGroup);
    }
    this.equipment.update(props.source, props.catalog);
    const modelKey = `${props.source.id}:${props.source.revision}:${props.result?.contentHash}`;
    if (modelKey !== this.modelKey) {
      this.modelKey = modelKey; this.modelAbort?.abort(); release(this.composed);
      if (props.result && nativeSurfaces) {
        const abort = new AbortController(); this.modelAbort = abort;
        const model = props.createModel ? props.createModel(props.source, props.result, abort.signal) : Promise.resolve(createConstructionHull(nativeSurfaces));
        model.then(group => {
          if (this.dead || abort.signal.aborted || modelKey !== this.modelKey) { release(group); return; }
          this.composed.add(group); this.update(this.props); this.modelError('');
        }).catch(error => { if (!abort.signal.aborted && !this.dead) this.modelError(`Equipment preview: ${error instanceof Error ? error.message : String(error)}`); });
      }
    }
    this.composed.visible = props.display === 'paint' && !!nativeSurfaces;
    this.equipment.group.visible = !(props.createModel && this.composed.visible && this.composed.children.length);
    // Native surfaces remain the pick target even when shared composition renders the exterior.
    this.hull.visible = !this.composed.visible || !this.composed.children.length;
    release(this.details); release(this.selection);
    this.pickMeshes = this.pickMeshes.filter(mesh => mesh.parent === this.hull);
    this.equipment.group.traverse(node => { if (node instanceof THREE.Mesh) this.pickMeshes.push(node); });
    if (!nativeSurfaces) for (const object of this.hull.children) {
      const mesh = object as THREE.Mesh;
      if (!props.selected.has(mesh.userData.sourceId)) continue;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }));
      edges.position.copy(mesh.position); edges.rotation.copy(mesh.rotation); this.selection.add(edges);
    }
    for (const part of props.source.construction.equipment) {
      const entry = props.catalog.equipment.find(entry => entry.id === part.partId);
      if (!entry) continue;
      const box = new THREE.Mesh(new THREE.BoxGeometry(...entry.size), new THREE.MeshBasicMaterial({ color: props.selected.has(part.id) ? BRASS : entry.placement === 'internal' ? READY : '#bacbd0', wireframe: true, transparent: true, opacity: props.selected.has(part.id) ? 1 : .55 }));
      const datum = new THREE.Group(); datum.position.set(...part.position); datum.rotation.y = -part.bearingDeg * Math.PI / 180; box.position.set(...entry.boundsCenter);
      box.userData.sourceId = part.id; datum.add(box); this.details.add(datum);
      if (!this.equipment.has(part.id)) this.pickMeshes.push(box);
      datum.visible = props.display === 'internals' || props.selected.has(part.id) || (!this.equipment.has(part.id) && !(props.createModel && this.composed.children.length));
    }
    for (const wall of props.source.construction.boundaries) {
      const size: Vec3 = [this.hullSize.x + 2, this.hullSize.y + 2, this.hullSize.z + 2]; const axis = { x: 0, y: 1, z: 2 }[wall.axis]; size[axis] = Math.max(.04, wall.thicknessMm / 1000);
      const box = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: props.selected.has(wall.id) ? .3 : .09, depthWrite: false }));
      box.position.copy(this.controls.target); box.position.setComponent(axis, wall.offset); box.userData.sourceId = wall.id; box.visible = props.display === 'internals' || props.selected.has(wall.id); this.details.add(box); if (box.visible) this.pickMeshes.push(box);
    }
    if (props.rooms) for (const room of props.result?.definition?.compartments ?? []) {
      const geometry = new THREE.BoxGeometry(...room.size);
      const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: ROOM, transparent: true, opacity: .09, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: ROOM, transparent: true, opacity: .4 }));
      fill.position.set(...room.center); edges.position.set(...room.center); this.details.add(fill, edges);
    }
    for (const surface of nativeSurfaces ?? []) {
      const chosen = props.selectedSurfaces.has(surfaceKey(surface.primitiveId, surface.face));
      if (!chosen && !props.selected.has(surface.primitiveId)) continue;
      const points = surface.vertices.map(vertex => new THREE.Vector3(...vertex).addScaledVector(new THREE.Vector3(...surface.normal), .025));
      points.push(points[0].clone());
      this.selection.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false })));
      if (chosen && props.display === 'armor' && !surface.open) {
        const lines: THREE.Vector3[] = [];
        for (let i = 0; i < surface.vertices.length; i++) {
          const outer = new THREE.Vector3(...surface.vertices[i]); const inner = outer.clone().addScaledVector(new THREE.Vector3(...surface.normal), -surface.thicknessMm / 1000);
          const next = new THREE.Vector3(...surface.vertices[(i + 1) % surface.vertices.length]).addScaledVector(new THREE.Vector3(...surface.normal), -surface.thicknessMm / 1000);
          lines.push(outer, inner, inner, next);
        }
        this.selection.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: READY, depthTest: false })));
      }
    }
    const loading = props.result?.loading;
    if (props.showCenters && loading) for (const [point, color] of [[loading.centerOfGravity, BRASS], [loading.buoyancyCenter, READY]] as const) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(.25, this.span / 140), 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      marker.position.set(...point); marker.renderOrder = 10; this.details.add(marker);
    }
    const arcKey = JSON.stringify(props.arcs);
    if (arcKey !== this.arcKey) {
      this.arcKey = arcKey; release(this.arcGroup);
      for (const arc of props.arcs) { const mesh = arcMesh(arc); mesh.position.set(arc.position[0], arc.position[1] + .08, arc.position[2]); this.arcGroup.add(mesh); }
    }
    const proposedKey = JSON.stringify(props.proposed);
    if (proposedKey !== this.proposedKey) {
      this.proposedKey = proposedKey; release(this.proposedGroup);
      for (const item of props.proposed) {
        const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...item.size)), new THREE.LineDashedMaterial({ color: MINT, dashSize: .6, gapSize: .3, depthTest: false }));
        box.computeLineDistances(); box.position.set(...item.boundsCenter);
        const datum = new THREE.Group(); datum.position.set(...item.position); datum.rotation.y = -item.bearingDeg * Math.PI / 180; datum.add(box); this.proposedGroup.add(datum);
      }
    }
    if (props.highlightFaces !== old.highlightFaces || props.slice !== old.slice || props.pickTargets !== old.pickTargets) { release(this.hoverGroup); this.hoverSurface = ''; }
    this.measureGroup.visible = !!props.measure;
    this.updateGhost(); this.updateStrokePreview(); if (this.hover) this.highlight(this.hover); this.applyClip();
  }

  private updateGhost() {
    const piece = this.props.placementPiece, key = JSON.stringify([piece, this.props.placementMirror, this.hullSize.toArray().map(Math.round)]);
    if (key !== this.ghostKey) {
      this.strokeKey = ''; this.strokePreview.clear();
      this.ghostKey = key; release(this.ghost); release(this.ghostMirror); release(this.ghostArc);
      if (piece) {
        const build = (item: BuilderPlacement, group: THREE.Group, opacity: number) => {
          const equipment = item.kind === 'equipment' && item.partId ? this.equipment.clone(item.partId, true) : undefined;
          if (equipment) { group.add(equipment); group.rotation.y = placementRotation(item); return; }
          const geometry = placementGeometry(item, item.kind === 'boundary' ? [this.hullSize.x + 2, this.hullSize.y + 2, this.hullSize.z + 2] : undefined);
          const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity, depthWrite: false, depthTest: item.kind === 'boundary' }));
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false, transparent: true, opacity: opacity * 3.6 }));
          fill.renderOrder = 20; edges.renderOrder = 21; group.add(fill, edges); group.rotation.y = placementRotation(item);
        };
        build(piece, this.ghost, piece.kind === 'boundary' ? .12 : .25);
        if (this.props.placementMirror) build(this.props.placementMirror, this.ghostMirror, .12);
        if (piece.kind === 'equipment' && piece.arc) this.ghostArc.add(arcMesh({ bearingDeg: piece.bearingDeg, traverseDeg: piece.arc.traverseDeg, radius: piece.arc.radius, color: BRASS }));
      }
    }
    const pick = this.hover ? this.pick(this.hover, 'hull') : undefined;
    const visible = !!piece && !!pick && !this.navigating();
    this.ghost.visible = visible;
    if (!visible) { this.ghostMirror.visible = false; this.ghostArc.visible = false; this.ghostPosition = undefined; return; }
    const position = [...pick!.placement] as Vec3;
    if (piece!.kind === 'boundary') {
      const axis = { x: 0, y: 1, z: 2 }[piece!.axis];
      for (let index = 0; index < 3; index++) if (index !== axis) position[index] = this.controls.target.getComponent(index);
    }
    this.ghostPosition = pick!.placement; this.ghost.position.set(...position);
    this.ghostMirror.visible = !!this.props.placementMirror && Math.abs(position[0]) > 1e-6;
    if (this.ghostMirror.visible) this.ghostMirror.position.set(-position[0], position[1], position[2]);
    this.ghostArc.visible = this.ghostArc.children.length > 0;
    if (this.ghostArc.visible) this.ghostArc.position.set(position[0], position[1] + .08, position[2]);
  }

  private applyClip() {
    const planes = this.props.slice === undefined ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), this.props.slice)];
    for (const group of [this.hull, this.details, this.composed, this.equipment.group, this.selection, this.hoverGroup, this.movePreview]) group.traverse(child => {
      const mesh = child as THREE.Mesh;
      for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) { material.clippingPlanes = planes; material.needsUpdate = true; }
    });
  }

  /** Empty space is never a placement or selection surface. */
  private pick(event: { clientX: number; clientY: number; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }, targets: 'hull' | 'all'): BuilderPick | undefined {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    const hit = ray.intersectObjects(targets === 'hull' ? this.hullMeshes : this.pickMeshes, false).find(hit => this.props.slice === undefined || hit.point.y <= this.props.slice + 1e-6);
    if (!hit) return undefined;
    const surface = hit.object.userData.hull ? this.surfaceTriangles[hit.faceIndex ?? -1] : undefined;
    const facing = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : ray.ray.direction.clone().negate();
    if (facing.dot(ray.ray.direction) > 0) facing.negate();
    const normal = facing.toArray() as Vec3, axis = dominantAxis(normal), raw = hit.point.toArray() as Vec3;
    const supportId = surface?.primitiveId.startsWith('equipment:') ? surface.primitiveId.slice('equipment:'.length) : undefined;
    const id = supportId && this.props.source.construction.equipment.some(item => item.id === supportId) ? supportId : surface?.primitiveId ?? hit.object.userData.sourceId;
    const primitive = this.props.source.construction.primitives.find(part => part.id === id), piece = this.props.placementPiece;
    const extents = primitive && pieceExtents({ kind: 'hull', shape: primitive.kind, size: primitive.size, rotationDeg: primitive.rotationDeg });
    const snapOrigin = primitive && extents ? primitive.position.map((value, index) => value - extents[index] / 2) as Vec3 : undefined;
    const placement = piece ? placementCenter(piece, { point: raw, normal, snapOrigin }, this.props.gridStep) : raw.map(value => snapCoordinate(value, this.props.gridStep)) as Vec3;
    return { id, surface: surface && surfaceKey(surface.primitiveId, surface.face), point: raw, normal, axis, placement, additive: !!(event.shiftKey || event.ctrlKey || event.metaKey) };
  }

  private highlight(event: { clientX: number; clientY: number }) {
    const pick = this.navigating() ? undefined : this.pick(event, this.props.pickTargets);
    const key = this.props.highlightFaces ? pick?.surface ?? '' : pick?.id ?? '';
    if (key === this.hoverSurface) return;
    this.hoverSurface = key; release(this.hoverGroup);
    if (!key) return;
    const material = () => new THREE.LineBasicMaterial({ color: IVORY, depthTest: false, transparent: true, opacity: .95,
      clippingPlanes: this.props.slice === undefined ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), this.props.slice)] });
    const primitive = this.props.source.construction.primitives.find(part => part.id === pick?.id);
    if (primitive && !this.props.highlightFaces) {
      const geometry = primitiveGeometry(primitive.kind, primitive.size);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material()); geometry.dispose();
      edges.position.set(...primitive.position); edges.rotation.y = primitive.rotationDeg * Math.PI / 180;
      edges.renderOrder = 25; this.hoverGroup.add(edges);
      return;
    }
    for (const surface of this.props.result?.surfaces ?? []) {
      if (this.props.highlightFaces ? surfaceKey(surface.primitiveId, surface.face) !== key : surface.primitiveId !== key) continue;
      const points = surface.vertices.map(vertex => new THREE.Vector3(...vertex).addScaledVector(new THREE.Vector3(...surface.normal), .03));
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material());
      outline.renderOrder = 25; this.hoverGroup.add(outline);
    }
  }

  private updateFillPreview() {
    const start = this.pointerStart?.start, piece = this.props.placementPiece;
    if (!start || !piece || this.props.gesture !== 'fill' || !this.hover) { this.fillPreview.visible = false; return; }
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
    const drag = this.pointerStart, piece = this.props.placementPiece;
    const hit = this.hover ? this.pick(this.hover, 'hull') : undefined;
    const points = drag?.start && piece && hit
      ? this.props.gesture === 'fill' ? fillLattice(drag.start.placement, hit.placement, pieceExtents(piece), drag.start.axis) : drag.points
      : [];
    const key = JSON.stringify([this.ghostKey, points]);
    if (key === this.strokeKey) return;
    this.strokeKey = key;
    // These clones borrow the cursor template's resources.
    this.strokePreview.clear();
    for (const point of points) {
      const instance = this.ghost.clone(true); instance.position.set(...point); instance.visible = true; instance.userData.placementPreview = false;
      this.strokePreview.add(instance);
      if (this.props.placementMirror && Math.abs(point[0]) > 1e-6) {
        const twin = this.ghostMirror.clone(true); twin.position.set(-point[0], point[1], point[2]); twin.visible = true;
        this.strokePreview.add(twin);
      }
    }
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
    let leaders = '';
    for (const tag of this.props.tags) {
      const element = this.overlay.querySelector<HTMLElement>(`[data-tag="${CSS.escape(tag.key)}"]`);
      if (!element) continue;
      const screen = this.project(new THREE.Vector3(...tag.anchor));
      if (!screen) { element.style.visibility = 'hidden'; continue; }
      const x = clamp(screen.x + tag.dx, 8, Math.max(8, width - element.offsetWidth - 8)), y = clamp(screen.y + tag.dy, 60, Math.max(60, height - element.offsetHeight - 90));
      element.style.visibility = 'visible'; element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const endX = tag.dx >= 0 ? x : x + element.offsetWidth, endY = y + element.offsetHeight / 2;
      leaders += `<line x1="${screen.x.toFixed(1)}" y1="${screen.y.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="${LEADER[tag.tone]}"/><circle cx="${screen.x.toFixed(1)}" cy="${screen.y.toFixed(1)}" r="2.5" fill="${LEADER[tag.tone]}"/>`;
    }
    // The readout sits under the palette: the ghost's cell while placing, the offset while moving a selection.
    const coords = this.overlay.querySelector<HTMLElement>('[data-coords]'), move = this.pointerStart?.move;
    if (coords) {
      if (move?.built) { coords.textContent = `Δx ${signedMetres(move.delta[0])} · Δy ${signedMetres(move.delta[1])} · Δz ${signedMetres(move.delta[2])}`; coords.style.visibility = 'visible'; }
      else if (this.ghost.visible && this.ghostPosition) { coords.textContent = this.props.coords(this.ghostPosition); coords.style.visibility = 'visible'; }
      else coords.style.visibility = 'hidden';
    }
    const measure = this.overlay.querySelector<HTMLElement>('[data-measure]');
    if (measure) {
      const from = this.props.measure?.from, to = this.props.measure?.to ?? (from && this.hover ? this.pick(this.hover, 'hull')?.point : undefined);
      if (from && to) {
        const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
        this.measureLine.geometry.setFromPoints([a, b]);
        const middle = this.project(a.clone().add(b).multiplyScalar(.5));
        const delta = to.map((value, index) => value - from[index]);
        if (middle) {
          measure.innerHTML = `<b>${a.distanceTo(b).toFixed(2)} m</b>Δx ${delta[0].toFixed(2)} · Δy ${delta[1].toFixed(2)} · Δz ${delta[2].toFixed(2)}${this.props.measure?.to ? '' : ' · click to end'}`;
          measure.style.visibility = 'visible'; measure.style.transform = `translate(${(middle.x + 14).toFixed(1)}px, ${(middle.y - 30).toFixed(1)}px)`;
        }
      } else measure.style.visibility = 'hidden';
    }
    const svg = this.overlay.querySelector('svg');
    if (svg) { svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.innerHTML = leaders; }
  }

  /** A primary press on a piece, fitting or wall begins a move instead of a camera drag. The pressed
   * piece carries the whole selection when it belongs to it, otherwise it moves alone. */
  private movePick(event: PointerEvent): MoveDrag | undefined {
    const targets = this.props.moveTargets;
    if (targets === 'none') return undefined;
    const hit = this.pick(event, 'all');
    if (!hit?.id) return undefined;
    const { primitives, equipment, boundaries } = this.props.source.construction;
    const isPrimitive = (id: string) => primitives.some(part => part.id === id), isEquipment = (id: string) => equipment.some(part => part.id === id);
    const wall = boundaries.find(entry => entry.id === hit.id);
    if (!isPrimitive(hit.id) && !isEquipment(hit.id) && !wall) return undefined;
    if (targets === 'equipment' && !isEquipment(hit.id)) return undefined;
    const ids = (this.props.selected.has(hit.id) ? [...this.props.selected] : [hit.id]).filter(id => isPrimitive(id) || isEquipment(id) || boundaries.some(entry => entry.id === id));
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
    const step = wall || ids.some(isPrimitive) ? 1 : .25;
    return { ids, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), origin), origin, free, step, delta: [0, 0, 0], built: false };
  }

  /** Brass copies of the moved pieces; the originals stay until the source commits on release. */
  private buildMovePreview(ids: string[]) {
    release(this.movePreview);
    const { primitives, equipment, boundaries } = this.props.source.construction;
    for (const id of ids) {
      const primitive = primitives.find(part => part.id === id);
      if (primitive) {
        const geometry = primitiveGeometry(primitive.kind, primitive.size);
        const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: .22, depthWrite: false }));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }));
        for (const object of [fill, edges]) { object.position.set(...primitive.position); object.rotation.y = primitive.rotationDeg * Math.PI / 180; object.renderOrder = 20; this.movePreview.add(object); }
        continue;
      }
      const item = equipment.find(part => part.id === id);
      if (item) {
        const datum = new THREE.Group(); datum.position.set(...item.position); datum.rotation.y = -item.bearingDeg * Math.PI / 180;
        const ghost = this.equipment.clone(item.partId, true), part = this.props.catalog.equipment.find(entry => entry.id === item.partId);
        if (ghost) datum.add(ghost);
        else if (part) { const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...part.size)), new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false })); box.position.set(...part.boundsCenter); datum.add(box); }
        this.movePreview.add(datum); continue;
      }
      const wall = boundaries.find(entry => entry.id === id);
      if (wall) {
        const size: Vec3 = [this.hullSize.x + 2, this.hullSize.y + 2, this.hullSize.z + 2]; const axis = { x: 0, y: 1, z: 2 }[wall.axis]; size[axis] = Math.max(.04, wall.thicknessMm / 1000);
        const box = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: .25, depthWrite: false }));
        box.position.copy(this.controls.target); box.position.setComponent(axis, wall.offset); this.movePreview.add(box);
      }
    }
    this.movePreview.position.set(0, 0, 0); this.applyClip();
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
      move.delta = [0, 1, 2].map(index => move.free[index] ? snapCoordinate(raw.getComponent(index), move.step) : 0) as Vec3;
    }
    this.movePreview.position.set(...move.delta); this.movePreview.visible = true;
  }

  private finishMove() { release(this.movePreview); this.movePreview.visible = false; this.renderer.domElement.style.cursor = ''; }

  /** A press that is not laying pieces hides the ghost and hover outline: box selection, the secondary button, a move or a camera drag. */
  private navigating() { const press = this.pointerStart; return !!press && !press.start && (press.box || press.button === 2 || press.moved); }
  private down = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 2) || this.pointerStart) return;
    const box = event.button === 0 && event.shiftKey;
    if (box) {
      // Finish OrbitControls' damped deltas without moving the visible camera.
      const position = this.camera.position.clone(), rotation = this.camera.quaternion.clone(), target = this.controls.target.clone();
      const damping = this.controls.enableDamping;
      this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
      this.camera.position.copy(position); this.camera.quaternion.copy(rotation); this.controls.target.copy(target); this.camera.updateMatrixWorld(true);
      this.controls.enabled = false; event.stopImmediatePropagation(); event.preventDefault();
    }
    const move = !box && event.button === 0 ? this.movePick(event) : undefined;
    const start = !box && !move && event.button === 0 && this.props.gesture !== 'none' && this.props.placementPiece ? this.pick(event, 'hull') : undefined;
    // A press on the hull lays or moves pieces, so OrbitControls (which listens after this capture handler) must not orbit with the same drag; `up` and `cancel` re-enable it.
    if (start || move) this.controls.enabled = false;
    this.pointerStart = { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, moved: false, box, additive: event.ctrlKey || event.metaKey, start, move, points: start ? [start.placement] : [] };
    this.hover = { clientX: event.clientX, clientY: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.updateGhost(); this.updateStrokePreview();
  };
  private move = (event: PointerEvent) => {
    this.hover = { clientX: event.clientX, clientY: event.clientY }; this.updateGhost(); this.highlight(event);
    if (!this.pointerStart || event.pointerId !== this.pointerStart.id) return;
    this.pointerStart.moved ||= Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) >= 5;
    if (this.pointerStart.box) { this.showBox(event); return; }
    if (this.pointerStart.move) { if (this.pointerStart.moved) this.updateMove(event); return; }
    const { start, points } = this.pointerStart, piece = this.props.placementPiece;
    if (!start || !piece) return;
    if (this.props.gesture === 'fill') { this.updateFillPreview(); this.updateStrokePreview(); return; }
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
    this.strokePreview.clear(); this.strokeKey = ''; this.showBox();
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    const clicked = !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5;
    const piece = this.props.placementPiece;
    if (start.button === 2) {
      const hit = clicked ? this.pick(event, 'all') : undefined;
      if (hit?.id) this.props.onErase(hit.id);
    } else if (rect) {
      if (clicked) { const hit = this.pick(event, 'all'); this.props.onBoxSelect(hit?.id ? [hit.id] : [], true); }
      else this.props.onBoxSelect(boxSelectedPieces(this.props.source, this.props.catalog, this.camera, rect, this.host.clientWidth, this.host.clientHeight, this.props.slice, this.props.rooms), start.additive);
    } else if (start.move) {
      const moved = start.moved && start.move.delta.some(value => Math.abs(value) > 1e-6);
      this.finishMove();
      if (moved) this.props.onMove(start.move.ids, start.move.delta);
      else if (clicked) this.props.onPick(this.pick(event, 'all'));
    } else if (start.start && piece) {
      const hit = this.pick(event, 'hull');
      if (!hit) return;
      if (this.props.gesture === 'fill') this.props.onStroke(fillLattice(start.start.placement, clicked ? start.start.placement : hit.placement, pieceExtents(piece), start.start.axis));
      else this.props.onStroke(clicked ? [start.start.placement] : start.points);
    } else if (clicked) this.props.onPick(this.pick(event, this.props.placementPiece ? 'hull' : this.props.pickTargets));
  };
  private leave = () => { this.hover = undefined; this.ghost.visible = false; this.ghostMirror.visible = false; this.ghostArc.visible = false; this.ghostPosition = undefined; release(this.hoverGroup); this.hoverSurface = ''; };
  private cancel = () => {
    const pointer = this.pointerStart; this.pointerStart = undefined; this.controls.enabled = true;
    if (pointer && this.renderer.domElement.hasPointerCapture(pointer.id)) this.renderer.domElement.releasePointerCapture(pointer.id);
    this.fillPreview.visible = false; this.strokePreview.clear(); this.strokeKey = ''; this.showBox(); this.finishMove(); this.leave();
  };
  private key = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.pointerStart) this.cancel(); };
  private animate = () => {
    if (this.dead) return;
    this.controls.update();
    if (this.hover) { if (this.props.placementPiece) this.updateGhost(); this.highlight(this.hover); }
    this.renderer.render(this.scene, this.camera); this.placeTags();
    if (!this.orientationRotation.equals(this.camera.quaternion)) {
      updateBuilderOrientation(this.orientation, this.camera);
      this.orientationRotation.copy(this.camera.quaternion);
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose() {
    this.dead = true; cancelAnimationFrame(this.frame); this.modelAbort?.abort(); this.resize.disconnect(); this.controls.dispose();
    this.strokePreview.clear(); this.equipment.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.down, true); canvas.removeEventListener('pointermove', this.move); canvas.removeEventListener('pointerup', this.up);
    canvas.removeEventListener('pointercancel', this.cancel); canvas.removeEventListener('pointerleave', this.leave);
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
  return <div className="sb-viewport" aria-label="Ship construction viewport">
    <div ref={host} className="sb-canvas"/>
    <div ref={overlay} className="sb-overlay">
      <svg className="sb-leaders" aria-hidden="true"/>
      {props.tags.map(tag => <div key={tag.key} data-tag={tag.key} className={`sb-tag ${tag.tone}`}>{tag.content}</div>)}
      <div className="sb-cursor">{props.status}<span data-coords className="sb-coords"/></div>
      <div data-measure className="sb-tag mint"/>
      <div data-selection-box className="sb-selection-box" hidden aria-hidden="true"/>
    </div>
    <BuilderOrientation elementRef={orientation}/>
    {error && <p role="alert" className="sb-view-error">{error}</p>}
  </div>;
}

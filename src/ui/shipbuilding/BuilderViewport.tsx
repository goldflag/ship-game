import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { armorThicknessColor } from '../../ships/inspection';
import { surfaceKey } from '../../ships/constructionEditor';
import { constructionPaintColor } from './paints';
import { snapCoordinate } from './editorNumbers';

export type BuilderView = 'orbit' | 'top' | 'side' | 'bow';
export type BuilderDisplay = 'paint' | 'armor' | 'internals';
export interface BuilderPick { id?: string; surface?: string; position: Vec3; additive: boolean; }
export type ConstructionModelFactory = (source: ConstructionSource, result: ConstructionResult, signal: AbortSignal) => Promise<THREE.Group>;
interface ViewportProps {
  source: ConstructionSource; result?: ConstructionResult; catalog: ConstructionCatalog;
  selected: ReadonlySet<string>; selectedSurfaces: ReadonlySet<string>;
  view: BuilderView; display: BuilderDisplay; slice?: number; planeY: number;
  placement: boolean; brush: boolean; gridStep: number; fitRequest: number;
  onPick(pick: BuilderPick): void; onStroke(points: Vec3[]): void;
  createModel?: ConstructionModelFactory;
}

function release(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(child => {
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

class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-50, 50, 35, -35, .1, 6000);
  private controls: OrbitControls;
  private hull = new THREE.Group();
  private details = new THREE.Group();
  private selection = new THREE.Group();
  private composed = new THREE.Group();
  private grid = new THREE.GridHelper(1000, 1000, '#759392', '#36555e');
  private water: THREE.Mesh;
  private resize: ResizeObserver;
  private pickMeshes: THREE.Object3D[] = [];
  private surfaceTriangles: ConstructionSurface[] = [];
  private props: ViewportProps;
  private frame = 0;
  private dead = false;
  private span = 70;
  private contentKey = '';
  private modelKey = '';
  private modelAbort?: AbortController;
  private pointerStart?: { x: number; y: number; points: Vec3[] };
  private currentView: BuilderView = 'orbit';
  private modelError: (message: string) => void;

  constructor(private host: HTMLDivElement, props: ViewportProps, modelError: (message: string) => void) {
    this.props = props; this.modelError = modelError;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor('#19323f');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#e5f1ef', '#45616d', 2.6));
    const sun = new THREE.DirectionalLight('#fff2d2', 3); sun.position.set(-80, 150, -120); this.scene.add(sun);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#214652', transparent: true, opacity: .32, roughness: .5, side: THREE.DoubleSide, depthWrite: false }));
    water.rotation.x = -Math.PI / 2; water.renderOrder = 2; this.water = water;
    this.grid.position.y = -.03; this.scene.add(water, this.grid, this.hull, this.details, this.selection, this.composed);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .15;
    this.controls.minZoom = .08; this.controls.maxZoom = 100; this.controls.maxPolarAngle = Math.PI * .95;
    this.camera.position.set(65, 45, -75); this.controls.update();
    this.resize = new ResizeObserver(() => this.measure()); this.resize.observe(host); this.measure();
    host.addEventListener('pointerdown', this.down); host.addEventListener('pointermove', this.move); host.addEventListener('pointerup', this.up); host.addEventListener('pointercancel', this.cancel);
    this.update(props); this.fit(); this.animate();
  }

  private measure() {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height); this.camera.left = -this.span * width / height / 2; this.camera.right = -this.camera.left;
    this.camera.top = this.span / 2; this.camera.bottom = -this.camera.top; this.camera.updateProjectionMatrix();
  }

  fit() {
    const bounds = new THREE.Box3();
    for (const surface of this.props.result?.surfaces ?? []) for (const point of surface.vertices) bounds.expandByPoint(new THREE.Vector3(...point));
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-10, -5, -25), new THREE.Vector3(10, 5, 25));
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    this.span = Math.max(15, size.length() * 1.1 / Math.min(1, this.host.clientWidth / Math.max(1, this.host.clientHeight)));
    this.controls.target.copy(center); this.camera.zoom = 1;
    this.setView(this.props.view); this.measure();
  }

  private setView(view: BuilderView) {
    const direction = view === 'top' ? [0, 1, .0001] : view === 'side' ? [1, 0, 0] : view === 'bow' ? [0, 0, -1] : [1, .7, -1.15];
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(Math.max(200, this.span * 3)));
    this.camera.up.set(0, 1, 0); this.camera.lookAt(this.controls.target); this.controls.enableRotate = view === 'orbit'; this.controls.update(); this.currentView = view;
  }

  update(props: ViewportProps) {
    const old = this.props; this.props = props;
    if (props.view !== this.currentView) this.setView(props.view);
    if (props.fitRequest !== old.fitRequest || props.source.id !== old.source.id || (!old.result && props.result)) this.fit();
    this.controls.mouseButtons.LEFT = props.placement ? null as unknown as THREE.MOUSE : THREE.MOUSE.ROTATE;
    this.grid.position.y = props.planeY - .03;
    this.water.position.y = props.result?.loading?.waterlineY ?? 0;
    this.water.visible = props.display !== 'internals';
    const key = `${props.result?.contentHash}:${props.display}`;
    if (key !== this.contentKey) {
      this.contentKey = key; release(this.hull); this.surfaceTriangles = []; this.pickMeshes = [];
      const vertices: number[] = [], colors: number[] = [];
      for (const surface of props.result?.surfaces ?? []) {
        if (surface.open && props.display === 'paint') continue;
        const color = new THREE.Color(props.display === 'armor' ? armorThicknessColor(surface.thicknessMm) : constructionPaintColor(surface.paint));
        fan(surface, vertices, colors, color);
        for (let i = 1; i < surface.vertices.length - 1; i++) this.surfaceTriangles.push(surface);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: 0, side: THREE.DoubleSide, transparent: props.display === 'internals', opacity: props.display === 'internals' ? .15 : 1, depthWrite: props.display !== 'internals' }));
      mesh.userData.hull = true; this.hull.add(mesh); this.pickMeshes.push(mesh);
    }
    const modelKey = `${props.source.revision}:${props.result?.contentHash}`;
    if (modelKey !== this.modelKey) {
      this.modelKey = modelKey; this.modelAbort?.abort(); release(this.composed);
      if (props.createModel && props.result && props.result.revision === props.source.revision) {
        const abort = new AbortController(); this.modelAbort = abort;
        props.createModel(props.source, props.result, abort.signal).then(group => {
          if (this.dead || abort.signal.aborted || modelKey !== this.modelKey) { release(group); return; }
          this.composed.add(group); this.update(this.props); this.modelError('');
        }).catch(error => { if (!abort.signal.aborted && !this.dead) this.modelError(`Equipment preview: ${error instanceof Error ? error.message : String(error)}`); });
      }
    }
    this.composed.visible = props.display === 'paint';
    // Native surfaces remain the pick target even when shared composition renders the exterior.
    this.hull.visible = props.display !== 'paint' || !this.composed.children.length;
    release(this.details); release(this.selection);
    this.pickMeshes = this.pickMeshes.filter(mesh => mesh.userData.hull);
    for (const part of props.source.construction.equipment) {
      const entry = props.catalog.equipment.find(entry => entry.id === part.partId);
      if (!entry) continue;
      const box = new THREE.Mesh(new THREE.BoxGeometry(...entry.size), new THREE.MeshBasicMaterial({ color: props.selected.has(part.id) ? '#e0c58d' : entry.placement === 'internal' ? '#94d9bf' : '#9cbbc4', wireframe: true, transparent: true, opacity: props.selected.has(part.id) ? 1 : .55 }));
      const datum = new THREE.Group(); datum.position.set(...part.position); datum.rotation.y = -part.bearingDeg * Math.PI / 180; box.position.set(...entry.boundsCenter);
      box.userData.sourceId = part.id; datum.add(box); this.details.add(datum); this.pickMeshes.push(box);
      datum.visible = props.display === 'internals' || props.selected.has(part.id) || !this.composed.children.length;
    }
    for (const wall of props.source.construction.boundaries) {
      const size: Vec3 = [this.span, this.span, this.span]; const axis = { x: 0, y: 1, z: 2 }[wall.axis]; size[axis] = Math.max(.04, wall.thicknessMm / 1000);
      const box = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: '#e0c58d', transparent: true, opacity: props.selected.has(wall.id) ? .3 : .09, depthWrite: false }));
      box.position.setComponent(axis, wall.offset); box.userData.sourceId = wall.id; box.visible = props.display === 'internals' || props.selected.has(wall.id); this.details.add(box); if (box.visible) this.pickMeshes.push(box);
    }
    for (const surface of props.result?.surfaces ?? []) {
      const chosen = props.selectedSurfaces.has(surfaceKey(surface.primitiveId, surface.face));
      if (!chosen && !props.selected.has(surface.primitiveId)) continue;
      const points = surface.vertices.map(vertex => new THREE.Vector3(...vertex).addScaledVector(new THREE.Vector3(...surface.normal), .025));
      points.push(points[0].clone());
      this.selection.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#efd5a0', depthTest: false })));
      if (chosen && props.display === 'armor' && !surface.open) {
        const lines: THREE.Vector3[] = [];
        for (let i = 0; i < surface.vertices.length; i++) {
          const outer = new THREE.Vector3(...surface.vertices[i]); const inner = outer.clone().addScaledVector(new THREE.Vector3(...surface.normal), -surface.thicknessMm / 1000);
          const next = new THREE.Vector3(...surface.vertices[(i + 1) % surface.vertices.length]).addScaledVector(new THREE.Vector3(...surface.normal), -surface.thicknessMm / 1000);
          lines.push(outer, inner, inner, next);
        }
        this.selection.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: '#94d9bf', depthTest: false })));
      }
    }
    const loading = props.result?.loading;
    if (loading) for (const [point, color] of [[loading.centerOfGravity, '#e0c58d'], [loading.buoyancyCenter, '#94d9bf']] as const) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(.25, this.span / 140), 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      marker.position.set(...point); marker.renderOrder = 10; this.details.add(marker);
    }
    this.applyClip();
  }

  private applyClip() {
    const planes = this.props.slice === undefined ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), this.props.slice)];
    for (const group of [this.hull, this.details, this.composed, this.selection]) group.traverse(child => {
      const mesh = child as THREE.Mesh;
      for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) { material.clippingPlanes = planes; material.needsUpdate = true; }
    });
  }

  private pick(event: PointerEvent): BuilderPick {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    const hits = ray.intersectObjects(this.pickMeshes, false).filter(hit => this.props.slice === undefined || hit.point.y <= this.props.slice);
    const hit = hits[0];
    const surface = hit?.object.userData.hull ? this.surfaceTriangles[hit.faceIndex ?? -1] : undefined;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.props.planeY);
    const point = ray.ray.intersectPlane(plane, new THREE.Vector3()) ?? hit?.point ?? new THREE.Vector3(0, this.props.planeY, 0);
    return { id: surface?.primitiveId ?? hit?.object.userData.sourceId, surface: surface && surfaceKey(surface.primitiveId, surface.face), position: [snapCoordinate(point.x, this.props.gridStep), this.props.planeY, snapCoordinate(point.z, this.props.gridStep)], additive: event.shiftKey || event.ctrlKey || event.metaKey };
  }

  private down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.pointerStart = { x: event.clientX, y: event.clientY, points: this.props.placement && this.props.brush ? [this.pick(event).position] : [] };
    this.host.setPointerCapture(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    if (!this.pointerStart || !this.props.placement || !this.props.brush) return;
    const position = this.pick(event).position;
    if (!this.pointerStart.points.some(point => point.every((v, i) => v === position[i])) && this.pointerStart.points.length < 128) this.pointerStart.points.push(position);
  };
  private up = (event: PointerEvent) => {
    const start = this.pointerStart; this.pointerStart = undefined;
    if (!start) return;
    if (start.points.length) this.props.onStroke(start.points);
    else if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) this.props.onPick(this.pick(event));
  };
  private cancel = () => { this.pointerStart = undefined; };
  private animate = () => { if (this.dead) return; this.controls.update(); this.renderer.render(this.scene, this.camera); this.frame = requestAnimationFrame(this.animate); };

  dispose() {
    this.dead = true; cancelAnimationFrame(this.frame); this.modelAbort?.abort(); this.resize.disconnect(); this.controls.dispose();
    this.host.removeEventListener('pointerdown', this.down); this.host.removeEventListener('pointermove', this.move); this.host.removeEventListener('pointerup', this.up); this.host.removeEventListener('pointercancel', this.cancel);
    release(this.scene); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}

export function BuilderViewport(props: ViewportProps) {
  const host = useRef<HTMLDivElement>(null), viewport = useRef<Viewport | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    try { viewport.current = new Viewport(host.current!, props, setError); }
    catch (error) { setError(`The 3D view could not start: ${error instanceof Error ? error.message : String(error)}. Your source remains editable and saveable.`); }
    return () => { viewport.current?.dispose(); viewport.current = undefined; };
  }, []);
  useEffect(() => { viewport.current?.update(props); }, [props]);
  return <div className="shipbuilder-viewport" aria-label="Ship construction viewport"><div ref={host} className="shipbuilder-canvas"/>{error && <p role="alert" className="shipbuilder-view-error">{error}</p>}</div>;
}

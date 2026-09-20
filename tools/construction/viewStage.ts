import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, ConstructionSurface } from '../../src/ships/blueprint';
import { createConstructionHull } from '../../src/game/constructionModel';
import { editableConstructionSurfaces } from '../../src/ships/constructionEditor';
import { armorThicknessColor, type ArmorScale } from '../../src/ships/inspection';
import type { BuilderDisplay, BuilderScene } from '../../src/ui/shipbuilding/builderScene';
import { boundaryGeometry } from '../../src/ui/shipbuilding/boundaryGeometry';
import { EquipmentPreview } from '../../src/ui/shipbuilding/equipmentPreview';
import { primitiveGeometry, primitiveRotation } from '../../src/ui/shipbuilding/primitiveGeometry';
import { installedTurretArmor, installedTurretThicknesses } from '../../src/ui/shipbuilding/turretArmor';
import { buildHullContent } from '../../src/ui/shipbuilding/viewport/hullContent';
import { BRASS, READY, SALMON, fan, release } from '../../src/ui/shipbuilding/viewport/resources';
import { fillDetails } from '../../src/ui/shipbuilding/viewport/sceneDetails';
import type { ReviewCanvas } from './presentation';
import { idColors, viewDirection, type Vec3, type ViewRequest } from './viewOptions';

const BACKGROUND = '#353b3f', INTERNALS_BACKGROUND = '#aeb6ba', IDS_BACKGROUND = '#16181a', HIGHLIGHT = '#ff3fd0', FOV_DEG = 35;
type IdKind = 'primitive' | 'equipment' | 'boundary';
/** The compiled review of a valid design: `view` draws its posed model for the exterior so both commands show one ship. */
export interface CompiledStage { root: THREE.Object3D; model: THREE.Object3D; resetPose(): void }

const drawable = (node: THREE.Object3D) => node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points || node instanceof THREE.Sprite;
const box = (bounds: THREE.Box3) => ({ min: bounds.min.toArray().map(round) as Vec3, max: bounds.max.toArray().map(round) as Vec3 });
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Arbitrary views of a design, valid or not. Invalid drafts and the armor, internals and ids modes are drawn with the
 * editor's own viewport builders (`buildHullContent`, `EquipmentPreview`, `fillDetails`); nothing here is a second renderer. */
export function createViewStage(source: ConstructionSource, result: ConstructionResult, catalog: ConstructionCatalog, canvas: ReviewCanvas, compiled?: CompiledStage) {
  const { scene, renderer } = canvas, construction = source.construction;
  const content = new THREE.Group(), overlay = new THREE.Group();
  content.name = 'view content'; overlay.name = 'view overlay';
  let wake: (() => void) | undefined, failure = '';
  const equipment = new EquipmentPreview(() => wake?.(), message => { if (message) failure = message; wake?.(); });
  const kinds = new Map<string, IdKind>();
  for (const primitive of construction.primitives) kinds.set(primitive.id, 'primitive');
  for (const item of construction.equipment) kinds.set(item.id, 'equipment');
  for (const wall of construction.boundaries) kinds.set(wall.id, 'boundary');
  const invalid = new Set(result.diagnostics.filter(d => d.severity === 'error' && d.sourceId).map(d => d.sourceId!));
  const native = result.surfaces.length ? result.surfaces : undefined;
  const surfacesOf = new Map<string, ConstructionSurface[]>();
  for (const surface of native ?? []) { const list = surfacesOf.get(surface.primitiveId); if (list) list.push(surface); else surfacesOf.set(surface.primitiveId, [surface]); }
  // The editor's scale: the ship's thinnest to thickest plate, turret plates included.
  const turrets = installedTurretArmor(source, catalog);
  const plated = [...editableConstructionSurfaces(source, native ?? []).filter(s => !s.open).map(s => s.thicknessMm), ...installedTurretThicknesses(source, catalog)];
  const armorScale: ArmorScale = { fromMm: plated.length ? Math.min(...plated) : 0, toMm: plated.length ? Math.max(...plated) : 0 };

  const extent = new THREE.Box3(); for (const surface of native ?? []) for (const vertex of surface.vertices) extent.expandByPoint(new THREE.Vector3(...vertex));
  const span = extent.isEmpty() ? 100 : Math.max(...extent.getSize(new THREE.Vector3()).toArray());

  const primitiveMesh = (id: string, material: THREE.Material) => {
    const primitive = construction.primitives.find(p => p.id === id)!;
    const mesh = new THREE.Mesh(primitiveGeometry(primitive.kind, primitive.size, primitive.vertices, primitive.customHull, primitive.shaping, primitive.balcony, primitive.mesh, primitive.solid), material);
    mesh.position.set(...primitive.position); mesh.rotation.copy(primitiveRotation(primitive)); mesh.userData.sourceId = id;
    return mesh;
  };
  /** Native faces of the given pieces, or their source solids when the compile produced no exterior. */
  const pieceMesh = (ids: readonly string[], color: (id: string) => THREE.Color, material: () => THREE.Material) => {
    const group = new THREE.Group();
    if (!native) { for (const id of ids) { const m = material(); (m as THREE.MeshBasicMaterial).color.copy(color(id)); (m as THREE.MeshBasicMaterial).vertexColors = false; group.add(primitiveMesh(id, m)); } return group; }
    const positions: number[] = [], colors: number[] = [];
    for (const id of ids) for (const surface of surfacesOf.get(id) ?? []) if (!surface.open) fan(surface, positions, colors, color(id));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    group.add(new THREE.Mesh(geometry, material()));
    return group;
  };
  const equipmentRoot = () => content.visible && equipment.group.parent === content ? equipment.group : compiled?.model;
  const boundsOf = (id: string): THREE.Box3 => {
    const bounds = new THREE.Box3(), kind = kinds.get(id);
    if (kind === 'primitive') {
      if (surfacesOf.has(id)) for (const surface of surfacesOf.get(id)!) for (const vertex of surface.vertices) bounds.expandByPoint(new THREE.Vector3(...vertex));
      else { const mesh = primitiveMesh(id, new THREE.MeshBasicMaterial()); mesh.updateMatrixWorld(true); bounds.setFromObject(mesh); release(mesh); }
    } else if (kind === 'boundary') {
      const wall = construction.boundaries.find(w => w.id === id)!, geometry = boundaryGeometry(construction.primitives, wall.axis, wall.offset);
      geometry.computeBoundingBox(); if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) bounds.copy(geometry.boundingBox); geometry.dispose();
    } else {
      equipmentRoot()?.traverse(node => { if (node instanceof THREE.Mesh && node.userData.sourceId === id && node.material && (node.material as THREE.Material).visible !== false) bounds.expandByObject(node); });
      if (bounds.isEmpty()) { const item = construction.equipment.find(e => e.id === id)!; bounds.setFromCenterAndSize(new THREE.Vector3(...item.position), new THREE.Vector3(2, 2, 2)); }
    }
    return bounds;
  };

  const settleEquipment = async (shown: ConstructionSource) => {
    let deadline = performance.now() + 90_000, failed = false;
    failure = '';
    for (;;) {
      // One failed model must not hide the rest: give the others a few more seconds, then draw what arrived.
      if (failure && !failed) { failed = true; deadline = Math.min(deadline, performance.now() + 5_000); }
      equipment.update(shown, catalog, result.propellerSupports, invalid, result.surfaces);
      const missing = shown.construction.equipment.filter(item => catalog.equipment.some(part => part.id === item.partId) && !equipment.has(item.id));
      if (!missing.length) return [];
      if (performance.now() > deadline) return missing.map(item => item.id);
      await new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, 500); });
    }
  };

  const render = async (request: ViewRequest) => {
    const unknown = [...request.focus, ...request.highlight].filter(id => !kinds.has(id));
    if (unknown.length) throw new Error('Unknown source ID ' + unknown.map(id => JSON.stringify(id)).join(', ') + '. Use primitive, equipment or boundary IDs from ship:inspect --source.');
    const warnings: string[] = [], restore: (() => void)[] = [];
    const composed = request.mode === 'exterior' && compiled;
    const only = request.isolate ? new Set(request.focus) : undefined;
    const shownPrimitives = construction.primitives.filter(p => !only || only.has(p.id));
    const display: BuilderDisplay = request.mode === 'armor' ? 'armor' : request.mode === 'internals' ? 'internals' : 'paint';
    let legend: unknown;
    const idColor = new Map<string, string>();
    try {
      scene.add(content, overlay);
      if (composed) {
        compiled.resetPose(); compiled.root.visible = true;
        compiled.model.traverse(node => { node.visible = true; });
        if (only) {
          compiled.model.traverse(node => { if (drawable(node)) node.visible = only.has(node.userData.sourceId); });
          if (shownPrimitives.length && native) content.add(createConstructionHull(shownPrimitives.flatMap(p => surfacesOf.get(p.id) ?? []), construction.primitives, construction.finish, construction));
        }
      } else {
        if (compiled) compiled.root.visible = false;
        const shown: ConstructionSource = only ? { ...source, construction: { ...construction, equipment: construction.equipment.filter(e => only.has(e.id)) } } : source;
        const missing = await settleEquipment(shown);
        if (missing.length) warnings.push('Equipment models not drawn: ' + missing.join(', ') + (failure ? ' (' + failure + ')' : '') + '.');
        const drawn: ConstructionSource = only ? { ...source, construction: { ...construction, primitives: shownPrimitives, boundaries: construction.boundaries.filter(w => only.has(w.id)) } } : source;
        const builder: BuilderScene = {
          source: drawn, result, current: result, catalog, selected: new Set(), selectedSurfaces: new Set(), twins: new Map(), mirrorEdits: false, view: 'orbit', perspective: request.perspective,
          display, fitRequest: 0, armorScale, gridStep: 1, gesture: 'none', pickTargets: 'all', moveTargets: 'none', highlightFaces: false, rooms: false,
          showCenters: request.mode === 'internals' && !only, arcs: [], proposed: [], measuring: false,
        };
        const surfaces = native && (only ? shownPrimitives.flatMap(p => surfacesOf.get(p.id) ?? []) : native);
        const hull = new THREE.Group(), details = new THREE.Group(), selection = new THREE.Group();
        let surfacesByKey = new Map<string, ConstructionSurface[]>();
        if (request.mode === 'ids') {
          const ids = [...shownPrimitives.map(p => p.id), ...shown.construction.equipment.map(e => e.id)], colors = idColors(ids.length);
          ids.forEach((id, i) => idColor.set(id, colors[i]));
          hull.add(pieceMesh(shownPrimitives.map(p => p.id), id => new THREE.Color(idColor.get(id)!), () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
        } else {
          const built = buildHullContent(builder, surfaces, invalid);
          if (built.objects.length) hull.add(...built.objects);
          surfacesByKey = built.surfacesByKey;
        }
        equipment.setDisplay(display, shown, catalog, armorScale);
        if (request.mode === 'ids') {
          const flat = new Map<string, THREE.Material>();
          equipment.group.traverse(node => {
            if (!(node instanceof THREE.Mesh)) return;
            const color = idColor.get(node.userData.sourceId);
            if (!color) { const was = node.visible; node.visible = false; restore.push(() => { node.visible = was; }); return; }
            let material = flat.get(color);
            if (!material) { material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }); flat.set(color, material); }
            const original = node.material; node.material = material; restore.push(() => { node.material = original; });
          });
          restore.push(() => flat.forEach(material => material.dispose()));
        } else fillDetails({ scene: builder, invalid, nativeSurfaces: surfaces, hull, details, selection, equipment, pickMeshes: [], deckMeshes: [], surfacesByKey, span });
        // The editor's 9 % walls vanish in a still image; draw them firmly enough to read.
        if (request.mode === 'internals') details.traverse(node => { if (node instanceof THREE.Mesh && kinds.get(node.userData.sourceId) === 'boundary') (node.material as THREE.Material).opacity = Math.max((node.material as THREE.Material).opacity, .3); });
        content.add(hull, equipment.group, details, selection);
      }
      content.visible = true; scene.updateMatrixWorld(true);

      // Highlight: a tinted copy of each piece's faces, a tinted fitting, and a box that shows through the ship.
      const tint = new THREE.MeshStandardMaterial({ color: HIGHLIGHT, emissive: HIGHLIGHT, emissiveIntensity: .45, roughness: .6, side: THREE.DoubleSide });
      restore.push(() => tint.dispose());
      for (const id of request.highlight) {
        if (only && !only.has(id)) continue;
        const kind = kinds.get(id);
        if (request.mode !== 'ids') {
          if (kind === 'primitive') overlay.add(pieceMesh([id], () => new THREE.Color(HIGHLIGHT), () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: .7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
          else if (kind === 'equipment') equipmentRoot()?.traverse(node => {
            if (!(node instanceof THREE.Mesh) || node.userData.sourceId !== id) return;
            const original = node.material; node.material = tint; restore.push(() => { node.material = original; });
          });
        }
        const bounds = boundsOf(id);
        if (bounds.isEmpty()) continue;
        const frame = new THREE.Box3Helper(bounds, new THREE.Color(request.mode === 'ids' ? '#ffffff' : HIGHLIGHT));
        (frame.material as THREE.LineBasicMaterial).depthTest = false; frame.renderOrder = 20; overlay.add(frame);
      }

      const focused = request.focus.map(id => ({ id, kind: kinds.get(id)!, bounds: boundsOf(id) }));
      const world = new THREE.Box3();
      if (composed) { if (!only) world.setFromObject(compiled.model); world.union(new THREE.Box3().setFromObject(content)); }
      else content.traverse(node => { if (node instanceof THREE.Mesh && node.visible && !(node.material instanceof THREE.Material && !node.material.visible)) world.expandByObject(node); });
      const framed = new THREE.Box3();
      if (request.region) framed.set(new THREE.Vector3(...request.region[0]), new THREE.Vector3(...request.region[1]));
      else if (focused.length) {
        for (const item of focused) framed.union(item.bounds);
        const size = framed.getSize(new THREE.Vector3()); framed.expandByVector(size.multiplyScalar(.12).addScalar(.5));
      } else framed.copy(world);
      if (framed.isEmpty()) throw new Error('Nothing to frame: the design has no drawable geometry' + (only ? ' for the isolated IDs' : '') + '.');
      world.union(framed);

      let { width, height } = request, aspect = width / height;
      const { direction, up } = viewDirection(request.azimuthDeg, request.elevationDeg);
      const toCamera = new THREE.Vector3(...direction), center = framed.getCenter(new THREE.Vector3());
      const reach = world.getSize(new THREE.Vector3()).length() + center.distanceTo(world.getCenter(new THREE.Vector3())) + 5;
      const corners = (camera: THREE.Camera) => [0, 1, 2, 3, 4, 5, 6, 7].map(c => new THREE.Vector3(c & 1 ? framed.max.x : framed.min.x, c & 2 ? framed.max.y : framed.min.y, c & 4 ? framed.max.z : framed.min.z).applyMatrix4(camera.matrixWorldInverse));
      let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, worldUnitsPerPixel: number;
      const aim = (distance: number) => { camera.position.copy(center).addScaledVector(toCamera, distance); camera.up.set(...up); camera.lookAt(center); camera.updateMatrixWorld(true); };
      if (request.perspective) {
        camera = new THREE.PerspectiveCamera(FOV_DEG, aspect, .05, 10);
        aim(1);
        const tan = Math.tan(FOV_DEG * Math.PI / 360);
        // Each corner must fit the frustum: its depth offset plus its lateral extent over the half-angle tangent.
        const distance = Math.max(1, ...corners(camera).map(p => (p.z + 1) + Math.max(Math.abs(p.y) / tan, Math.abs(p.x) / (tan * aspect)) * 1.08));
        aim(distance); camera.far = distance + reach; camera.near = Math.max(.05, distance / 2000); camera.zoom = request.zoom;
        worldUnitsPerPixel = 2 * distance * tan / request.zoom / height;
      } else {
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, reach * 2);
        aim(reach);
        const extents = new THREE.Box3().setFromPoints(corners(camera)), size = extents.getSize(new THREE.Vector3());
        // Without --size the image is trimmed to the framing, so a profile is not two thirds background.
        if (request.trim) {
          const shape = Math.max(size.x, .2) / Math.max(size.y, .2);
          if (shape > aspect) height = Math.max(Math.round(width / 4), Math.min(height, Math.ceil(width / shape)));
          else width = Math.max(Math.round(height / 2), Math.min(width, Math.ceil(height * shape)));
          aspect = width / height;
        }
        const halfHeight = Math.max(size.y, size.x / aspect, .2) * .55;
        Object.assign(camera, { left: -halfHeight * aspect, right: halfHeight * aspect, top: halfHeight, bottom: -halfHeight }); camera.zoom = request.zoom;
        worldUnitsPerPixel = 2 * halfHeight / request.zoom / height;
      }
      camera.updateProjectionMatrix();

      let section;
      if (request.section) {
        const { axis, value } = request.section, index = 'xyz'.indexOf(axis);
        const keep = request.section.keep === 'auto' ? (direction[index] < 0 ? 'above' : 'below') : request.section.keep;
        const normal = new THREE.Vector3(); normal.setComponent(index, keep === 'below' ? -1 : 1);
        renderer.clippingPlanes = [new THREE.Plane(normal, keep === 'below' ? value : -value)];
        section = { axis, value, kept: `${axis} ${keep === 'below' ? '<=' : '>='} ${value}` };
      }
      renderer.setSize(width, height); renderer.setClearColor(request.mode === 'ids' ? IDS_BACKGROUND : request.mode === 'internals' ? INTERNALS_BACKGROUND : BACKGROUND, 1);
      renderer.render(scene, camera);

      if (request.mode === 'armor') {
        const rows = new Map<number, { mm: number; color: string; hullFaces: number; turretPlates: number }>();
        const row = (mm: number) => { let r = rows.get(mm); if (!r) rows.set(mm, r = { mm, color: armorThicknessColor(mm, armorScale), hullFaces: 0, turretPlates: 0 }); return r; };
        for (const surface of native ?? []) if (!surface.open && (!only || only.has(surface.primitiveId))) row(surface.thicknessMm).hullFaces++;
        for (const { part, armor } of turrets) {
          const count = construction.equipment.filter(item => (!only || only.has(item.id)) && catalog.equipment.find(entry => entry.id === item.partId)?.gunPartId === part.id).length;
          if (armor.plates.length) for (const plate of armor.plates) row(plate.thicknessMm).turretPlates += count; else row(armor.armorMm).turretPlates += count;
        }
        legend = {
          scaleMm: armorScale, ramp: 'green at scaleMm.fromMm through yellow to red at scaleMm.toMm; the scale is this ship\'s own thinnest to thickest plate, as in the editor',
          thicknesses: [...rows.values()].sort((a, b) => a.mm - b.mm), faded: 'fittings without armor and open faces are drawn at 12 % opacity',
          ...(native ? {} : { note: 'No native faces: the compile produced no exterior, so source solids are drawn translucent without thickness colours.' }),
        };
      } else if (request.mode === 'internals') {
        const internal = construction.equipment.filter(item => catalog.equipment.find(part => part.id === item.partId)?.placement === 'internal' && (!only || only.has(item.id)));
        legend = {
          hull: 'exterior at 15 % opacity; deck and superstructure fittings at 12 %', internalEquipment: { drawn: 'opaque, own paint', ids: internal.map(item => item.id) },
          magazines: { color: SALMON, ids: (result.definition?.modules ?? []).filter(m => m.kind === 'magazine').map(m => m.id), ...(result.definition ? {} : { note: 'Magazines come from the compiled definition; none while the draft is invalid.' }) },
          boundaries: { color: BRASS, items: construction.boundaries.filter(w => !only || only.has(w.id)).map(w => ({ id: w.id, axis: w.axis, offset: w.offset })) },
          centers: centersLegend(result, !only), invalid: { color: SALMON },
        };
      } else if (request.mode === 'ids') {
        const gl = renderer.getContext(), pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const ids = [...idColor.keys()], lookup = new Map<number, number>();
        // Flat colours survive the sRGB round trip within one step per channel; antialiased edge pixels match nothing.
        ids.forEach((id, i) => {
          const value = parseInt(idColor.get(id)!.slice(1), 16), rgb = [value >> 16, value >> 8 & 255, value & 255];
          for (let r = -1; r <= 1; r++) for (let g = -1; g <= 1; g++) for (let b = -1; b <= 1; b++) lookup.set((rgb[0] + r) << 16 | (rgb[1] + g) << 8 | (rgb[2] + b), i);
        });
        const seen = ids.map(() => ({ pixels: 0, x0: width, y0: height, x1: -1, y1: -1 }));
        for (let y = 0, o = 0; y < height; y++) for (let x = 0; x < width; x++, o += 4) {
          const hit = lookup.get(pixels[o] << 16 | pixels[o + 1] << 8 | pixels[o + 2]);
          if (hit === undefined) continue;
          const entry = seen[hit], row = height - 1 - y; // GL rows run bottom-up; report image rows.
          entry.pixels++; entry.x0 = Math.min(entry.x0, x); entry.x1 = Math.max(entry.x1, x); entry.y0 = Math.min(entry.y0, row); entry.y1 = Math.max(entry.y1, row);
        }
        const visible = ids.map((id, i) => ({ id, kind: kinds.get(id)!, color: idColor.get(id)!, pixels: seen[i].pixels, pixelBox: [seen[i].x0, seen[i].y0, seen[i].x1, seen[i].y1] })).filter(entry => entry.pixels > 0).sort((a, b) => b.pixels - a.pixels);
        const hidden = ids.filter((_, i) => !seen[i].pixels);
        legend = {
          background: IDS_BACKGROUND, note: 'Unlit flat colour per source primitive or equipment ID. pixelBox is [x0,y0,x1,y1] in image pixels from the top-left; blended edge pixels are not counted.',
          visible, notVisible: hidden.slice(0, 500), ...(hidden.length > 500 ? { notVisibleOmitted: hidden.length - 500 } : {}),
        };
      } else legend = { paint: 'source paints', ...(invalid.size && !composed ? { invalid: { color: SALMON, ids: [...invalid] } } : {}) };

      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), screenUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      return {
        png: renderer.domElement.toDataURL('image/png'),
        report: {
          name: request.name, mode: request.mode, drawnWith: composed ? 'composed model (same as ship:render)' : native ? 'editor viewport builders over native faces' : 'editor source preview (source solids; no native faces)',
          camera: {
            projection: request.perspective ? 'perspective' : 'orthographic', ...(request.perspective ? { fovDeg: FOV_DEG } : {}), azimuthDeg: round(request.azimuthDeg), elevationDeg: round(request.elevationDeg), zoom: request.zoom,
            position: camera.position.toArray().map(round), target: center.toArray().map(round), up: screenUp.toArray().map(round), right: right.toArray().map(round),
            width, height, worldUnitsPerPixel: Math.round(worldUnitsPerPixel * 1e5) / 1e5,
            pixelOf: request.perspective ? 'project with position/target/up and fovDeg (vertical); worldUnitsPerPixel holds at the target depth' : 'pixel = [width/2 + dot(p - target, right) / worldUnitsPerPixel, height/2 - dot(p - target, up) / worldUnitsPerPixel]',
          },
          framedBounds: box(framed), focus: focused.map(item => ({ id: item.id, kind: item.kind, bounds: item.bounds.isEmpty() ? null : box(item.bounds) })),
          isolate: request.isolate, highlight: request.highlight.length ? { color: request.mode === 'ids' ? '#ffffff box only' : HIGHLIGHT, ids: request.highlight } : undefined,
          section, legend, warnings: warnings.length ? warnings : undefined,
        },
      };
    } finally {
      renderer.clippingPlanes = [];
      restore.reverse().forEach(undo => undo());
      if (equipment.group.parent === content) content.remove(equipment.group);
      release(content); release(overlay); scene.remove(content, overlay);
      if (compiled) { compiled.root.visible = true; compiled.model.traverse(node => { node.visible = true; }); }
    }
  };
  return { render, dispose() { equipment.dispose(); } };
}

function centersLegend(result: ConstructionResult, shown: boolean) {
  return shown && result.loading ? { centerOfGravity: { color: BRASS, tag: 'CG', at: result.loading.centerOfGravity }, buoyancyCenter: { color: READY, tag: 'CB', at: result.loading.buoyancyCenter } } : undefined;
}

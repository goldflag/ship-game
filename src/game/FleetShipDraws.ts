import * as THREE from 'three/webgpu';
import type { ShipView } from './ShipView';
import { shipDetailLevels } from './ShipDetail';
import { ShipRenderProxy } from './ShipRenderProxy';
import { FleetBatch } from './FleetBatch';
import { ShipRenderAssemblies, type RenderAssembly } from './ShipRenderAssemblies';
import { SubtreeLayers, type Subtree } from './SubtreeLayers';
import { multiplyAt, operatorNorm, ShipPoseMatrices } from './ShipPoseMatrices';

/** Allowance on the bounded pixel test, so that a sphere passing it passes three's own arithmetic too. */
const BOUND_MARGIN = 1 + 1e-6, BOUNDED_SUBPIXEL = 1.5 / BOUND_MARGIN;

/** An original surface of a batched source, with its slot in the ship's subtree index (-1 when outside it) and its pose. */
type Member = { mesh: THREE.Mesh; layers: number; slot: number; pose: number };
/** Per ship and frame: whether it draws, its inspection mode, and its surfaces' chain visibility. `pivots` (x, y, z in the
 * root's space) are the rest pivots its joint surfaces are bounded from, and `depths` their view depths this frame when
 * `bounded`; `spread` turns a root-space reach into view depth and `stretch` a root-space radius into a world one. `hidden`:
 * out of view last frame, with every instance hidden. `steady`: its settled surfaces still stand (see `Batch`); `visibility`
 * is the subtree's visibility version they were settled against. For the flat walk (`Flat`): its `index` in the ships, its
 * surfaces' indices (`memberIds`), and the chain visibility version, slot version and mode (1 batched, 2 armor, 0 neither)
 * its sources' `joined` flags were taken under; `known` while all three still hold. */
type Ship = { view: ShipView; poses: ShipPoseMatrices; subtree: Subtree; proxy?: ShipRenderProxy; members: Member[]; slots: number; active: boolean; batched: boolean; armor: boolean; layersChanged: boolean;
  pivots: Float64Array; depths: Float64Array; bounded: boolean; spread: number; stretch: number; hidden: boolean; steady: boolean; visibility: number;
  index: number; memberIds: number[]; joinVisibility: number; joinSlots: number; joinMode: number; known: boolean };
type BatchState = { _instanceInfo: { visible: boolean }[] };
/** `pose`: a single surface's own pose (-1 for a joined assembly), `ownerPose` a moving owner's; `index` its place in `Flat`. */
type Source = Omit<RenderAssembly, 'members'> & { ship: Ship; view: ShipView; members: Member[]; layers: number; instance?: number; levels?: { id: number; error: number }[]; level: number; armorContext?: THREE.Mesh;
  pose: number; ownerPose: number; index: number };
/** `ranges`: each ship's consecutive run of sources, also as (ship index, start, end) triples in `spans`. Per source on a joint,
 * its bounds for any joint angles (`ShipPoseMatrices.reach`): its ship's pivot (`anchors`, -1 for a source without), the reach
 * from it and the largest radius. `settled`: culled on those bounds alone last frame, which left its instance hidden at full
 * detail with its surface masked, so while its ship is `steady` and the bounds still cull it there is nothing to write. The
 * four arrays are this batch's run of the flat ones, from `first`. */
type Batch = { mesh: FleetBatch; sources: Source[]; ranges: { ship: Ship; start: number; end: number }[]; first: number; spans: Int32Array;
  anchors: Int32Array; reaches: Float64Array; radii: Float64Array; settled: Uint8Array };
/** Every batch's sources in batch order (batch instance `k` at `first + k`) as the flat walk reads them, each array in that order:
 * - `meshes`: the source's mesh; `owners`, `ownerPoses`: a joined assembly's owner and the owner's pose (-1 for the root);
 * - `poses`: a single surface's pose (-1 for an assembly). `formed` when the walk forms it itself from its moving parent's pose
 *   (`parents`), the element array that parent's matrix is in (`parentElements`) and its fixed offset (`offsets`, 16 each);
 * - `spheres`: the mesh's bounding sphere as built (x, y, z, radius), like the batch's geometry; `levelFirst`: its detail levels' run of `levelErrors` and
 *   `levelIds` (one more entry closes the last), and `levels` the one in use;
 * - `anchors`, `reaches`, `radii`, `settled`: see `Batch`; `contexts` its armor context once made;
 * - `joined`: when last walked, its surfaces drew together and all are in the subtree index, so while its ship is `known` they
 *   still do, their layers are already 0, and there is nothing to ask of them;
 * - `memberFirst`: its surfaces' run of `memberMeshes`, `memberLayers` (their own layers), `memberPoses` and `memberSlots`. */
type Flat = { sources: Source[]; meshes: THREE.Mesh[]; owners: (THREE.Object3D | undefined)[]; ownerPoses: Int32Array; poses: Int32Array; formed: Uint8Array;
  parents: Int32Array; parentElements: number[][]; offsets: Float64Array; spheres: Float64Array; levelFirst: Int32Array; levelErrors: Float64Array; levelIds: Int32Array;
  levels: Int32Array; anchors: Int32Array; reaches: Float64Array; radii: Float64Array; settled: Uint8Array; contexts: (THREE.Mesh | undefined)[]; joined: Uint8Array;
  memberFirst: Int32Array; members: Member[]; memberMeshes: THREE.Mesh[]; memberLayers: Int32Array; memberPoses: Int32Array; memberSlots: Int32Array };

/** Whether a joint surface is under a pixel wherever its joints turn: its largest radius at its nearest depth. */
function boundedSubpixel(radius: number, near: number, stretch: number, projection: number, perspective: boolean): boolean {
  return radius * stretch * 2 * (projection / (perspective ? Math.max(.001, near) : 1)) < BOUNDED_SUBPIXEL;
}

/** Group surfaces by material for submission while each ship keeps its CPU pose, joint
 * hierarchy and decal receivers. Armor inspection retains rigid assemblies and
 * detail levels for its faint exterior, using that ship's translucent materials.
 * Mask only the source surface so its impact-mark children still draw. Each ship's
 * retained hierarchy is indexed (`subtrees`) so its visibility is read once per frame and
 * the renderer can skip the subtrees these masks leave with nothing to draw.
 *
 * The batch is the only reader of its surfaces' poses while it draws them, so it defers them (`ShipPoseMatrices.defer`)
 * and composes each one it uses. A surface on a joint (a gun, a mount, a radar) whose bounds for any joint angles already
 * put it under a pixel is culled without its pose, where its pose would cull it too; an original surface drawn in its
 * place and a joined assembly's moving owner are always composed, and ShipView composes a scarred surface for its marks.
 *
 * Each frame walks its sources through flat arrays in batch order (`Flat`), so the walk streams through memory instead of
 * visiting each source's objects, and forms a drawn surface's pose itself into one scratch array (the product `ensure`
 * would store, left undone in the surface, which only the batch reads), and skips a source's surfaces while nothing they
 * depend on has changed. `flat` off walks the source and surface objects instead, for comparison. */
export class FleetShipDraws {
  /** Off: the walk over the source and surface objects, composing each drawn pose in its surface, for comparison. */
  static flat = true;
  readonly root = new THREE.Group();
  readonly subtrees = new SubtreeLayers();
  private batches: Batch[] = [];
  private readonly ships: Ship[] = [];
  private proxies = new Map<ShipView, ShipRenderProxy>();
  private readonly assemblies = new ShipRenderAssemblies();
  private visibleInstances = 0;
  private reducedInstances = 0;
  private subpixelInstances = 0;
  private readonly visibility = new Map<THREE.Object3D, boolean>();
  private readonly flatSources: Flat;
  /** Which walk's representation holds the state kept between frames (levels and slots). */
  private walking = true;
  /** The pose being drawn, as a double array like a matrix's elements. */
  private readonly pose = Array.from({ length: 16 }, () => .5);
  constructor(views: readonly ShipView[]) {
    this.root.name = 'Fleet ship surfaces';
    const groups = new Map<string, { material: THREE.Material; sources: Source[] }>();
    for (const view of views) {
      const ship: Ship = { view, poses: view.poseMatrices, subtree: this.subtrees.add(view.root), members: [], slots: -1, active: false, batched: false, armor: false, layersChanged: false,
        pivots: new Float64Array(0), depths: new Float64Array(0), bounded: false, spread: 0, stretch: 0, hidden: false, steady: false, visibility: -1,
        index: this.ships.length, memberIds: [], joinVisibility: -1, joinSlots: -1, joinMode: -1, known: false };
      this.ships.push(ship);
      for (const assembly of this.assemblies.build(view)) {
        const { mesh, material } = assembly;
        // Keep procedural routes in their original draw, including every instance matrix.
        if (material.transparent || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.morphTargetInfluences?.length) continue;
        const layout = Object.entries(mesh.geometry.attributes).map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('/');
        const key = `${material.uuid}:${!!mesh.geometry.index}:${layout}:${mesh.layers.mask}:${mesh.renderOrder}:${mesh.castShadow}:${mesh.receiveShadow}`;
        let group = groups.get(key);
        if (!group) groups.set(key, group = { material, sources: [] });
        group.sources.push({ ...assembly, members: assembly.members.map(member => ({ ...member, slot: -1, pose: ship.poses.indexOf(member.mesh) })), ship, view, layers: mesh.layers.mask, level: 0,
          pose: assembly.owner ? -1 : ship.poses.indexOf(mesh), ownerPose: assembly.owner ? ship.poses.indexOf(assembly.owner) : -1, index: -1 });
      }
    }
    const kept = [...groups.values()].filter(({ sources }) => sources.length >= 2 || !!sources[0].owner), total = kept.reduce((n, { sources }) => n + sources.length, 0);
    const anchors = new Int32Array(total).fill(-1), reaches = new Float64Array(total), radii = new Float64Array(total), settled = new Uint8Array(total);
    let offset = 0;
    for (const { material, sources } of kept) {
      const first = sources[0].mesh;
      const geometries = [...new Set(sources.flatMap(s => shipDetailLevels(s.mesh.geometry).map(level => level.geometry)))];
      const vertices = geometries.reduce((n, g) => n + g.attributes.position.count, 0);
      const indices = geometries.reduce((n, g) => n + (g.index?.count ?? 0), 0);
      const mesh = new FleetBatch(sources.length, vertices, indices, material);
      const ids = new Map(geometries.map(g => [g, mesh.addGeometry(g)]));
      for (const source of sources) {
        source.levels = shipDetailLevels(source.mesh.geometry).map(level => ({ id: ids.get(level.geometry)!, error: level.error }));
        source.instance = mesh.addInstance(source.levels[0].id);
        if (!source.mesh.geometry.boundingSphere) source.mesh.geometry.computeBoundingSphere();
        source.ship.members.push(...source.members);
      }
      // Retain independent camera/shadow culling for every original surface.
      mesh.frustumCulled = false; mesh.perObjectFrustumCulled = true; mesh.sortObjects = false;
      mesh.name = first.name; mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      mesh.layers.mask = first.layers.mask; mesh.renderOrder = first.renderOrder;
      // Views add their sources in turn, so each ship's are consecutive.
      const ranges: Batch['ranges'] = [];
      sources.forEach((source, i) => { if (ranges.at(-1)?.ship === source.ship) ranges.at(-1)!.end = i + 1; else ranges.push({ ship: source.ship, start: i, end: i + 1 }); });
      const spans = Int32Array.from(ranges.flatMap(({ ship, start, end }) => [ship.index, start, end])), at = offset, end = offset += sources.length;
      this.root.add(mesh);
      this.batches.push({ mesh, sources, ranges, first: at, spans, anchors: anchors.subarray(at, end), reaches: reaches.subarray(at, end), radii: radii.subarray(at, end), settled: settled.subarray(at, end) });
    }
    for (const ship of this.ships) if (ShipRenderProxy.supports(ship.view)) {
      const proxy = ship.proxy = new ShipRenderProxy(ship.view);
      this.proxies.set(ship.view, proxy); this.root.add(proxy.root);
    }
    // Defer every batched surface's pose. A single surface on a joint is also bounded from its top joint's pivot.
    const deferred = new Map<Ship, THREE.Object3D[]>(), pivots = new Map<Ship, { slots: Map<number, number>; points: number[] }>();
    for (const { sources, anchors, reaches, radii } of this.batches) sources.forEach((source, k) => {
      const ship = source.ship, list = deferred.get(ship) ?? deferred.set(ship, []).get(ship)!;
      list.push(...source.members.map(member => member.mesh));
      if (source.pose < 0) return;
      const bounds = source.mesh.geometry.boundingSphere!, reach = ship.poses.reach(source.pose, bounds.center, bounds.radius);
      if (reach.anchor < 0) return;
      const { slots, points } = pivots.get(ship) ?? pivots.set(ship, { slots: new Map(), points: [] }).get(ship)!;
      let slot = slots.get(reach.anchor);
      if (slot === undefined) { slots.set(reach.anchor, slot = slots.size); points.push(reach.pivot.x, reach.pivot.y, reach.pivot.z); }
      anchors[k] = slot; reaches[k] = reach.reach; radii[k] = reach.radius;
    });
    for (const ship of this.ships) {
      ship.poses.defer(deferred.get(ship) ?? []);
      ship.pivots = Float64Array.from(pivots.get(ship)?.points ?? []); ship.depths = new Float64Array(ship.pivots.length / 3);
    }
    this.flatSources = this.flatten(anchors, reaches, radii, settled);
  }

  /** The flat arrays (`Flat`), from the batches' sources in batch order. */
  private flatten(anchors: Int32Array, reaches: Float64Array, radii: Float64Array, settled: Uint8Array): Flat {
    const sources = this.batches.flatMap(batch => batch.sources.map((source, k) => {
      // A fresh batch numbers its instances in order: the walk takes a source's index in its batch as its instance.
      if (source.instance !== k) throw new Error(`Fleet batch ${batch.mesh.name} numbered instance ${k} as ${source.instance}`);
      return source;
    }));
    const n = sources.length, members = sources.flatMap(source => source.members), levels = sources.flatMap(source => source.levels!);
    const flat: Flat = { sources, meshes: sources.map(s => s.mesh), owners: sources.map(s => s.owner), ownerPoses: Int32Array.from(sources, s => s.ownerPose),
      poses: Int32Array.from(sources, s => s.pose), formed: new Uint8Array(n), parents: new Int32Array(n).fill(-1), parentElements: [], offsets: new Float64Array(n * 16),
      spheres: new Float64Array(n * 4), levelFirst: new Int32Array(n + 1), levelErrors: Float64Array.from(levels, l => l.error), levelIds: Int32Array.from(levels, l => l.id),
      levels: new Int32Array(n), anchors, reaches, radii, settled, contexts: sources.map(s => s.armorContext), joined: new Uint8Array(n),
      memberFirst: new Int32Array(n + 1), members, memberMeshes: members.map(m => m.mesh), memberLayers: Int32Array.from(members, m => m.layers),
      memberPoses: Int32Array.from(members, m => m.pose), memberSlots: Int32Array.from(members, m => m.slot) };
    const unposed: number[] = [];
    for (let g = 0, level = 0, member = 0; g < n; g++) {
      const source = sources[g], poses = source.ship.poses, sphere = source.mesh.geometry.boundingSphere!;
      source.index = g;
      flat.spheres.set([sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius], g * 4);
      flat.levelFirst[g] = level; level += source.levels!.length; flat.levels[g] = source.level;
      flat.memberFirst[g] = member;
      for (let i = 0; i < source.members.length; i++) source.ship.memberIds.push(member++);
      flat.levelFirst[g + 1] = level; flat.memberFirst[g + 1] = member;
      if (!source.owner && source.pose >= 0 && !poses.poses[source.pose].moving) {
        const { parent, parentElements, offset } = poses.composition(source.pose);
        flat.formed[g] = 1; flat.parents[g] = parent; flat.offsets.set(offset, g * 16); flat.parentElements.push(parentElements);
      } else flat.parentElements.push(unposed);
    }
    return flat;
  }

  /** Call after interpolating all hull/joint matrices and choosing view visibility. */
  /** `detailBudgetPx` is the projected surface error a reduced level may show;
   * a level already in use keeps a 40% wider budget so silhouettes stay stable. */
  update(camera?: THREE.Camera, framebufferHeight = 1080, detailBudgetPx = 1.25): void {
    const flat = FleetShipDraws.flat;
    if (flat !== this.walking) this.adopt(flat);
    if (flat) this.updateFlat(camera, framebufferHeight, detailBudgetPx);
    else this.updateObjects(camera, framebufferHeight, detailBudgetPx);
  }

  /** Hand the state kept between frames to the other walk: each source's level and each surface's slot. */
  adopt(flat: boolean): void {
    const { sources, levels, members, memberSlots } = this.flatSources;
    if (flat) {
      for (let g = 0; g < sources.length; g++) levels[g] = sources[g].level;
      for (let m = 0; m < members.length; m++) memberSlots[m] = members[m].slot;
      for (const ship of this.ships) ship.joinMode = -1;
    } else {
      for (let g = 0; g < sources.length; g++) sources[g].level = levels[g];
      for (let m = 0; m < members.length; m++) members[m].slot = memberSlots[m];
    }
    this.walking = flat;
  }

  /** The source and surface objects' walk (see `flat`). */
  private updateObjects(camera?: THREE.Camera, framebufferHeight = 1080, detailBudgetPx = 1.25): void {
    this.visibleInstances = 0; this.reducedInstances = 0; this.subpixelInstances = 0;
    this.visibility.clear();
    this.subtrees.refresh();
    const projection = camera ? Math.abs(camera.projectionMatrix.elements[5]) * framebufferHeight * .5 : 0;
    const perspective = !!(camera as THREE.PerspectiveCamera | undefined)?.isPerspectiveCamera, inverse = camera?.matrixWorldInverse.elements;
    // Bounds stand in for poses only under an affine view (an inverted one keeps a last row of 0, 0, 0 and nearly 1).
    const bounding = ShipPoseMatrices.deferring && !!inverse && inverse[3] === 0 && inverse[7] === 0 && inverse[11] === 0 && inverse[15] > 0;
    for (const ship of this.ships) {
      const view = ship.view, mode = view.inspection.mode;
      ship.active = view.renderActive !== false; ship.batched = mode === 'exterior'; ship.armor = mode === 'armor'; ship.bounded = false; ship.steady = false;
      if (!ship.active) continue;
      const subtree = ship.subtree;
      let steady = !ship.hidden;
      if (ship.slots !== subtree.version) { for (const member of ship.members) member.slot = subtree.slotOf(member.mesh); ship.slots = subtree.version; steady = false; }
      if (ship.batched || ship.armor) subtree.updateVisibility(ship.proxy && view.model, ship.proxy?.modelVisible);
      if (bounding && (ship.batched || ship.armor) && ship.depths.length && ship.poses.bounded) this.bound(ship, inverse!);
      // Settled surfaces stand while their hull stays in view and exterior, its slots and chain visibility unchanged.
      ship.steady = steady && ship.bounded && ship.batched && subtree.visibleVersion === ship.visibility;
      ship.visibility = subtree.visibleVersion;
    }
    for (const { mesh, sources, ranges, anchors, reaches, radii, settled } of this.batches) {
      mesh.invalidateDrawList();
      const infos = (mesh as unknown as BatchState)._instanceInfo;
      let count = 0;
      for (const { ship, start, end } of ranges) {
        if (!ship.active) {
          // A hull out of view hides its instances once: only this loop shows them again.
          if (!ship.hidden) for (let k = start; k < end; k++) { const source = sources[k]; if (source.armorContext) source.armorContext.visible = false; mesh.setVisibleAt(source.instance!, false); }
          continue;
        }
        const batched = ship.batched, armor = ship.armor, read = ship.subtree.own, chain = ship.subtree.visible, poses = ship.poses;
        const steady = ship.steady, depths = ship.depths, spread = ship.spread, stretch = ship.stretch;
        for (let k = start; k < end; k++) {
          if (steady && settled[k] === 1 && boundedSubpixel(radii[k], depths[anchors[k]] - spread * reaches[k], stretch, projection, perspective)) { this.subpixelInstances++; continue; }
          const source = sources[k], members = source.members, anchor = anchors[k];
          if (source.armorContext) source.armorContext.visible = false;
          let together = batched || armor;
          for (let i = 0; together && i < members.length; i++) { const member = members[i]; together = member.slot >= 0 ? chain[member.slot] === 1 : this.surfaceVisible(ship, member); }
          // A hidden component or another inspection mode falls back to original surfaces.
          for (const member of members) {
            const layers = together ? 0 : member.layers;
            if (member.mesh.layers.mask !== layers) member.mesh.layers.mask = layers;
            if (member.slot >= 0 && read[member.slot] !== layers) ship.layersChanged = true;
            // An original surface drawn in the batch's place reads its own pose.
            if (!together) poses.ensure(member.pose);
          }
          let visible = together, level = 0, settles = false;
          const matrixWorld = source.mesh.matrixWorld;
          // The nearest the sphere can be and the largest it can be, for any joint angles: under 1.5 px there, it is under 1.5 px.
          if (visible && ship.bounded && anchor >= 0 && boundedSubpixel(radii[k], depths[anchor] - spread * reaches[k], stretch, projection, perspective)) {
            visible = false; this.subpixelInstances++; settles = batched && members[0].slot >= 0;
          }
          settled[k] = settles ? 1 : 0;
          if (source.owner) { if (source.ownerPose >= 0) poses.ensure(source.ownerPose); matrixWorld.copy(source.owner.matrixWorld); }
          else if (visible) poses.ensure(source.pose);
          if (visible && inverse) {
            // The bounding sphere in world space and its view depth, as Sphere and Vector3.applyMatrix4 compute them.
            const bounds = source.mesh.geometry.boundingSphere!, e = matrixWorld.elements, x = bounds.center.x, y = bounds.center.y, z = bounds.center.z;
            const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
            const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w, cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
            const scale = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
            const radius = bounds.radius * scale, v = inverse;
            // Nearest depth on the bounding sphere is conservative, including zoom
            // and viewport resolution. Never reduce geometry crossing the camera.
            const viewDepth = -((v[2] * cx + v[6] * cy + v[10] * cz + v[14]) * (1 / (v[3] * cx + v[7] * cy + v[11] * cz + v[15])));
            const pixelsPerMetre = projection / (perspective ? Math.max(.001, viewDepth - radius) : 1);
            if (radius * 2 * pixelsPerMetre < 1.5) { visible = false; this.subpixelInstances++; }
            else {
              const levels = source.levels!;
              for (let i = 1; i < levels.length; i++) {
                // Hysteresis keeps a stationary silhouette stable near a threshold.
                const budget = i <= source.level ? detailBudgetPx * 1.4 : detailBudgetPx;
                if (levels[i].error * scale * pixelsPerMetre <= budget) level = i;
              }
            }
          }
          if (level !== source.level) { mesh.setGeometryIdAt(source.instance!, source.levels![level].id); source.level = level; }
          // An unchanged instance would leave setVisibleAt nothing to do.
          if (infos[source.instance!].visible !== (visible && batched)) mesh.setVisibleAt(source.instance!, visible && batched);
          if (visible && batched) { mesh.writePose(source.instance!, matrixWorld.elements); count++; if (level > 0) this.reducedInstances++; }
          if (visible && armor) {
            // Reuse prepared buffers; the exact inspection plates and pick meshes
            // remain separate. Do not expand this context back into authoring parts.
            const context = source.armorContext ??= this.createArmorContext(source);
            context.geometry = shipDetailLevels(source.mesh.geometry)[level].geometry;
            context.matrix.copy(matrixWorld); context.matrixWorldNeedsUpdate = true;
            context.visible = true;
          }
        }
      }
      mesh.commitPoses();
      mesh.visible = count > 0; this.visibleInstances += count;
    }
    for (const ship of this.ships) ship.hidden = !ship.active;
    for (const ship of this.ships) if (ship.layersChanged) { ship.layersChanged = false; this.subtrees.layersChanged(ship.subtree); }
    this.subtrees.refresh();
    for (const { view, proxy } of this.ships) if (proxy) {
      proxy.root.visible = view.renderActive !== false;
      if (proxy.root.visible) proxy.update(camera, framebufferHeight, this.visibility);
    }
  }

  /** The flat walk: `updateObjects`, operation for operation, over `Flat` in batch order. A drawn surface's pose is formed in
   * `pose` from its parent's matrix and its offset as `ensure` forms it (one it already holds this frame is read from it), and
   * a source whose surfaces were `joined` while its ship is `known` skips them: they are all in view with layers 0, and the
   * subtree's layers read 0 for them (it rereads layers after every change the walk reports, and nothing else sets them). */
  private updateFlat(camera?: THREE.Camera, framebufferHeight = 1080, detailBudgetPx = 1.25): void {
    this.visibleInstances = 0; this.reducedInstances = 0; this.subpixelInstances = 0;
    this.visibility.clear();
    this.subtrees.refresh();
    const projection = camera ? Math.abs(camera.projectionMatrix.elements[5]) * framebufferHeight * .5 : 0;
    const perspective = !!(camera as THREE.PerspectiveCamera | undefined)?.isPerspectiveCamera, inverse = camera?.matrixWorldInverse.elements;
    const bounding = ShipPoseMatrices.deferring && !!inverse && inverse[3] === 0 && inverse[7] === 0 && inverse[11] === 0 && inverse[15] > 0;
    const flat = this.flatSources, { memberMeshes, memberSlots } = flat;
    for (const ship of this.ships) {
      const view = ship.view, mode = view.inspection.mode;
      ship.active = view.renderActive !== false; ship.batched = mode === 'exterior'; ship.armor = mode === 'armor'; ship.bounded = false; ship.steady = false;
      if (!ship.active) continue;
      const subtree = ship.subtree;
      let steady = !ship.hidden;
      if (ship.slots !== subtree.version) {
        for (const m of ship.memberIds) memberSlots[m] = subtree.slotOf(memberMeshes[m]);
        ship.slots = subtree.version; steady = false;
      }
      if (ship.batched || ship.armor) subtree.updateVisibility(ship.proxy && view.model, ship.proxy?.modelVisible);
      if (bounding && (ship.batched || ship.armor) && ship.depths.length && ship.poses.bounded) this.bound(ship, inverse!);
      ship.steady = steady && ship.bounded && ship.batched && subtree.visibleVersion === ship.visibility;
      ship.visibility = subtree.visibleVersion;
      const joinMode = ship.batched ? 1 : ship.armor ? 2 : 0;
      ship.known = !ship.hidden && ship.joinVisibility === subtree.visibleVersion && ship.joinSlots === subtree.version && ship.joinMode === joinMode;
      ship.joinVisibility = subtree.visibleVersion; ship.joinSlots = subtree.version; ship.joinMode = joinMode;
    }
    const { meshes, owners, ownerPoses, poses: sourcePoses, formed, parents, parentElements, offsets, spheres, levelFirst, levelErrors, levelIds, levels,
      anchors, reaches, radii, settled, contexts, joined } = flat;
    const e = this.pose, ships = this.ships;
    for (const { mesh, first, spans } of this.batches) {
      mesh.invalidateDrawList();
      const infos = (mesh as unknown as BatchState)._instanceInfo;
      let count = 0;
      for (let r = 0; r < spans.length; r += 3) {
        const ship = ships[spans[r]], start = first + spans[r + 1], end = first + spans[r + 2];
        if (!ship.active) {
          if (!ship.hidden) for (let g = start; g < end; g++) { const context = contexts[g]; if (context) context.visible = false; mesh.setVisibleAt(g - first, false); }
          continue;
        }
        const batched = ship.batched, armor = ship.armor, poses = ship.poses, known = ship.known, bounded = ship.bounded;
        const steady = ship.steady, depths = ship.depths, spread = ship.spread, stretch = ship.stretch;
        for (let g = start; g < end; g++) {
          if (steady && settled[g] === 1 && boundedSubpixel(radii[g], depths[anchors[g]] - spread * reaches[g], stretch, projection, perspective)) { this.subpixelInstances++; continue; }
          const anchor = anchors[g], context = contexts[g], k = g - first;
          if (context) context.visible = false;
          const together = known && joined[g] === 1 || this.join(ship, g, batched || armor);
          let visible = together, level = 0, settles = false;
          if (visible && bounded && anchor >= 0 && boundedSubpixel(radii[g], depths[anchor] - spread * reaches[g], stretch, projection, perspective)) {
            visible = false; this.subpixelInstances++; settles = batched && memberSlots[flat.memberFirst[g]] >= 0;
          }
          settled[g] = settles ? 1 : 0;
          const owner = owners[g];
          if (owner) {
            const ownerPose = ownerPoses[g];
            if (ownerPose >= 0) poses.ensure(ownerPose);
            meshes[g].matrixWorld.copy(owner.matrixWorld);
            if (visible) copy(owner.matrixWorld.elements, e);
          } else if (visible) {
            const pose = sourcePoses[g];
            if (formed[g] === 1 && !poses.current(pose)) { poses.ensure(parents[g]); multiplyAt(parentElements[g], offsets, g * 16, e); }
            else { poses.ensure(pose); copy(meshes[g].matrixWorld.elements, e); }
          }
          if (visible && inverse) {
            const s = g * 4, x = spheres[s], y = spheres[s + 1], z = spheres[s + 2];
            const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
            const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w, cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
            const scale = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
            const radius = spheres[s + 3] * scale, v = inverse;
            const viewDepth = -((v[2] * cx + v[6] * cy + v[10] * cz + v[14]) * (1 / (v[3] * cx + v[7] * cy + v[11] * cz + v[15])));
            const pixelsPerMetre = projection / (perspective ? Math.max(.001, viewDepth - radius) : 1);
            if (radius * 2 * pixelsPerMetre < 1.5) { visible = false; this.subpixelInstances++; }
            else {
              const from = levelFirst[g], n = levelFirst[g + 1] - from, current = levels[g];
              for (let i = 1; i < n; i++) {
                const budget = i <= current ? detailBudgetPx * 1.4 : detailBudgetPx;
                if (levelErrors[from + i] * scale * pixelsPerMetre <= budget) level = i;
              }
            }
          }
          if (level !== levels[g]) { mesh.setGeometryIdAt(k, levelIds[levelFirst[g] + level]); levels[g] = level; }
          const drawn = visible && batched;
          if (infos[k].visible !== drawn) mesh.setVisibleAt(k, drawn);
          if (drawn) { mesh.writePose(k, e); count++; if (level > 0) this.reducedInstances++; }
          if (visible && armor) {
            const source = flat.sources[g], context = source.armorContext ??= this.createArmorContext(source);
            context.geometry = shipDetailLevels(source.mesh.geometry)[level].geometry;
            context.matrix.fromArray(e); context.matrixWorldNeedsUpdate = true;
            context.visible = true;
          }
        }
      }
      mesh.commitPoses();
      mesh.visible = count > 0; this.visibleInstances += count;
    }
    for (const ship of this.ships) ship.hidden = !ship.active;
    for (const ship of this.ships) if (ship.layersChanged) { ship.layersChanged = false; this.subtrees.layersChanged(ship.subtree); }
    this.subtrees.refresh();
    for (const { view, proxy } of this.ships) if (proxy) {
      proxy.root.visible = view.renderActive !== false;
      if (proxy.root.visible) proxy.update(camera, framebufferHeight, this.visibility);
    }
  }

  /** Whether source `g`'s surfaces draw together (`open`: its ship draws batched or in armor), with each one's layers set for
   * that and, where they draw alone, its pose composed; `joined` notes it for the frames its ship stays `known`. */
  private join(ship: Ship, g: number, open: boolean): boolean {
    const { memberFirst, memberMeshes, memberLayers, memberPoses, memberSlots, joined } = this.flatSources;
    const first = memberFirst[g], last = memberFirst[g + 1], chain = ship.subtree.visible, read = ship.subtree.own;
    let together = open, indexed = true;
    for (let m = first; together && m < last; m++) { const slot = memberSlots[m]; together = slot >= 0 ? chain[slot] === 1 : this.surfaceVisibleAt(ship, memberMeshes[m], slot); }
    for (let m = first; m < last; m++) {
      const layers = together ? 0 : memberLayers[m], slot = memberSlots[m], mesh = memberMeshes[m];
      if (mesh.layers.mask !== layers) mesh.layers.mask = layers;
      if (slot < 0) indexed = false;
      else if (read[slot] !== layers) ship.layersChanged = true;
      if (!together) ship.poses.ensure(memberPoses[m]);
    }
    joined[g] = together && indexed ? 1 : 0;
    return together;
  }

  /** View depth of each pivot this frame, and how far a root-space reach and radius can stretch in the world. */
  private bound(ship: Ship, v: ArrayLike<number>): void {
    const r = ship.view.root.matrixWorld.elements;
    if (r[3] !== 0 || r[7] !== 0 || r[11] !== 0 || r[15] !== 1) return;
    // Depth of R·p is -(v2 x + v6 y + v10 z + v14) / v15 at (x, y, z) = R·p: a dot product with the depth axis in the root's space.
    const w = 1 / v[15], ax = -(v[2] * r[0] + v[6] * r[1] + v[10] * r[2]) * w, ay = -(v[2] * r[4] + v[6] * r[5] + v[10] * r[6]) * w, az = -(v[2] * r[8] + v[6] * r[9] + v[10] * r[10]) * w;
    const d = -(v[2] * r[12] + v[6] * r[13] + v[10] * r[14] + v[14]) * w;
    const pivots = ship.pivots, depths = ship.depths;
    for (let k = 0, o = 0; k < depths.length; k++, o += 3) depths[k] = ax * pivots[o] + ay * pivots[o + 1] + az * pivots[o + 2] + d;
    ship.stretch = operatorNorm(r) * BOUND_MARGIN;
    ship.spread = ship.stretch * Math.max(1, Math.hypot(v[2], v[6], v[10]) * w) * BOUND_MARGIN;
    ship.bounded = true;
  }
  /** The surface and all its ancestors are visible; the ship's proxy stands in for a model it hides. */
  private surfaceVisible(ship: Ship, member: Member): boolean { return this.surfaceVisibleAt(ship, member.mesh, member.slot); }
  private surfaceVisibleAt(ship: Ship, mesh: THREE.Mesh, slot: number): boolean {
    if (slot >= 0) return ship.subtree.visible[slot] === 1;
    if (ship.proxy) return ship.proxy.sourceVisible(mesh, this.visibility);
    for (let ancestor: THREE.Object3D | null = mesh; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return false;
    return true;
  }
  private createArmorContext(source: Source): THREE.Mesh {
    const context = new THREE.Mesh(source.mesh.geometry, source.members[0].mesh.material);
    context.name = `${source.mesh.name} armor context`; context.matrixAutoUpdate = false;
    context.layers.mask = source.layers; context.renderOrder = source.mesh.renderOrder;
    context.castShadow = source.mesh.castShadow; context.receiveShadow = source.mesh.receiveShadow;
    this.flatSources.contexts[source.index] = context;
    this.root.add(context);
    return context;
  }
  diagnostics() { return { batches: this.batches.length, instances: this.visibleInstances, reduced: this.reducedInstances, subpixel: this.subpixelInstances }; }
  dispose(): void {
    for (const ship of this.ships) ship.poses.defer([]);
    this.subtrees.dispose();
    this.proxies.forEach(proxy => proxy.dispose()); this.proxies.clear();
    for (const { mesh, sources } of this.batches) {
      sources.forEach(s => s.members.forEach(member => member.mesh.layers.mask = member.layers));
      mesh.dispose(); // Disposes only the combined buffers and transform textures, not template materials.
    }
    this.batches.length = 0; this.ships.length = 0; this.root.clear(); this.root.removeFromParent();
    this.assemblies.dispose();
  }
}

/** A matrix's elements into the pose array. */
function copy(from: number[], to: number[]): void { for (let i = 0; i < 16; i++) to[i] = from[i]; }

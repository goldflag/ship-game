import * as THREE from 'three/webgpu';
import type { ShipView } from './ShipView';
import { shipDetailLevels } from './ShipDetail';
import { ShipRenderProxy } from './ShipRenderProxy';
import { FleetBatch } from './FleetBatch';
import { ShipRenderAssemblies, type RenderAssembly } from './ShipRenderAssemblies';
import { SubtreeLayers, type Subtree } from './SubtreeLayers';

/** An original surface of a batched source, with its slot in the ship's subtree index (-1 when outside it). */
type Member = { mesh: THREE.Mesh; layers: number; slot: number };
/** Per ship and frame: whether it draws, its inspection mode, and its surfaces' chain visibility. */
type Ship = { view: ShipView; subtree: Subtree; proxy?: ShipRenderProxy; members: Member[]; slots: number; active: boolean; batched: boolean; armor: boolean; layersChanged: boolean };
type Source = Omit<RenderAssembly, 'members'> & { ship: Ship; view: ShipView; members: Member[]; layers: number; instance?: number; levels?: { id: number; error: number }[]; level: number; armorContext?: THREE.Mesh };
type Batch = { mesh: FleetBatch; sources: Source[] };

/** Group surfaces by material for submission while each ship keeps its CPU pose, joint
 * hierarchy and decal receivers. Armor inspection retains rigid assemblies and
 * detail levels for its faint exterior, using that ship's translucent materials.
 * Mask only the source surface so its impact-mark children still draw. Each ship's
 * retained hierarchy is indexed (`subtrees`) so its visibility is read once per frame and
 * the renderer can skip the subtrees these masks leave with nothing to draw. */
export class FleetShipDraws {
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
  constructor(views: readonly ShipView[]) {
    this.root.name = 'Fleet ship surfaces';
    const groups = new Map<string, { material: THREE.Material; sources: Source[] }>();
    for (const view of views) {
      const ship: Ship = { view, subtree: this.subtrees.add(view.root), members: [], slots: -1, active: false, batched: false, armor: false, layersChanged: false };
      this.ships.push(ship);
      for (const assembly of this.assemblies.build(view)) {
        const { mesh, material } = assembly;
        // Keep procedural routes in their original draw, including every instance matrix.
        if (material.transparent || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.morphTargetInfluences?.length) continue;
        const layout = Object.entries(mesh.geometry.attributes).map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('/');
        const key = `${material.uuid}:${!!mesh.geometry.index}:${layout}:${mesh.layers.mask}:${mesh.renderOrder}:${mesh.castShadow}:${mesh.receiveShadow}`;
        let group = groups.get(key);
        if (!group) groups.set(key, group = { material, sources: [] });
        group.sources.push({ ...assembly, members: assembly.members.map(member => ({ ...member, slot: -1 })), ship, view, layers: mesh.layers.mask, level: 0 });
      }
    }
    for (const { material, sources } of groups.values()) {
      if (sources.length < 2 && !sources[0].owner) continue;
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
      this.root.add(mesh); this.batches.push({ mesh, sources });
    }
    for (const ship of this.ships) if (ShipRenderProxy.supports(ship.view)) {
      const proxy = ship.proxy = new ShipRenderProxy(ship.view);
      this.proxies.set(ship.view, proxy); this.root.add(proxy.root);
    }
  }
  /** Call after interpolating all hull/joint matrices and choosing view visibility. */
  /** `detailBudgetPx` is the projected surface error a reduced level may show;
   * a level already in use keeps a 40% wider budget so silhouettes stay stable. */
  update(camera?: THREE.Camera, framebufferHeight = 1080, detailBudgetPx = 1.25): void {
    this.visibleInstances = 0; this.reducedInstances = 0; this.subpixelInstances = 0;
    this.visibility.clear();
    this.subtrees.refresh();
    for (const ship of this.ships) {
      const view = ship.view, mode = view.inspection.mode;
      ship.active = view.renderActive !== false; ship.batched = mode === 'exterior'; ship.armor = mode === 'armor';
      if (!ship.active) continue;
      const subtree = ship.subtree;
      if (ship.slots !== subtree.version) { for (const member of ship.members) member.slot = subtree.slotOf(member.mesh); ship.slots = subtree.version; }
      if (ship.batched || ship.armor) subtree.updateVisibility(ship.proxy && view.model, ship.proxy?.modelVisible);
    }
    const projection = camera ? Math.abs(camera.projectionMatrix.elements[5]) * framebufferHeight * .5 : 0;
    const perspective = !!(camera as THREE.PerspectiveCamera | undefined)?.isPerspectiveCamera, inverse = camera?.matrixWorldInverse.elements;
    for (const { mesh, sources } of this.batches) {
      mesh.invalidateDrawList();
      let count = 0;
      for (const source of sources) {
        if (source.armorContext) source.armorContext.visible = false;
        const ship = source.ship, members = source.members;
        if (!ship.active) { mesh.setVisibleAt(source.instance!, false); continue; }
        const batched = ship.batched, armor = ship.armor;
        let together = batched || armor;
        for (let i = 0; together && i < members.length; i++) together = this.surfaceVisible(ship, members[i]);
        // A hidden component or another inspection mode falls back to original surfaces.
        const read = ship.subtree.own;
        for (const member of members) {
          const layers = together ? 0 : member.layers;
          if (member.mesh.layers.mask !== layers) member.mesh.layers.mask = layers;
          if (member.slot >= 0 && read[member.slot] !== layers) ship.layersChanged = true;
        }
        let visible = together;
        const matrixWorld = source.mesh.matrixWorld;
        if (source.owner) matrixWorld.copy(source.owner.matrixWorld);
        let level = 0;
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
        mesh.setVisibleAt(source.instance!, visible && batched);
        if (visible && batched) { mesh.setMatrixAt(source.instance!, matrixWorld); count++; if (level > 0) this.reducedInstances++; }
        if (visible && armor) {
          // Reuse prepared buffers; the exact inspection plates and pick meshes
          // remain separate. Do not expand this context back into authoring parts.
          const context = source.armorContext ??= this.createArmorContext(source);
          context.geometry = shipDetailLevels(source.mesh.geometry)[level].geometry;
          context.matrix.copy(matrixWorld); context.matrixWorldNeedsUpdate = true;
          context.visible = true;
        }
      }
      mesh.visible = count > 0; this.visibleInstances += count;
    }
    for (const ship of this.ships) if (ship.layersChanged) { ship.layersChanged = false; this.subtrees.layersChanged(ship.subtree); }
    this.subtrees.refresh();
    for (const { view, proxy } of this.ships) if (proxy) {
      proxy.root.visible = view.renderActive !== false;
      if (proxy.root.visible) proxy.update(camera, framebufferHeight, this.visibility);
    }
  }
  /** The surface and all its ancestors are visible; the ship's proxy stands in for a model it hides. */
  private surfaceVisible(ship: Ship, member: Member): boolean {
    if (member.slot >= 0) return ship.subtree.visible[member.slot] === 1;
    if (ship.proxy) return ship.proxy.sourceVisible(member.mesh, this.visibility);
    for (let ancestor: THREE.Object3D | null = member.mesh; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return false;
    return true;
  }
  private createArmorContext(source: Source): THREE.Mesh {
    const context = new THREE.Mesh(source.mesh.geometry, source.members[0].mesh.material);
    context.name = `${source.mesh.name} armor context`; context.matrixAutoUpdate = false;
    context.layers.mask = source.layers; context.renderOrder = source.mesh.renderOrder;
    context.castShadow = source.mesh.castShadow; context.receiveShadow = source.mesh.receiveShadow;
    this.root.add(context);
    return context;
  }
  diagnostics() { return { batches: this.batches.length, instances: this.visibleInstances, reduced: this.reducedInstances, subpixel: this.subpixelInstances }; }
  dispose(): void {
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

import { selectedWeapon } from '../ships/weaponGroups';
import { torpedoSpeed } from '../ships/mobility';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicNodeMaterial, LineSegments, Mesh, MeshBasicNodeMaterial, type Object3D } from 'three/webgpu';
import { attribute, cameraPosition, float, modelWorldMatrix, positionLocal, vec3, vec4 } from 'three/tsl';
import type { OceanApi } from './ocean/contracts';
import type { Vec3 } from '../ships/blueprint';
import { localToWorld, radians, wrapAngle } from './geometry';
import { tubeLocalPosition, tubeSolution } from './torpedoAim';
import type { FleetActor, ShipState } from '../game/session/elements';
import type { TorpedoAimState } from './torpedoLead';

export function torpedoPreviewSectors(actor: FleetActor, aim: Vec3, pose: ShipState = actor.motion, weaponGroupId?: string) {
  const seen = new Set<string>();
  const tubes = (actor.definition.torpedoTubes ?? []).filter(t => selectedWeapon('torpedo', t.weapon, 'torpedo', weaponGroupId));
  return tubes.flatMap(tube => {
    const key = tube.launcherId ?? String(tube.bearingDeg);
    if (seen.has(key)) return [];
    seen.add(key);
    const members = tubes.filter(t => (t.launcherId ?? String(t.bearingDeg)) === key);
    const candidates = members.map(t => {
      const state = { ...actor.torpedoTubes!.find(s => s.id === t.id)! };
      const solution = tubeSolution(actor, t, state, aim, 0);
      return { tube: t, state, solution };
    });
    const chosen = candidates.find(c => c.state.status === 'ready') ?? candidates.find(c => c.state.ammo > 0) ?? candidates[0];
    const launcher = actor.definition.torpedoLaunchers?.find(l => l.id === tube.launcherId);
    const arcs = launcher?.launchArcsDeg ?? [[tube.bearingDeg - tube.arcDeg, tube.bearingDeg + tube.arcDeg]];
    return arcs.map(([a, b]) => ({
      origin: localToWorld(tubeLocalPosition(actor, chosen.tube), pose),
      start: pose.heading + radians(a), end: pose.heading + radians(b),
      range: tube.weapon.rangeM, arming: tube.weapon.armingDistanceM, speed: torpedoSpeed(tube.weapon.speed),
      // Limit marks sit just clear of the hull at any size of ship.
      hull: actor.definition.hull.length,
      heading: chosen.solution.heading, aimDistance: chosen.solution.range, status: chosen.state.status, reload: chosen.state.reload,
      course: !['out-of-arc', 'disabled', 'empty', 'too-deep', 'above-water'].includes(chosen.state.status) && Math.abs(wrapAngle(chosen.solution.heading - actor.motion.heading - radians((a + b) / 2))) <= radians((b - a) / 2),
    }));
  });
}

export type TorpedoSector = ReturnType<typeof torpedoPreviewSectors>[number];
const RINGS = 48, COLUMNS = 4, SALVO_HALF = radians(1), OWN = '#86e4c5';
// Squared spacing keeps the near water following the swell and lets the far
// panels lengthen as perspective shortens them.
const ring = (i: number) => (i / RINGS) ** 2;

function geometry(positions: number[], fades: number[], index?: number[]): BufferGeometry {
  const made = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)).setAttribute('fade', new Float32BufferAttribute(fades, 1));
  if (index) made.setIndex(index);
  return made;
}
/** A unit surface over `columns` by RINGS panels; `at` places column c of ring distance r. */
function surface(columns: number, at: (c: number, r: number) => [number, number], thinning: number): BufferGeometry {
  const positions: number[] = [], fades: number[] = [], index: number[] = [];
  for (let i = 0; i <= RINGS; i++) for (let c = 0; c <= columns; c++) { const [x, z] = at(c / columns, ring(i)); positions.push(x, 0, z); fades.push(1 - thinning * ring(i)); }
  for (let i = 0; i < RINGS; i++) for (let c = 0; c < columns; c++) {
    const a = i * (columns + 1) + c, b = a + columns + 1;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return geometry(positions, fades, index);
}
/** Lines running out from the origin at each column position, optionally every other ring. */
function rays(columns: number[], at: (c: number, r: number) => [number, number], thinning: number, dashed = false): { positions: number[]; fades: number[] } {
  const positions: number[] = [], fades: number[] = [];
  for (const c of columns) for (let i = 0; i < RINGS; i++) {
    if (dashed && i % 2) continue;
    for (const r of [ring(i), ring(i + 1)]) { const [x, z] = at(c, r); positions.push(x, 0, z); fades.push(1 - thinning * r); }
  }
  return { positions, fades };
}
// A wedge points along -z and is one unit long and two wide at its end: its
// group's scale gives it a run and an angle.
const wedge = (c: number, r: number): [number, number] => [(c * 2 - 1) * r, -r];

/** Visual-only water overlay in the manner of a torpedo director: a faint sheet
 * over each launch arc, a wedge down the course the torpedoes will run, and a
 * pale wedge over every course that meets the target. Laying one wedge on the
 * other is the firing solution. Launch headings and eligibility come from the
 * CPU solution. */
export class TorpedoPreview {
  readonly root = new Group();
  private fills = {
    sheet: this.fill(OWN, .12), salvo: this.fill(OWN, .42), salvoSolved: this.fill(OWN, .6), arming: this.fill('#e8c56c', .5),
    lead: this.fill('#dfe6ea', .36), leadSolved: this.fill('#dfe6ea', .5),
  };
  private lines = {
    rim: this.line(OWN, .85), edge: this.line(OWN, 1), waiting: this.line(OWN, .55), blocked: this.line('#ee9b86', .85), centre: this.line(OWN, .55),
    bar: this.line('#ffffff', 1), barSolved: this.line(OWN, 1), leadEdge: this.line('#ffffff', .7),
  };
  private shapes = (() => {
    const edges = rays([0, 1], wedge, .3), dashes = rays([0, 1], wedge, .3, true), centre = rays([.5], wedge, .3);
    return {
      wedge: surface(COLUMNS, wedge, .5), edges: geometry(edges.positions, edges.fades), dashes: geometry(dashes.positions, dashes.fades),
      centre: geometry(centre.positions, centre.fades), sheets: new Map<number, { fill: BufferGeometry; rim: BufferGeometry }>(),
    };
  })();
  private salvos: { group: Group; fill: Mesh; arming: Mesh; edges: LineSegments; dashes: LineSegments; centre: LineSegments }[] = [];
  private sheets: { group: Group; fill: Mesh; rim: LineSegments }[] = [];
  private lead = { group: new Group(), fill: new Mesh(this.shapes.wedge, this.fills.lead), edges: new LineSegments(this.shapes.edges, this.lines.leadEdge), bar: new LineSegments(geometry(new Array(COLUMNS * 6).fill(0), new Array(COLUMNS * 2).fill(1)), this.lines.bar) };
  constructor() {
    this.root.visible = false;
    this.lead.group.add(this.adopt(this.lead.fill, 4), this.adopt(this.lead.edges, 6), this.adopt(this.lead.bar, 6));
    this.root.add(this.lead.group);
  }
  private fill(color: string, opacity: number): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ color, transparent: true, depthWrite: false, fog: false, side: DoubleSide });
    material.opacityNode = attribute<'float'>('fade', 'float').mul(opacity);
    return material;
  }
  private line(color: string, opacity: number): LineBasicNodeMaterial {
    const material = new LineBasicNodeMaterial({ color, transparent: true, depthWrite: false, fog: false });
    material.opacityNode = attribute<'float'>('fade', 'float').mul(opacity);
    return material;
  }
  private adopt<T extends Object3D>(object: T, order: number): T { object.frustumCulled = false; object.renderOrder = order; return object; }
  private sheetShape(width: number): { fill: BufferGeometry; rim: BufferGeometry } {
    const degrees = Math.max(1, Math.round(width * 180 / Math.PI));
    let shape = this.shapes.sheets.get(degrees);
    if (!shape) {
      const polar = (c: number, r: number): [number, number] => [Math.sin(c * width) * r, -Math.cos(c * width) * r];
      const rim = rays([0, 1], polar, .45);
      for (let n = 0; n < degrees; n++) for (const c of [n / degrees, (n + 1) / degrees]) { const [x, z] = polar(c, 1); rim.positions.push(x, 0, z); rim.fades.push(.45); }
      shape = { fill: surface(degrees, polar, .5), rim: geometry(rim.positions, rim.fades) };
      this.shapes.sheets.set(degrees, shape);
    }
    return shape;
  }
  setOcean(ocean: Pick<OceanApi, 'waveField'>): void {
    // The shapes are laid out about their launcher and turned with it, so the
    // swell is sampled where each vertex lands in the world.
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1));
    // Chop finer than the sampled swell would bite holes in a sheet laid on the
    // surface. Rising a little with distance clears it and costs a few pixels.
    const height = ocean.waveField.heightAt(world.xz).add(world.xz.sub(cameraPosition.xz).length().mul(.004).min(12).add(float(.35)));
    for (const material of [...Object.values(this.fills), ...Object.values(this.lines)]) material.positionNode = vec3(positionLocal.x, height, positionLocal.z);
  }
  private place(group: Group, origin: Vec3, course: number, half: number, run: number): void {
    group.position.set(origin[0], 0, origin[2]);
    group.rotation.y = -course;
    group.scale.set(Math.tan(half) * run, 1, run);
  }
  update(state: TorpedoAimState | undefined, visible: boolean): void {
    this.root.visible = visible && !!state;
    if (!visible || !state) return;
    const { sectors, lead } = state, live = sectors.filter(s => !['disabled', 'empty'].includes(s.status));
    // Launchers sharing an arc share its sheet: stacked sheets would hide the sea.
    const arcs = new Map<string, TorpedoSector>();
    for (const s of live) { const key = `${s.start.toFixed(3)}:${s.end.toFixed(3)}`; if (!arcs.has(key)) arcs.set(key, s); }
    while (this.sheets.length < arcs.size) {
      const shape = this.sheetShape(1), entry = { group: new Group(), fill: this.adopt(new Mesh(shape.fill, this.fills.sheet), 3), rim: this.adopt(new LineSegments(shape.rim, this.lines.rim), 6) };
      entry.group.add(entry.fill, entry.rim); this.root.add(entry.group); this.sheets.push(entry);
    }
    const spread = [...arcs.values()];
    this.sheets.forEach((entry, i) => {
      const s = spread[i];
      entry.group.visible = !!s;
      if (!s) return;
      const shape = this.sheetShape(s.end - s.start);
      entry.fill.geometry = shape.fill; entry.rim.geometry = shape.rim;
      entry.group.position.set(s.origin[0], 0, s.origin[2]);
      entry.group.rotation.y = -s.start;
      entry.group.scale.set(s.range, 1, s.range);
    });
    // With no launcher on the course, one outline waits on the nearest limit:
    // it shows which way the ship has to turn.
    const parked = live.some(s => s.course) ? undefined : live.flatMap(s => [s.start, s.end].map(limit => ({ s, limit, off: Math.abs(wrapAngle(limit - s.heading)) }))).sort((a, b) => a.off - b.off)[0];
    const wedges = parked ? [{ ...parked.s, heading: parked.limit, parked: true }] : live.filter(s => s.course).map(s => ({ ...s, parked: false }));
    while (this.salvos.length < wedges.length) {
      const entry = {
        group: new Group(), fill: this.adopt(new Mesh(this.shapes.wedge, this.fills.salvo), 5), arming: this.adopt(new Mesh(this.shapes.wedge, this.fills.arming), 5),
        edges: this.adopt(new LineSegments(this.shapes.edges, this.lines.edge), 6), dashes: this.adopt(new LineSegments(this.shapes.dashes, this.lines.waiting), 6), centre: this.adopt(new LineSegments(this.shapes.centre, this.lines.centre), 6),
      };
      entry.group.add(entry.fill, entry.arming, entry.edges, entry.dashes, entry.centre); this.root.add(entry.group); this.salvos.push(entry);
    }
    this.salvos.forEach((entry, i) => {
      const s = wedges[i];
      entry.group.visible = !!s;
      if (!s) return;
      this.place(entry.group, s.origin, s.heading, SALVO_HALF, s.range);
      entry.arming.scale.setScalar(s.arming / s.range).setY(1);
      // Only a launcher that would fire now is filled in.
      const ready = !s.parked && s.status === 'ready';
      entry.fill.visible = entry.arming.visible = entry.edges.visible = entry.centre.visible = ready;
      entry.dashes.visible = !ready;
      entry.fill.material = lead?.onSolution ? this.fills.salvoSolved : this.fills.salvo;
      entry.dashes.material = s.parked ? this.lines.blocked : this.lines.waiting;
    });
    const origin = state.solution?.origin;
    this.lead.group.visible = !!lead && !!origin;
    if (!lead || !origin || !state.solution) return;
    const [low, high] = lead.window, run = state.solution.range;
    this.place(this.lead.group, origin, lead.course + (low + high) / 2, (high - low) / 2, run);
    this.lead.fill.material = lead.onSolution ? this.fills.leadSolved : this.fills.lead;
    this.lead.bar.material = lead.onSolution ? this.lines.barSolved : this.lines.bar;
    // The bar lies across the wedge where torpedo and target meet.
    const positions = this.lead.bar.geometry.getAttribute('position'), r = Math.min(1, lead.distance / run);
    for (let n = 0; n < COLUMNS; n++) for (const k of [0, 1]) { const [x, z] = wedge((n + k) / COLUMNS, r); positions.setXYZ(n * 2 + k, x, 0, z); }
    positions.needsUpdate = true;
  }
  dispose(): void {
    const { sheets, ...shared } = this.shapes;
    for (const shape of Object.values(shared)) shape.dispose();
    for (const shape of sheets.values()) { shape.fill.dispose(); shape.rim.dispose(); }
    this.lead.bar.geometry.dispose();
    for (const material of [...Object.values(this.fills), ...Object.values(this.lines)]) material.dispose();
    this.root.clear(); this.root.removeFromParent(); this.salvos = []; this.sheets = [];
  }
}

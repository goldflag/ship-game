import { BufferGeometry, Float32BufferAttribute, Group, LineBasicNodeMaterial, LineSegments, Mesh, MeshBasicNodeMaterial, DoubleSide, type Node } from 'three/webgpu';
import { float, int, mix, positionLocal, vec3 } from 'three/tsl';
import type { WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
import type { FleetActor } from '../simulation/battle';
import type { ShipState } from '../simulation/ship';
import type { Vec3 } from '../ships/blueprint';
import { localToWorld, radians, wrapAngle } from '../simulation/geometry';
import { tubeLocalPosition, tubeSolution } from '../simulation/torpedoes';

export function torpedoPreviewSectors(actor: FleetActor, aim: Vec3, pose: ShipState = actor.motion) {
  const seen = new Set<string>();
  return (actor.definition.torpedoTubes ?? []).flatMap(tube => {
    const key = tube.launcherId ?? String(tube.bearingDeg);
    if (seen.has(key)) return [];
    seen.add(key);
    const members = actor.definition.torpedoTubes!.filter(t => (t.launcherId ?? String(t.bearingDeg)) === key);
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
      range: tube.weapon.rangeM, arming: tube.weapon.armingDistanceM,
      heading: chosen.solution.heading, status: chosen.state.status,
      course: !['out-of-arc', 'disabled', 'empty', 'too-deep', 'above-water'].includes(chosen.state.status) && Math.abs(wrapAngle(chosen.solution.heading - actor.motion.heading - radians((a + b) / 2))) <= radians((b - a) / 2),
    }));
  });
}

type Sector = ReturnType<typeof torpedoPreviewSectors>[number];
const ANGLES = 24, RINGS = 64;
function sectorGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute((ANGLES + 1) * (RINGS + 1) * 3, 3));
  const indices: number[] = [];
  for (let r = 0; r < RINGS; r++) for (let a = 0; a < ANGLES; a++) {
    const i = r * (ANGLES + 1) + a;
    indices.push(i, i + 1, i + ANGLES + 1, i + 1, i + ANGLES + 2, i + ANGLES + 1);
  }
  geometry.setIndex(indices); return geometry;
}
function fillSector(geometry: BufferGeometry, sector: Sector, start: number, end: number) {
  const positions = geometry.getAttribute('position');
  for (let r = 0; r <= RINGS; r++) for (let a = 0; a <= ANGLES; a++) {
    const distance = sector.range * (r / RINGS) ** 2, angle = start + (end - start) * a / ANGLES;
    positions.setXYZ(r * (ANGLES + 1) + a, sector.origin[0] + Math.sin(angle) * distance, .35, sector.origin[2] - Math.cos(angle) * distance);
  }
  positions.needsUpdate = true;
}

/** Visual-only water overlay. Launch headings and eligibility come from the CPU solution. */
export class TorpedoPreview {
  readonly root = new Group();
  private sectorMaterial = new MeshBasicNodeMaterial({ color: '#86e4c5', transparent: true, opacity: .055, depthWrite: false, side: DoubleSide, fog: false });
  private courseMaterial = new MeshBasicNodeMaterial({ color: '#86e4c5', transparent: true, opacity: .18, depthWrite: false, side: DoubleSide, fog: false });
  private lineMaterial = new LineBasicNodeMaterial({ color: '#86e4c5', transparent: true, opacity: .7, depthWrite: false, fog: false });
  private armingMaterial = new LineBasicNodeMaterial({ color: '#e8c56c', transparent: true, opacity: .65, depthWrite: false, fog: false });
  private entries: { sector: Mesh; course: Mesh; lines: LineSegments; arming: LineSegments }[] = [];
  constructor() { this.root.visible = false; }
  setWater(water: WaterSystem): void {
    const sim = water.simulation;
    let displacement: Node<'vec3'> = vec3(0);
    if (sim.getCapabilities().hasStorageBuffers) {
      // The WebGPU public displacement helper wraps an existing storage node
      // as an attribute. Sample the public buffers directly instead.
      for (let i = 0; i < sim.getCascadeCount(); i++) {
        const buffer = sim.getDisplacementBuffer(i)!;
        const resolution = sim.getResolution(i), scale = sim.getScale(i);
        const x = positionLocal.x.add(displacement.x).div(scale).add(.5).mul(resolution);
        const z = positionLocal.z.add(displacement.z).div(scale).add(.5).mul(resolution);
        const ix = x.floor().toInt().mod(int(resolution)).add(int(resolution)).mod(int(resolution));
        const iz = z.floor().toInt().mod(int(resolution)).add(int(resolution)).mod(int(resolution));
        const nx = ix.add(1).mod(int(resolution)), nz = iz.add(1).mod(int(resolution));
        const at = (a: Node<'int'>, b: Node<'int'>) => buffer.element(b.mul(int(resolution)).add(a)).xyz;
        displacement = displacement.add(mix(mix(at(ix, iz), at(nx, iz), x.fract()), mix(at(ix, nz), at(nx, nz), x.fract()), z.fract()));
      }
    } else displacement = sim.getDisplacementNodes().sampleDisplacement(positionLocal.x, positionLocal.z) as Node<'vec3'>;
    const height = displacement.y.add(float(.35));
    for (const material of [this.sectorMaterial, this.courseMaterial, this.lineMaterial, this.armingMaterial]) material.positionNode = vec3(positionLocal.x, height, positionLocal.z);
  }
  update(actor: FleetActor, pose: ShipState, aim: Vec3, visible: boolean): void {
    this.root.visible = visible;
    if (!visible) return;
    const sectors = torpedoPreviewSectors(actor, aim, pose);
    while (this.entries.length < sectors.length) {
      const sector = new Mesh(sectorGeometry(), this.sectorMaterial), course = new Mesh(sectorGeometry(), this.courseMaterial);
      const lineGeometry = () => new BufferGeometry().setAttribute('position', new Float32BufferAttribute((ANGLES + RINGS * 3) * 6, 3));
      const lines = new LineSegments(lineGeometry(), this.lineMaterial), arming = new LineSegments(lineGeometry(), this.armingMaterial);
      for (const object of [sector, course, lines, arming]) { object.frustumCulled = false; object.renderOrder = 3; this.root.add(object); }
      this.entries.push({ sector, course, lines, arming });
    }
    this.entries.forEach((entry, i) => {
      const s = sectors[i];
      for (const object of Object.values(entry)) object.visible = !!s;
      if (!s) return;
      fillSector(entry.sector.geometry, s, s.start, s.end);
      fillSector(entry.course.geometry, s, s.heading - radians(.35), s.heading + radians(.35));
      entry.course.visible = s.course && s.status === 'ready';
      let count = 0, armedCount = 0;
      const lines = entry.lines.geometry.getAttribute('position'), arming = entry.arming.geometry.getAttribute('position');
      const point = (angle: number, distance: number) => [s.origin[0] + Math.sin(angle) * distance, .4, s.origin[2] - Math.cos(angle) * distance] as const;
      for (let a = 0; a < ANGLES; a++) {
        const from = s.start + (s.end - s.start) * a / ANGLES, to = s.start + (s.end - s.start) * (a + 1) / ANGLES;
        lines.setXYZ(count++, ...point(from, s.range)); lines.setXYZ(count++, ...point(to, s.range));
        arming.setXYZ(armedCount++, ...point(from, s.arming)); arming.setXYZ(armedCount++, ...point(to, s.arming));
      }
      for (const angle of [s.start, s.end, ...(s.course ? [s.heading] : [])]) for (let r = 0; r < RINGS; r++) {
        lines.setXYZ(count++, ...point(angle, s.range * (r / RINGS) ** 2));
        lines.setXYZ(count++, ...point(angle, s.range * ((r + 1) / RINGS) ** 2));
      }
      lines.needsUpdate = arming.needsUpdate = true;
      entry.lines.geometry.setDrawRange(0, count); entry.arming.geometry.setDrawRange(0, armedCount);
      if (['disabled', 'empty'].includes(s.status)) for (const object of Object.values(entry)) object.visible = false;
    });
  }
  dispose(): void {
    for (const entry of this.entries) for (const object of Object.values(entry)) object.geometry.dispose();
    for (const material of [this.sectorMaterial, this.courseMaterial, this.lineMaterial, this.armingMaterial]) material.dispose();
    this.root.clear(); this.root.removeFromParent(); this.entries = [];
  }
}

import { selectedWeapon } from '../ships/weaponGroups';
import { torpedoSpeed } from '../ships/mobility';
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicNodeMaterial, LineSegments, type Node } from 'three/webgpu';
import { float, int, mix, positionLocal, vec3 } from 'three/tsl';
import type { WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
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
      heading: chosen.solution.heading, aimDistance: chosen.solution.range, status: chosen.state.status,
      course: !['out-of-arc', 'disabled', 'empty', 'too-deep', 'above-water'].includes(chosen.state.status) && Math.abs(wrapAngle(chosen.solution.heading - actor.motion.heading - radians((a + b) / 2))) <= radians((b - a) / 2),
    }));
  });
}

export type TorpedoSector = ReturnType<typeof torpedoPreviewSectors>[number];
const RINGS = 64, STUB = 6, HOOK = 4, LEAD_DASHES = 48;
const lineSegments = (segments: number) => new BufferGeometry().setAttribute('position', new Float32BufferAttribute(segments * 6, 3));

/** Visual-only water overlay: the course the torpedoes will run, the limits of
 * the launch arc beside the ship, and the target's run to the lead. The open
 * sea stays clear. Launch headings and eligibility come from the CPU solution. */
export class TorpedoPreview {
  readonly root = new Group();
  private materials = {
    track: new LineBasicNodeMaterial({ color: '#86e4c5', transparent: true, opacity: .95, depthWrite: false, fog: false }),
    waiting: new LineBasicNodeMaterial({ color: '#86e4c5', transparent: true, opacity: .4, depthWrite: false, fog: false }),
    beyond: new LineBasicNodeMaterial({ color: '#86e4c5', transparent: true, opacity: .45, depthWrite: false, fog: false }),
    arming: new LineBasicNodeMaterial({ color: '#e8c56c', transparent: true, opacity: .95, depthWrite: false, fog: false }),
    limits: new LineBasicNodeMaterial({ color: '#86e4c5', transparent: true, opacity: .7, depthWrite: false, fog: false }),
    lead: new LineBasicNodeMaterial({ color: '#ee9b86', transparent: true, opacity: .85, depthWrite: false, fog: false }),
  };
  private entries: { track: LineSegments; beyond: LineSegments; arming: LineSegments; limits: LineSegments }[] = [];
  private lead = new LineSegments(lineSegments(LEAD_DASHES), this.materials.lead);
  constructor() { this.root.visible = false; this.adopt(this.lead); }
  private adopt(object: LineSegments): void { object.frustumCulled = false; object.renderOrder = 3; this.root.add(object); }
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
    for (const material of Object.values(this.materials)) material.positionNode = vec3(positionLocal.x, height, positionLocal.z);
  }
  update(state: TorpedoAimState | undefined, visible: boolean): void {
    this.root.visible = visible && !!state;
    if (!visible || !state) return;
    const { sectors } = state;
    while (this.entries.length < sectors.length) {
      const entry = { track: new LineSegments(lineSegments(RINGS), this.materials.track), beyond: new LineSegments(lineSegments(RINGS), this.materials.beyond), arming: new LineSegments(lineSegments(RINGS), this.materials.arming), limits: new LineSegments(lineSegments(2 * (STUB + HOOK)), this.materials.limits) };
      Object.values(entry).forEach(object => this.adopt(object));
      this.entries.push(entry);
    }
    const marked = new Set<string>();
    this.entries.forEach((entry, i) => {
      const s = sectors[i], shown = !!s && !['disabled', 'empty'].includes(s.status);
      for (const object of Object.values(entry)) object.visible = shown;
      if (!shown) return;
      const counts = { track: 0, beyond: 0, arming: 0, limits: 0 };
      const put = (key: keyof typeof counts, angle: number, from: number, to: number) => {
        const positions = entry[key].geometry.getAttribute('position');
        for (const distance of [from, to]) positions.setXYZ(counts[key]++, s.origin[0] + Math.sin(angle) * distance, .4, s.origin[2] - Math.cos(angle) * distance);
      };
      if (s.course) {
        // Squared spacing keeps the near water following the swell and lets the
        // dashes past the sight lengthen as perspective shortens them.
        const sight = Math.min(s.range, Math.max(s.arming, s.aimDistance));
        for (let r = 0; r < RINGS; r++) {
          const from = s.range * (r / RINGS) ** 2, to = s.range * ((r + 1) / RINGS) ** 2;
          if (from < s.arming) put('arming', s.heading, from, Math.min(to, s.arming));
          if (to > s.arming && from < sight) put('track', s.heading, Math.max(from, s.arming), Math.min(to, sight));
          if (to > sight && r % 2 === 0) put('beyond', s.heading, Math.max(from, sight), to);
        }
      }
      entry.track.material = s.status === 'ready' ? this.materials.track : this.materials.waiting;
      // Launchers sharing an arc share its limit marks.
      const arc = `${s.start.toFixed(3)}:${s.end.toFixed(3)}`, inner = s.hull * .55, outer = s.hull * .95;
      for (const [edge, inward] of marked.has(arc) ? [] : [[s.start, 1], [s.end, -1]]) {
        for (let n = 0; n < STUB; n++) put('limits', edge, inner + (outer - inner) * n / STUB, inner + (outer - inner) * (n + 1) / STUB);
        const hook = Math.min(radians(5), (s.end - s.start) / 4) * inward / HOOK;
        for (let n = 0; n < HOOK; n++) {
          const positions = entry.limits.geometry.getAttribute('position');
          for (const angle of [edge + hook * n, edge + hook * (n + 1)]) positions.setXYZ(counts.limits++, s.origin[0] + Math.sin(angle) * outer, .4, s.origin[2] - Math.cos(angle) * outer);
        }
      }
      marked.add(arc);
      for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
        entry[key].geometry.getAttribute('position').needsUpdate = true;
        entry[key].geometry.setDrawRange(0, counts[key]);
      }
    });
    const lead = state.lead;
    this.lead.visible = !!lead;
    if (!lead) return;
    const positions = this.lead.geometry.getAttribute('position');
    let count = 0;
    for (let n = 0; n < LEAD_DASHES * 2; n += 2) for (const t of [n, n + 1]) {
      const along = t / (LEAD_DASHES * 2);
      positions.setXYZ(count++, lead.from[0] + (lead.point[0] - lead.from[0]) * along, .4, lead.from[2] + (lead.point[2] - lead.from[2]) * along);
    }
    positions.needsUpdate = true;
  }
  dispose(): void {
    for (const entry of this.entries) for (const object of Object.values(entry)) object.geometry.dispose();
    this.lead.geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.root.clear(); this.root.removeFromParent(); this.entries = [];
  }
}

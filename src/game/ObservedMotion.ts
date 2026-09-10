import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import type { ObservedPose } from './session/BattleSession';

/** Smooth only sampled, permitted exterior poses. Missing reports disappear;
 * the chart's last-known estimates are a separate source of information. */
export class ObservedMotion {
  private poses = new Map<string, { position: Vector3; rotation: Quaternion }>();
  private target = new Vector3();
  private rotation = new Quaternion();
  private velocity = new Vector3();
  private euler = new Euler(0, 0, 0, 'YXZ');
  private clock = 0;
  update(reports: readonly ObservedPose[], tick: number, dt: number): void {
    if (!reports.length) { this.clear(); this.clock = tick; return; }
    this.clock = Math.min(tick + 6, Math.max(tick, this.clock + Math.max(0, dt) * 60));
    const active = new Set(reports.map(r => r.id));
    for (const id of this.poses.keys()) if (!active.has(id)) this.poses.delete(id);
    const blend = -Math.expm1(-Math.max(0, dt) / .1);
    for (const report of reports) {
      const seconds = Math.min(.1, Math.max(0, (this.clock - report.observedTick) / 60));
      this.target.fromArray(report.position).addScaledVector(this.velocity.fromArray(report.velocity), seconds);
      this.rotation.setFromEuler(this.euler.set(report.pitch ?? 0, -report.heading, report.roll ?? 0));
      const pose = this.poses.get(report.id);
      if (pose) { pose.position.lerp(this.target, blend); pose.rotation.slerp(this.rotation, blend); }
      else this.poses.set(report.id, { position: this.target.clone(), rotation: this.rotation.clone() });
    }
  }
  get(id: string) { return this.poses.get(id); }
  clear(): void { this.poses.clear(); this.clock = 0; }
}

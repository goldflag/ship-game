import type { Vec3 } from '../ships/blueprint';
import type { CombatEvent } from '../simulation/combat';
import type { Shell } from '../simulation/damage';

export interface ShellView { position: Vec3; velocity: Vec3; }

/** Presentation only: observe one player shell without changing combat or its aim. */
export class ShellFollow {
  enabled = false;
  view?: ShellView;
  shellId?: number;
  private latestId = 0;
  private impactTime = 0;

  get phase(): 'off' | 'ready' | 'flight' | 'impact' {
    return !this.enabled ? 'off' : !this.view ? 'ready' : this.impactTime > 0 ? 'impact' : 'flight';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.view = undefined;
    this.shellId = undefined;
    this.impactTime = 0;
    // Enabling in flight can pick up the player's latest live shell.
    this.latestId = 0;
  }

  update(shells: readonly Shell[], events: readonly CombatEvent[], ownerId: string, dt: number): void {
    if (!this.enabled) return;
    let newest: Shell | undefined;
    for (const shell of shells) {
      if (shell.ownerId === ownerId && shell.id > this.latestId && (!newest || shell.id > newest.id)) newest = shell;
    }
    if (newest) this.latestId = newest.id;
    if (this.view) {
      if (this.impactTime > 0) {
        this.impactTime = Math.max(0, this.impactTime - dt);
        if (this.impactTime === 0) { this.view = undefined; this.shellId = undefined; }
        return;
      }
      const shell = shells.find(shell => shell.id === this.shellId && shell.ownerId === ownerId);
      if (shell) { this.view = { position: [...shell.position], velocity: [...shell.velocity] }; return; }
      const impact = [...events].reverse().find(event => event.shell?.id === this.shellId && event.kind !== 'shot');
      if (impact?.shell) {
        this.view = { position: [...impact.position], velocity: [...impact.shell.velocity] };
        this.impactTime = 1.1;
      } else { this.view = undefined; this.shellId = undefined; }
      return;
    }
    if (newest) {
      this.shellId = newest.id;
      this.view = { position: [...newest.position], velocity: [...newest.velocity] };
    }
  }
}

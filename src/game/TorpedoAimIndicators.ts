import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import { projectShipLabel } from './ShipLabels';
import { runClock, type TorpedoAimState } from './torpedoLead';

const BLOCKED: Record<string, string> = { 'out-of-arc': 'OUT OF ARC', 'too-deep': 'TOO DEEP', 'above-water': 'TUBE ABOVE WATER', blocked: 'BLOCKED' };

/** What the sight says about the shot. A torpedo is aimed by bearing alone, so
 * the figures describe the meeting with the led target: how long the torpedoes
 * run to it and how far. With nothing to lead they give the full run. */
export function torpedoSightReadout(state: TorpedoAimState): { clock: string; range: string; status: string; tone: 'ready' | 'waiting' | 'blocked' | 'solved' | 'caution' } | undefined {
  const { solution, lead, unreachable } = state;
  if (!solution) return undefined;
  const blocked = BLOCKED[solution.status as string];
  const waiting = solution.status === 'reloading' ? `RELOAD ${runClock(solution.reload)}` : solution.status === 'turning' ? 'TRAINING' : undefined;
  const reach = !lead && unreachable ? unreachable === 'beyond-run' ? 'BEYOND RUN' : 'INSIDE ARMING RUN' : undefined;
  return {
    clock: runClock(lead ? lead.seconds : solution.range / solution.speed),
    range: lead ? `${(lead.distance / 1000).toFixed(2)} km` : `${(solution.range / 1000).toFixed(1)} km`,
    status: blocked ?? waiting ?? (lead?.onSolution ? 'ON TARGET' : reach ?? ''),
    tone: blocked ? 'blocked' : waiting ? 'waiting' : lead?.onSolution ? 'solved' : reach ? 'caution' : 'ready',
  };
}

/** Frame-rate DOM overlay, like the gun aim rings: the running time and the
 * distance either side of the sight, and a chevron on the edge of the view
 * when the lead wedge lies outside it. */
export class TorpedoAimIndicators {
  private root = document.createElement('div');
  private readout = document.createElement('div');
  private clock = document.createElement('span');
  private range = document.createElement('span');
  private status = document.createElement('span');
  private edge = document.createElement('div');
  private point = new Vector3();
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement) {
    this.root.className = 'torpedo-aim-layer';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Torpedo course and lead');
    this.root.hidden = true;
    this.readout.className = 'torpedo-aim-readout';
    this.clock.className = 'torpedo-aim-clock'; this.range.className = 'torpedo-aim-range'; this.status.className = 'torpedo-aim-status';
    this.readout.append(this.clock, this.range, this.status);
    this.edge.className = 'torpedo-lead-edge';
    this.root.append(this.edge, this.readout);
    host.appendChild(this.root);
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; }

  update(state: TorpedoAimState | undefined, camera: PerspectiveCamera, visible: boolean): void {
    const readout = visible && state ? torpedoSightReadout(state) : undefined;
    this.root.hidden = !readout;
    if (!readout || !state) return;
    this.readout.dataset.tone = readout.tone;
    write(this.clock, readout.clock); write(this.range, readout.range); write(this.status, readout.status);
    const lead = state.lead;
    const inView = lead && projectShipLabel(this.point.set(lead.point[0], 0, lead.point[2]), camera, this.width, this.height);
    this.edge.hidden = !lead || !!inView;
    if (!lead || inView) return;
    this.edge.dataset.turn = lead.swing < 0 ? 'left' : 'right';
    write(this.edge, `LEAD ${Math.round(Math.abs(lead.swing) * 180 / Math.PI)}°`);
  }

  dispose(): void { this.root.remove(); }
}

function write(element: HTMLElement, text: string): void { if (element.textContent !== text) element.textContent = text; }

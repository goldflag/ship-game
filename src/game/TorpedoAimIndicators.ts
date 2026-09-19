import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import { projectShipLabel } from './ShipLabels';
import { runClock, type TorpedoAimState } from './torpedoLead';

/** What the sight says about the course under it. Range cannot be read off water
 * seen from mast height, so the distance and the running time are spelled out. */
export function torpedoSightReadout(state: TorpedoAimState): { range: string; run: string; swing: string; tone: 'ready' | 'waiting' | 'blocked' | 'solved' } | undefined {
  const { solution, lead } = state;
  if (!solution) return undefined;
  const blocked = { 'out-of-arc': 'OUT OF ARC', 'out-of-range': 'BEYOND RANGE', 'too-close': 'INSIDE ARMING RUN', 'too-deep': 'TOO DEEP', 'above-water': 'TUBE ABOVE WATER', blocked: 'BLOCKED' }[solution.status as string];
  const degrees = lead ? Math.abs(lead.swing) * 180 / Math.PI : 0;
  return {
    range: `${(solution.distance / 1000).toFixed(1)} km`,
    run: blocked ?? `RUN ${runClock(solution.runSeconds)}`,
    swing: !lead ? '' : lead.onSolution ? 'ON' : `${degrees < 9.5 ? degrees.toFixed(1) : Math.round(degrees)}°`,
    tone: blocked ? 'blocked' : lead?.onSolution ? 'solved' : solution.status === 'ready' ? 'ready' : 'waiting',
  };
}

type TagBox = { x: number; top: number; bottom: number; halfWidth: number };
const POST_RISE = 48, CAPTION_HEIGHT = 45, CAPTION_HALF_WIDTH = 45;
/** A slow or end-on target is led by little, which puts the post under its own
 * name tag. The post then grows until its head clears the tag and drops its
 * caption: the sight readout already carries the running time. */
export function leadPostRise(post: { x: number; y: number }, tag?: TagBox): number {
  if (!tag || Math.abs(post.x - tag.x) > tag.halfWidth + CAPTION_HALF_WIDTH) return POST_RISE;
  const overlaps = post.y - POST_RISE - CAPTION_HEIGHT < tag.bottom + 4 && post.y - POST_RISE + 8 > tag.top - 4;
  return overlaps ? Math.min(180, Math.max(POST_RISE, Math.round(post.y - tag.top + 12))) : POST_RISE;
}

/** Frame-rate DOM overlay, like the gun aim rings: a post standing on the lead
 * and a readout at the sight. Torpedo aim is a bearing, so both read sideways. */
export class TorpedoAimIndicators {
  private root = document.createElement('div');
  private readout = document.createElement('div');
  private range = document.createElement('span');
  private run = document.createElement('span');
  private swing = document.createElement('span');
  private post = document.createElement('div');
  private caption = document.createElement('span');
  private clock = document.createElement('span');
  private point = new Vector3();
  private rise = 0;
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement) {
    this.root.className = 'torpedo-aim-layer';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Torpedo course and lead');
    this.root.hidden = true;
    this.readout.className = 'torpedo-aim-readout';
    this.range.className = 'torpedo-aim-range'; this.run.className = 'torpedo-aim-run'; this.swing.className = 'torpedo-aim-swing';
    this.readout.append(this.swing, this.range, this.run);
    this.post.className = 'torpedo-lead';
    const stem = document.createElement('span'), head = document.createElement('span'), label = document.createElement('span');
    stem.className = 'torpedo-lead-stem'; head.className = 'torpedo-lead-head'; label.className = 'torpedo-lead-label';
    stem.setAttribute('aria-hidden', 'true'); head.setAttribute('aria-hidden', 'true');
    this.caption.className = 'torpedo-lead-caption'; this.clock.className = 'torpedo-lead-clock';
    label.append(this.caption, this.clock);
    this.post.append(stem, head, label);
    this.root.append(this.post, this.readout);
    host.appendChild(this.root);
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; }

  /** `tagBox` reports the target's name tag so the post can stand clear of it. */
  update(state: TorpedoAimState | undefined, camera: PerspectiveCamera, visible: boolean, tagBox?: (id: string) => TagBox | undefined): void {
    const readout = visible && state ? torpedoSightReadout(state) : undefined;
    this.root.hidden = !readout;
    if (!readout || !state) return;
    this.readout.dataset.tone = readout.tone;
    write(this.range, readout.range); write(this.run, readout.run); write(this.swing, readout.swing);
    const lead = state.lead;
    this.swing.hidden = !lead;
    if (lead) this.swing.dataset.turn = lead.onSolution ? 'on' : lead.swing < 0 ? 'left' : 'right';
    const screen = lead && projectShipLabel(this.point.set(lead.point[0], 0, lead.point[2]), camera, this.width, this.height);
    this.post.hidden = !screen;
    if (!lead || !screen) return;
    this.post.style.transform = `translate(${screen.x.toFixed(2)}px, ${screen.y.toFixed(2)}px)`;
    const rise = leadPostRise(screen, tagBox?.(lead.contactId));
    if (rise !== this.rise) { this.rise = rise; this.post.style.setProperty('--lead-rise', `${rise}px`); }
    this.post.classList.toggle('torpedo-lead-crowded', rise !== POST_RISE);
    this.post.classList.toggle('torpedo-lead-solved', lead.onSolution);
    write(this.caption, lead.onSolution ? 'ON TARGET' : 'LEAD'); write(this.clock, runClock(lead.seconds));
    this.post.setAttribute('aria-label', `${lead.onSolution ? 'On target' : 'Lead'}: torpedoes meet the target in ${Math.round(lead.seconds)} seconds`);
  }

  dispose(): void { this.root.remove(); }
}

function write(element: HTMLElement, text: string): void { if (element.textContent !== text) element.textContent = text; }

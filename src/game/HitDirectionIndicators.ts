import type { PerspectiveCamera } from 'three/webgpu';
import type { CombatSimulation } from '../simulation/combat';
import { HitDirectionFeedback } from './HitDirectionFeedback';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DIRECTIONS = ['ahead', 'front right', 'right', 'rear right', 'behind', 'rear left', 'left', 'front left'];

/** Small impact arcs outside the sight; rotate at frame rate with the active camera. */
export class HitDirectionIndicators {
  private feedback = new HitDirectionFeedback();
  private root = document.createElement('div');
  private marks: SVGSVGElement[] = [];

  constructor(host: HTMLElement) {
    this.root.className = 'hit-direction-layer';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Incoming hit directions');
    this.root.hidden = true;
    host.appendChild(this.root);
  }

  update(simulation: CombatSimulation, camera: PerspectiveCamera, visible: boolean): void {
    // Use the actual camera, including inspection and shell-follow views.
    const matrix = camera.matrixWorld.elements;
    const cues = this.feedback.update(simulation, Math.atan2(-matrix[8], matrix[10]));
    this.root.hidden = !visible || !cues.length;
    cues.forEach((cue, i) => {
      let mark = this.marks[i];
      if (!mark) {
        mark = document.createElementNS(SVG_NS, 'svg');
        mark.setAttribute('viewBox', '-160 -160 320 320');
        mark.setAttribute('class', 'hit-direction-marker');
        mark.setAttribute('role', 'img');
        for (const className of ['hit-direction-underlay', 'hit-direction-arc']) {
          const arc = document.createElementNS(SVG_NS, 'path');
          arc.setAttribute('d', 'M-39 -112 A118 118 0 0 1 39 -112');
          arc.setAttribute('class', className); mark.appendChild(arc);
        }
        const tip = document.createElementNS(SVG_NS, 'path');
        tip.setAttribute('d', 'M0 -140 9 -125 -9 -125Z');
        tip.setAttribute('class', 'hit-direction-tip'); mark.appendChild(tip);
        this.root.appendChild(mark); this.marks.push(mark);
      }
      mark.style.display = '';
      mark.style.transform = `translate(-50%, -50%) rotate(${cue.angle}rad)`;
      mark.style.opacity = String(cue.opacity);
      const direction = DIRECTIONS[(Math.round(cue.angle / (Math.PI / 4)) + 8) % 8];
      mark.setAttribute('aria-label', `Your ship hit from ${direction}`);
    });
    for (let i = cues.length; i < this.marks.length; i++) this.marks[i].style.display = 'none';
  }

  dispose(): void { this.root.remove(); }
}

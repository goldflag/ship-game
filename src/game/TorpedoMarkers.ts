import { HUD_LAYERS } from '../ui/hudLayers';
import { Vector3, type Camera } from 'three/webgpu';
import { projectShipLabel } from './ShipLabels';
import type { Torpedo } from './session/elements';

/** A chevron over every torpedo the session reports. A wake three metres wide
 * is under a pixel past a few hundred metres; the mark keeps its size. Team
 * frames already hold back hostile torpedoes nobody has sighted. */
export class TorpedoMarkers {
  private root = document.createElement('div');
  private marks: { root: HTMLDivElement; hostile: boolean | undefined }[] = [];
  private point = new Vector3();
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement) {
    this.root.className = HUD_LAYERS.torpedoMarkers.className;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;
    host.appendChild(this.root);
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; }

  update(torpedoes: readonly Torpedo[], friendlyIds: ReadonlySet<string>, camera: Camera, visible: boolean): void {
    this.root.hidden = !visible || !torpedoes.length;
    if (this.root.hidden) return;
    let used = 0;
    for (const torpedo of torpedoes) {
      // The mark rides the surface above a torpedo running at depth.
      const screen = projectShipLabel(this.point.set(torpedo.position[0], Math.max(0, torpedo.position[1]), torpedo.position[2]), camera, this.width, this.height);
      if (!screen) continue;
      let mark = this.marks[used];
      if (!mark) {
        const root = document.createElement('div');
        this.root.appendChild(root);
        mark = { root, hostile: undefined }; this.marks.push(mark);
      }
      used++;
      const hostile = !friendlyIds.has(torpedo.ownerId);
      if (mark.hostile !== hostile) { mark.hostile = hostile; mark.root.className = `torpedo-marker${hostile ? ' torpedo-marker-enemy' : ''}`; }
      mark.root.hidden = false;
      mark.root.style.transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px)`;
    }
    for (let i = used; i < this.marks.length; i++) this.marks[i].root.hidden = true;
  }

  dispose(): void { this.root.remove(); }
}

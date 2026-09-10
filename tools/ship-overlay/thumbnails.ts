import { Viewer } from './viewer';
import type { ComponentItem } from '../../scripts/parts/library';
import type { Aircraft } from './aircraft';

/** One offscreen context, one model at a time; only visible carousel items ask
 * for thumbnails. Images always come from the actual component geometry. */
export class ComponentThumbnails {
  private host?: HTMLDivElement;
  private viewer?: Viewer;
  private pending: Promise<unknown> = Promise.resolve();
  private images = new Map<string, Promise<string>>();
  private disposed = false;

  get(part: ComponentItem): Promise<string> {
    const installation = part.installations[0];
    const url = part.modelUrl ?? installation?.modelUrl;
    if (!url) return Promise.reject(new Error('No model available'));
    const key = `${part.partId}:${url}`;
    return this.getPreview(key, viewer => viewer.loadShip(url, { assemblyId: part.modelUrl ? 'component' : installation!.mountId, weapon: part.weapon, installed: !part.modelUrl }));
  }
  getAircraft(aircraft: Aircraft): Promise<string> {
    return this.getPreview(`aircraft:${aircraft.id}:${aircraft.modelUrl}`, viewer => viewer.loadShip(aircraft.modelUrl, undefined, 1));
  }
  private getPreview(key: string, load: (viewer: Viewer) => Promise<boolean>): Promise<string> {
    const cached = this.images.get(key);
    if (cached) return cached;
    const task = this.pending.then(async () => {
      if (this.disposed) throw new Error('Carousel closed');
      if (!this.viewer) {
        this.host = document.createElement('div');
        this.host.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none;';
        this.host.setAttribute('aria-hidden', 'true');
        document.body.append(this.host);
        this.viewer = new Viewer(this.host);
        this.viewer.comparison('inspect');
      }
      await load(this.viewer);
      if (this.disposed) throw new Error('Carousel closed');
      const image = this.viewer.thumbnail();
      this.viewer.clearModel();
      return image;
    });
    this.pending = task.catch(() => {});
    this.images.set(key, task);
    return task;
  }
  dispose() { this.disposed = true; this.viewer?.dispose(); this.host?.remove(); this.images.clear(); }
}

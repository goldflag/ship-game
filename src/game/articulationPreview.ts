import type { ShipDefinition } from '../ships/blueprint';

export type ClearancePose = { train: number; elevation: number; recoil: number };
export type ClearanceResult = { pose: ClearancePose; blocked: boolean; obstructionId: string | null };

/** Owned by the development game instance; large sweeps never block rendering. */
export class ArticulationResolver {
  private worker = new Worker(new URL('./articulationPreview.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: ClearanceResult[]) => void; reject: (error: Error) => void }>();
  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<{ id: number; results?: ClearanceResult[]; error?: string }>) => {
      const request = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.results) request?.resolve(data.results);
      else request?.reject(new Error(data.error ?? 'Articulation preview failed'));
    };
    this.worker.onerror = event => this.dispose(new Error(event.message));
  }
  resolve(definition: ShipDefinition, current: ClearancePose[], requested: ClearancePose[]): Promise<ClearanceResult[]> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, definition, current, requested });
    });
  }
  dispose(error = new Error('Articulation preview closed')) {
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

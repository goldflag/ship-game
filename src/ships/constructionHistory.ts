/** Source history only: asynchronous compile products never appear in undo/redo. */
export interface ConstructionHistory<T> {
  past: { label: string; source: T }[];
  source: T;
  future: { label: string; source: T }[];
  revision: number;
  lastAction: string;
}

export function createConstructionHistory<T>(source: T): ConstructionHistory<T> {
  return { past: [], source: structuredClone(source), future: [], revision: 0, lastAction: 'Opened design' };
}

export function editConstruction<T>(history: ConstructionHistory<T>, label: string, edit: (draft: T) => void): ConstructionHistory<T> {
  const source = structuredClone(history.source);
  edit(source);
  if (JSON.stringify(source) === JSON.stringify(history.source)) return history;
  return { past: [...history.past.slice(-49), { label, source: history.source }], source, future: [], revision: history.revision + 1, lastAction: label };
}

/** Apply one edit to every state, past and future included, without adding an entry: Undo cannot restore what it replaced. */
export function rebaseConstruction<T>(history: ConstructionHistory<T>, edit: (draft: T) => void): ConstructionHistory<T> {
  const rebased = (source: T) => { const draft = structuredClone(source); edit(draft); return draft; };
  return { past: history.past.map(entry => ({ label: entry.label, source: rebased(entry.source) })), source: rebased(history.source),
    future: history.future.map(entry => ({ label: entry.label, source: rebased(entry.source) })), revision: history.revision + 1, lastAction: history.lastAction };
}

export function undoConstruction<T>(history: ConstructionHistory<T>): ConstructionHistory<T> {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), source: previous.source, future: [{ label: previous.label, source: history.source }, ...history.future], revision: history.revision + 1, lastAction: `Undid ${previous.label.toLowerCase()}` };
}

export function redoConstruction<T>(history: ConstructionHistory<T>): ConstructionHistory<T> {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, { label: next.label, source: history.source }], source: next.source, future: history.future.slice(1), revision: history.revision + 1, lastAction: `Redid ${next.label.toLowerCase()}` };
}

/** Every design change/recompile/unmount fences older asynchronous results. */
export class ConstructionRevisionGate {
  private generation = 0;
  issue(): number { return ++this.generation; }
  accepts(token: number): boolean { return token === this.generation; }
  invalidate(): void { this.generation++; }
}

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { createHarnessProgressStore, type ProgressStore } from '../progression/store';

let fallback: ProgressStore | undefined;
/** Components rendered outside the app (tests, diagnostics pages) see the harness profile: every ship open. */
const ProgressContext = createContext<ProgressStore | null>(null);
export function ProgressProvider({ store, children }: { store: ProgressStore; children: ReactNode }) {
  return <ProgressContext.Provider value={store}>{children}</ProgressContext.Provider>;
}
export function useProgressStore(): ProgressStore {
  return useContext(ProgressContext) ?? (fallback ??= createHarnessProgressStore(false));
}
/** The research profile and its store; re-renders when either changes. */
export function useProgress() {
  const store = useProgressStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return { store, snapshot };
}

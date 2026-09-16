import { createAuthClient } from 'better-auth/react';
import { assetUrl } from '../assetUrl';
export const authClient = createAuthClient({ basePath: assetUrl('api/auth'), sessionOptions: { refetchInterval: 30, refetchOnWindowFocus: true } });
let accountId: string | undefined;
const cleanup = new Set<() => void>();
export const currentAccount = () => accountId;
export function setAccount(id?: string) { if (id === accountId) return; cleanup.forEach(fn => fn()); accountId = id; }
export function onAccountChange(fn: () => void) { cleanup.add(fn); return () => { cleanup.delete(fn); }; }

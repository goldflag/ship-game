import { createAuthClient } from 'better-auth/react';
import { adminClient } from 'better-auth/client/plugins';
import { assetUrl } from '../assetUrl';
// Re-checks are rare and never focus-driven: every dev checkout and test browser shares one IP's rate limit.
// The admin plugin adds `user.role` to the session and the `/admin` page's user endpoints (`authClient.admin`).
export const authClient = createAuthClient({ basePath: assetUrl('api/auth'), sessionOptions: { refetchInterval: 300, refetchOnWindowFocus: false }, plugins: [adminClient()] });
let accountId: string | undefined;
const cleanup = new Set<() => void>();
export const currentAccount = () => accountId;
export function setAccount(id?: string) { if (id === accountId) return; cleanup.forEach(fn => fn()); accountId = id; }
export function onAccountChange(fn: () => void) { cleanup.add(fn); return () => { cleanup.delete(fn); }; }

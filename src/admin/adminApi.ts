/** The admin page's requests: players through Better Auth's admin plugin, research through `api/admin/progress`. */
import { authClient } from '../accounts/session';
import { assetUrl } from '../assetUrl';
import { sanitizeProfile, type AdminProgressAction, type ProgressProfile } from '../progression/rules';
import { toPlayer, type AdminPlayer, type PlayerRole, type RawUser, type SearchField } from './adminModel';

export class AdminRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const UNAVAILABLE = 'The accounts service is unavailable. Retry shortly.';
/** Words for a failed admin request, from its status and the API's `{ code, error }` body. */
export function requestErrorMessage(status: number, body?: { code?: string; error?: string; message?: string } | null) {
  const said = body?.error || body?.message;
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (status === 403) return 'This account is not an administrator.';
  if (status === 404) return said && body?.code !== 'not-found' ? said : 'No player has that id.';
  if (status === 400 || status === 409) return said || 'The server refused that change.';
  if (!status || status >= 500) return UNAVAILABLE;
  return said || `The request failed (${status}).`;
}

export interface PlayerQuery { search: string; field: SearchField; page: number; pageSize: number }
/** Newest accounts first. Stored emails are lower case and the search is case-sensitive, so an email search is lowered. */
export async function listPlayers({ search, field, page, pageSize }: PlayerQuery): Promise<{ players: AdminPlayer[]; total: number }> {
  const value = search.trim();
  const filter = value ? { searchValue: field === 'email' ? value.toLowerCase() : value, searchField: field, searchOperator: 'contains' as const } : {};
  let result;
  try {
    result = await authClient.admin.listUsers({ query: { ...filter, limit: pageSize, offset: page * pageSize, sortBy: 'createdAt', sortDirection: 'desc' } });
  } catch { throw new AdminRequestError(0, 'network', UNAVAILABLE); }
  if (result.error || !result.data) {
    const status = result.error?.status ?? 0;
    throw new AdminRequestError(status, result.error?.code ?? '', requestErrorMessage(status, result.error));
  }
  return { players: (result.data.users as RawUser[]).map(toPlayer), total: result.data.total };
}

export async function setPlayerRole(userId: string, role: PlayerRole): Promise<PlayerRole> {
  let result;
  try { result = await authClient.admin.setRole({ userId, role }); } catch { throw new AdminRequestError(0, 'network', UNAVAILABLE); }
  if (result.error) {
    const status = result.error.status ?? 0;
    throw new AdminRequestError(status, result.error.code ?? '', status === 403 ? 'This account may not change roles.' : requestErrorMessage(status, result.error));
  }
  return role;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** Reads a player's research profile, or applies an admin action and returns the profile it leaves. */
export async function progressRequest(userId: string, action?: AdminProgressAction, fetcher: Fetch = fetch): Promise<ProgressProfile> {
  let response: Response;
  try {
    response = await fetcher(assetUrl(`api/admin/progress/${encodeURIComponent(userId)}`), {
      method: action ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: action ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      ...(action ? { body: JSON.stringify(action) } : {}),
    });
  } catch { throw new AdminRequestError(0, 'network', UNAVAILABLE); }
  const body = await response.json().catch(() => null) as { profile?: unknown; code?: string; error?: string } | null;
  if (!response.ok || !body?.profile) {
    const status = response.ok ? 502 : response.status;
    throw new AdminRequestError(status, body?.code ?? '', response.ok ? 'The server sent no research profile.' : requestErrorMessage(status, body));
  }
  return sanitizeProfile(body.profile);
}

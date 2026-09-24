// The admin page at the base path plus `admin`: the game's own sign-in, then, for accounts whose Better Auth role is
// admin, the player list and each player's research. It never loads the game bundle. The server checks the role on
// every request; this page only chooses what to show.
import { useEffect, useState } from 'react';
import { authClient } from '../accounts/session';
import { assetUrl } from '../assetUrl';
import { SignIn } from '../ui/AccountGate';
import { AdminConsole, type AdminAccount } from './AdminConsole';
import { playerRole } from './adminModel';
import './AdminApp.css';

export const ADMIN_TITLE = 'Fleet Command · Admin';

/** Signed in, but the account's role is not admin. */
export function NotAdmin({ account, onSignOut, error }: { account: AdminAccount; onSignOut(): void; error?: string }) {
  return <main className="account-screen"><section className="account-form admin-refusal" aria-labelledby="admin-refusal-title">
    <h1 id="admin-refusal-title">{ADMIN_TITLE}</h1>
    <p>You are signed in as <b>{account.name || account.email}</b>{account.name ? <> ({account.email})</> : null}. This account is not an administrator, so the admin page is closed to it.</p>
    <p className="account-error" role="alert">{error ?? ''}</p>
    <div className="admin-refusal-actions">
      <button type="button" className="account-primary" onClick={onSignOut}>Sign out</button>
      <a href={assetUrl('')}>Back to the game</a>
    </div>
  </section></main>;
}

export function AdminChecking() {
  return <main className="account-screen" aria-busy="true"><section className="account-form">
    <h1>{ADMIN_TITLE}</h1>
    <p role="status">Checking your account…</p>
  </section></main>;
}

export function AdminApp() {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const [signOutError, setSignOutError] = useState<string>();
  useEffect(() => { document.title = ADMIN_TITLE; }, []);
  const signOut = () => {
    setSignOutError(undefined);
    authClient.signOut().then(result => { if (result.error) setSignOutError(result.error.message ?? 'Unable to sign out. Please retry.'); },
      () => setSignOutError('Account service is unavailable. Please retry shortly.'));
  };
  if (isPending) return <AdminChecking/>;
  if (!session) return <SignIn unavailable={!!error && error.status !== 401} retry={() => void refetch()} allowSignup={false}
    lede="Sign in with an administrator account to manage players and their research."/>;
  const account: AdminAccount = { id: session.user.id, name: session.user.name, email: session.user.email };
  if (playerRole(session.user.role) !== 'admin') return <NotAdmin account={account} onSignOut={signOut} error={signOutError}/>;
  return <AdminConsole key={account.id} account={account} onSignOut={signOut} onSessionLost={() => void refetch()} signOutError={signOutError}/>;
}

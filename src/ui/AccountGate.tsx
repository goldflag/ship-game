import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { authClient, setAccount } from '../accounts/session';
import './accounts.css';
import { STARTUP_INITIAL, StartupScreen, type StartupProgress } from './StartupScreen';
export interface AccountSession { name: string; signOut(): Promise<void>; }
async function signOut() { const result = await authClient.signOut(); if (result.error) throw new Error(result.error.message); setAccount(undefined); }
const Game = lazy(() => import('./App').then(module=>({default:module.App})));
export function AccountGate() {
  const {data:session,isPending,error,refetch} = authClient.useSession();
  const [active,setActive]=useState<string>();
  // One loader stays mounted from the session check through the game bundle's own startup, so the
  // progress bar never remounts. Reports are tagged by user so a stale "done" from a previous account
  // cannot hide the loader for the next one.
  const [startup,setStartup]=useState<StartupProgress&{user:string;done:boolean}>();
  // A failed re-check (rate limit, network blip, API restart) keeps the last confirmed session, so it must not
  // tear down a running game. Only a 401 or a signed-out answer clears `session`.
  useEffect(()=>{ const id=session?.user.id;setAccount(id);setActive(id);return()=>setAccount(undefined); },[session?.user.id]);
  const signedIn = !!session && active===session.user.id, user = signedIn ? session.user.id : undefined;
  // A confirmed session whose id the effect above has not yet adopted is still loading, not signed out.
  const syncing = !!session && !signedIn;
  if (!isPending && !syncing && !signedIn) return <SignIn unavailable={!!error && error.status!==401} retry={()=>void refetch()}/>;
  const report = startup?.user===user ? startup : undefined;
  const checking = isPending || syncing;
  // Same tree shape while checking the session and while the game starts, so the loader element is reused.
  // It stays mounted after `done` so it can fade into the port, then renders nothing.
  return <>
    <Suspense fallback={null}>{user && <Game key={user} account={{ name: session!.user.name, signOut }} startup={{
      progress:(label,progress)=>setStartup({user,label,progress,done:false}),
      done:()=>setStartup(current=>current?.user===user?{...current,done:true}:current),
    }}/>}</Suspense>
    <StartupScreen {...(checking ? { label: 'Checking your account', progress: 0.02 } : report ?? STARTUP_INITIAL)} done={!checking && !!report?.done}/>
  </>;
}
/** The account form. Also the admin page's sign-in (`src/admin`), which passes its own lede and offers no sign-up. */
export function SignIn({unavailable,retry,lede,allowSignup=true}:{unavailable:boolean;retry():void;lede?:string;allowSignup?:boolean}) {
  const [signup,setSignup]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setError('');
    try {
      const credentials={email:String(data.get('email')),password:String(data.get('password'))};
      const result=signup?await authClient.signUp.email({...credentials,name:String(data.get('name')).trim()}):await authClient.signIn.email(credentials);
      if(result.error) setError(result.error.message??'Unable to sign in. Please retry.');
    } catch {setError('Account service is unavailable. Please retry shortly.');} finally {setBusy(false);}
  }
  return <main className="account-screen"><section className="account-form" aria-labelledby="account-title">
    <h1 id="account-title">Fleet Command</h1><p>{signup?'Create your account to enter the harbor.':lede??'Sign in to command your fleet.'}</p>
    <form onSubmit={submit}>
      {signup&&<label>Display name<input name="name" autoComplete="nickname" required maxLength={80}/></label>}
      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
      <label>Password<input name="password" type="password" autoComplete={signup?'new-password':'current-password'} required minLength={signup?8:1} maxLength={128}/></label>
      {signup&&<small>Use at least 8 characters. Password recovery is not available yet.</small>}
      <p className="account-error" role="alert">{error || (unavailable?'Account service is unavailable. Retry to reconnect.':'')}</p>
      <button className="account-primary" disabled={busy} type="submit">{busy?'Connecting…':signup?'Create account':'Sign in'}</button>
      {unavailable&&<button type="button" onClick={retry}>Retry connection</button>}
    </form>
    {allowSignup&&<><button className="account-switch" disabled={busy} onClick={()=>{setSignup(!signup);setError('');}}>{signup?'Already have an account? Sign in':'New captain? Create an account'}</button>
    <p className="account-note">Your saved ship designs follow you across devices.</p></>}
  </section></main>;
}

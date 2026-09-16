import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { authClient, setAccount } from '../accounts/session';
import './accounts.css';
export interface AccountSession { name: string; signOut(): Promise<void>; }
async function signOut() { const result = await authClient.signOut(); if (result.error) throw new Error(result.error.message); setAccount(undefined); }
const Game = lazy(() => import('./App').then(module=>({default:module.App})));
export function AccountGate() {
  const {data:session,isPending,error,refetch} = authClient.useSession();
  const [active,setActive]=useState<string>();
  useEffect(()=>{ const id=error?undefined:session?.user.id;setAccount(id);setActive(id);return()=>setAccount(undefined); },[session?.user.id,error]);
  if (isPending) return <main className="account-screen"><p role="status">Checking your account…</p></main>;
  if (session && active===session.user.id && !error) return <><Suspense fallback={<main className="account-screen"><p role="status">Preparing the harbor…</p></main>}><Game key={active} account={{ name: session.user.name, signOut }}/></Suspense></>;
  return <SignIn unavailable={!!error} retry={()=>void refetch()}/>;
}
function SignIn({unavailable,retry}:{unavailable:boolean;retry():void}) {
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
    <h1 id="account-title">Fleet Command</h1><p>{signup?'Create your account to enter the harbor.':'Sign in to command your fleet.'}</p>
    <form onSubmit={submit}>
      {signup&&<label>Display name<input name="name" autoComplete="nickname" required maxLength={80}/></label>}
      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
      <label>Password<input name="password" type="password" autoComplete={signup?'new-password':'current-password'} required minLength={signup?8:1} maxLength={128}/></label>
      {signup&&<small>Use at least 8 characters. Password recovery is not available yet.</small>}
      <p className="account-error" role="alert">{error || (unavailable?'Account service is unavailable. Retry to reconnect.':'')}</p>
      <button className="account-primary" disabled={busy} type="submit">{busy?'Connecting…':signup?'Create account':'Sign in'}</button>
      {unavailable&&<button type="button" onClick={retry}>Retry connection</button>}
    </form>
    <button className="account-switch" disabled={busy} onClick={()=>{setSignup(!signup);setError('');}}>{signup?'Already have an account? Sign in':'New captain? Create an account'}</button>
    <p className="account-note">Your saved ship designs follow you across devices.</p>
  </section></main>;
}

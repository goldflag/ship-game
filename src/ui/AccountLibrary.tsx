import { useEffect, useState } from 'react';
import { currentAccount } from '../accounts/session';
import { recoveryDrafts, discardRecovery, openCloudConstructionStore } from '../ships/constructionCloud';
import { CONSTRUCTION_DATABASE, openConstructionStore } from '../ships/constructionStore';
import { downloadConstructionSource } from './shipbuilding/DesignsMenu';
export function AccountLibrary() {
  const [drafts,setDrafts]=useState<Awaited<ReturnType<typeof recoveryDrafts>>>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const account=currentAccount()!;
  useEffect(()=>{void recoveryDrafts(account).then(setDrafts).catch(()=>setMessage('Browser recovery storage is unavailable.'));},[account]);
  async function importLocal() {
    setBusy(true);
    const local=await openConstructionStore({name:CONSTRUCTION_DATABASE}),cloud=openCloudConstructionStore(account);
    let count=0;
    try {
      for(const head of await local.list()) {
        const {revision}=await local.load(head.id),source=JSON.parse(revision.sourceJson);
        source.id='design-'+crypto.randomUUID();source.revision='revision-'+crypto.randomUUID();
        await cloud.save({designId:source.id,name:head.name,source,schemaVersion:revision.schemaVersion,catalogRevision:revision.catalogRevision,expectedRevisionId:null});count++;
      }
      setMessage(`Imported ${count} designs as new copies. Reopen the harbor to refresh your fleet.`);
    } catch(error) {setMessage(`Imported ${count} designs. ${error instanceof Error?error.message:String(error)}`);}finally{local.close();cloud.close();setBusy(false);}
  }
  return <section aria-label="Account ship storage"><button disabled={busy} onClick={()=>void importLocal().catch(e=>{setMessage(String(e));setBusy(false);})}>Import this browser’s old designs</button>
    {drafts.length>0&&<h2>Unsaved drafts</h2>}
    {drafts.map(draft=><div key={draft.id}><span>{draft.input.name}</span><button onClick={()=>downloadConstructionSource(JSON.stringify(draft.input.source),draft.input.name)}>Download recovery</button><button onClick={()=>void discardRecovery(account,draft.id).then(()=>setDrafts(drafts.filter(d=>d.id!==draft.id))).catch(e=>setMessage(String(e)))}>Discard recovery</button></div>)}
    {drafts.length>0&&<p>Import a recovery file in the Shipbuilder to save it as a new copy.</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}

import { assetUrl } from '../assetUrl';
import { currentAccount, onAccountChange } from '../accounts/session';
import { ConstructionStoreError, type ConstructionStore, type ConstructionRevision, type SaveConstructionSource } from './constructionStore';
export interface SavedReference { designId: string; revisionId: string; sourceRevision: string; }
const saved = new Map<string,SavedReference>();
onAccountChange(() => saved.clear());
export const savedReference = (sourceId: string) => saved.get(sourceId);
function remember(revision: ConstructionRevision) {
  const source = JSON.parse(revision.sourceJson);
  saved.set(source.id,{designId:revision.designId,revisionId:revision.id,sourceRevision:source.revision});
}
interface Recovery { id: string; input: SaveConstructionSource; operation: string; updatedAt: number; }
async function recoveryDB(account: string) {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open('fleet-command-recovery-' + account,1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts',{keyPath:'id'});
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function recovery<T>(account:string,mode:IDBTransactionMode,work:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db = await recoveryDB(account);
  try { return await new Promise<T>((resolve,reject)=>{
    const tx=db.transaction('drafts',mode), request=work(tx.objectStore('drafts'));
    tx.oncomplete=()=>resolve(request.result); tx.onabort=()=>reject(tx.error); tx.onerror=()=>{};
  }); } finally { db.close(); }
}
export const recoveryDrafts = (account:string) => recovery(account,'readonly',s=>s.getAll()) as Promise<Recovery[]>;
export const discardRecovery = (account:string,id:string) => recovery(account,'readwrite',s=>s.delete(id));
export async function retainRecovery(input:SaveConstructionSource, account = currentAccount()) {
  if (!account) return;
  await recovery(account,'readwrite',s=>s.put({id:'draft:'+input.designId,input,operation:'',updatedAt:Date.now()} satisfies Recovery));
}
export function openCloudConstructionStore(account = currentAccount()): ConstructionStore {
  if (!account) throw new ConstructionStoreError('unavailable','Sign in to save your ships.');
  const owner = account; let closed=false;
  const assertOwner=()=>{ if (closed || currentAccount()!==owner) throw new ConstructionStoreError('unavailable','This editor belongs to a different session. Sign in to its account to recover the draft.'); };
  const request=async <T>(path:string,init?:RequestInit):Promise<T>=>{
    assertOwner();
    const response=await fetch(assetUrl('api/ships')+path,{...init,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','x-account-id':owner,...init?.headers}});
    assertOwner();
    if (!response.ok) { const value=await response.json().catch(()=>({})); throw new ConstructionStoreError(value.code ?? 'unavailable',value.error ?? 'Saving failed. Keep this draft and retry, or download a backup.'); }
    const value=response.status===204 ? undefined as T : await response.json();
    assertOwner(); return value;
  };
  const route=(id:string)=>'/'+encodeURIComponent(id);
  return {
    list:()=>request(''),
    async load(id) { const result=await request<Awaited<ReturnType<ConstructionStore['load']>>>(route(id));remember(result.revision);return result; },
    revisions:id=>request(route(id)+'/revisions'),
    async save(input) {
      assertOwner();
      const id='write:'+input.designId;
      const previous=await recovery(owner,'readonly',s=>s.get(id)) as Recovery|undefined;
      // Replay an uncertain write before advancing CAS; an acknowledgement may have been lost.
      let effective=input;
      if (previous && JSON.stringify(previous.input)!==JSON.stringify(input)) {
        const ack=await request<ConstructionRevision>(route(previous.input.designId),{method:'PUT',headers:{'idempotency-key':previous.operation},body:JSON.stringify(previous.input)});
        if(input.expectedRevisionId===previous.input.expectedRevisionId) effective={...input,expectedRevisionId:ack.id};
      }
      const item:Recovery={id,input:effective,operation:previous && JSON.stringify(previous.input)===JSON.stringify(effective)?previous.operation:crypto.randomUUID(),updatedAt:Date.now()};
      await recovery(owner,'readwrite',s=>s.put(item));
      const result=await request<ConstructionRevision>(route(effective.designId),{method:'PUT',headers:{'idempotency-key':item.operation},body:JSON.stringify(effective)});
      remember(result); await discardRecovery(owner,id);
      const db=await recoveryDB(owner);
      try { await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),read=store.get('draft:'+input.designId);
        read.onsuccess=()=>{ const draft=read.result as Recovery|undefined; if(draft && JSON.stringify(draft.input.source)===JSON.stringify(input.source))store.delete(draft.id); };
        tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
      }); } finally {db.close();}
      assertOwner(); return result;
    },
    async remove(id,revisionId) { await request(route(id),{method:'DELETE',headers:{'if-match':revisionId}}); },
    close(){closed=true;},
  };
}

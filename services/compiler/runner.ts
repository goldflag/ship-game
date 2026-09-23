/** Largest compiler output and artifact. A realistic battleship compiles to about 28 MB of JSON. */
export const OUTPUT_LIMIT=64*1024*1024;
export async function boundedRead(stream: ReadableStream<Uint8Array>, limit:number) {
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
 try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Compiler output limit exceeded');chunks.push(value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
export async function runCompiler(command:string[],timeoutMs=10_000,outputLimit=OUTPUT_LIMIT) {
 const child=Bun.spawn(command,{stdout:'pipe',stderr:'pipe',env:{}});let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Compiler exceeded wall timeout'));},timeoutMs);});
  const [output,,code]=await Promise.race([Promise.all([boundedRead(child.stdout,outputLimit),boundedRead(child.stderr,64*1024),child.exited]),timeout]);
  if(code!==0)throw new Error('Compiler failed or exceeded its memory limit');return output;
 } finally {clearTimeout(timer);child.kill('SIGKILL');await child.exited;}
}
export class JobQueue {
 private accounts=new Set<string>();private queue:(()=>Promise<void>)[]=[];private running=false;
 get status(){return {running:this.running,queued:this.queue.length};}
 async submit<T>(account:string,work:()=>Promise<T>):Promise<T> {
  if(this.accounts.has(account)||this.queue.length>=8)throw new Error('Compiler queue is full. Retry shortly.');
  this.accounts.add(account);
  return new Promise<T>((resolve,reject)=>{this.queue.push(async()=>{try{resolve(await work());}catch(error){reject(error);}finally{this.accounts.delete(account);}});void this.drain();});
 }
 private async drain(){if(this.running)return;this.running=true;try{while(this.queue.length)await this.queue.shift()!();}finally{this.running=false;}}
}

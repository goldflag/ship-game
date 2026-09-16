import {test,expect} from 'bun:test';
import {runCompiler,JobQueue} from './runner';
test('compiler timeout, oversized stdout/stderr and killed jobs fail without blocking the next job',async()=>{
 const binary=process.execPath;
 await expect(runCompiler([binary,'-e','setInterval(()=>{},100)'],60)).rejects.toThrow('timeout');
 await expect(runCompiler([binary,'-e','process.stdout.write("x".repeat(10000))'],1000,100)).rejects.toThrow('output limit');
 await expect(runCompiler([binary,'-e','process.stderr.write("x".repeat(100000))'],1000)).rejects.toThrow('output limit');
 await expect(runCompiler([binary,'-e','process.kill(process.pid,"SIGKILL")'],1000)).rejects.toThrow('failed');
 expect(await runCompiler([binary,'-e','process.stdout.write("ok")'])).toBe('ok');
});
test('one active job, eight waiting, and one outstanding job per account',async()=>{
 const queue=new JobQueue();let unblock!:()=>void;const barrier=new Promise<void>(r=>unblock=r);
 const first=queue.submit('first',()=>barrier);await expect(queue.submit('first',async()=>0)).rejects.toThrow('queue is full');
 const waiting=Array.from({length:8},(_,i)=>queue.submit(String(i),async()=>i));
 expect(queue.status).toEqual({running:true,queued:8});await expect(queue.submit('ninth',async()=>0)).rejects.toThrow('queue is full');
 unblock();await first;expect(await Promise.all(waiting)).toEqual([0,1,2,3,4,5,6,7]);
 expect(await queue.submit('first',async()=>42)).toBe(42);
});

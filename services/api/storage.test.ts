import {expect,test} from 'bun:test';
import {validateSave} from './storage';
test('source envelopes retain physical errors but reject identity, schema and source size violations',()=>{
 const input={designId:'draft',name:'Broken hull',schemaVersion:1,catalogRevision:'a'.repeat(64),expectedRevisionId:null,source:{id:'draft',revision:'draft-rev',schemaVersion:1,construction:{catalogRevision:'a'.repeat(64),primitives:[]}}};
 expect(JSON.parse(validateSave(input)).construction.primitives).toEqual([]);
 expect(()=>validateSave({...input,schemaVersion:2})).toThrow();
 expect(()=>validateSave({...input,catalogRevision:'substituted'})).toThrow();
 expect(()=>validateSave({...input,source:{...input.source,padding:'x'.repeat(16*1024*1024)}})).toThrow('16 MiB');
});

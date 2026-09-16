import {expect,test} from 'bun:test';
import {enforceDerivedLimits} from './limits';
test('online cell budget includes compartment subdivision as well as the hull',()=>{
 const definition=(hull:number,rooms:number,patches=4096)=>({hull:{volume:{cells:Array(hull),surfaces:Array(patches)}},compartments:[{volumes:Array(rooms)}]});
 expect(()=>enforceDerivedLimits(definition(1000,1048))).not.toThrow();
 expect(()=>enforceDerivedLimits(definition(1000,1049))).toThrow('hull and compartments');
 expect(()=>enforceDerivedLimits(definition(1,1,4097))).toThrow('surface patches');
});

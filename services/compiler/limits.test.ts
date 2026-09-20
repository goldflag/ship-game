import {expect,test} from 'bun:test';
import {enforceDerivedLimits,enforceSourceLimits} from './limits';
test('online cell budget includes compartment subdivision as well as the hull',()=>{
 const definition=(hull:number,rooms:number,patches=4096)=>({hull:{volume:{cells:Array(hull),surfaces:Array(patches)}},compartments:[{volumes:Array(rooms)}]});
 expect(()=>enforceDerivedLimits(definition(1000,1048))).not.toThrow();
 expect(()=>enforceDerivedLimits(definition(1000,1049))).toThrow('hull and compartments');
 expect(()=>enforceDerivedLimits(definition(1,1,4097))).toThrow('surface patches');
});
test('custom fitting instances are counted apart from the 32 catalog equipment instances',()=>{
 const source=(catalog:number,custom:number,definitions=1)=>({construction:{primitives:[{}],fittings:Array(definitions).fill({}),
  equipment:[...Array(catalog).fill({partId:'generic-bollard'}),...Array(custom).fill({partId:'design:fit-bollard'})]}});
 expect(()=>enforceSourceLimits(source(32,96,16))).not.toThrow();
 expect(()=>enforceSourceLimits({construction:{primitives:[{}],equipment:[]}})).not.toThrow();
 expect(()=>enforceSourceLimits(source(33,0))).toThrow('32 equipment instances');
 expect(()=>enforceSourceLimits(source(0,97))).toThrow('96 custom fitting instances');
 expect(()=>enforceSourceLimits(source(0,1,17))).toThrow('16 custom fitting definitions');
});

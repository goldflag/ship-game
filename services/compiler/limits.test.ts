import {expect,test} from 'bun:test';
import {enforceDerivedLimits,enforceSourceLimits} from './limits';
test('online designs carry the local limits: any derived cell and patch count the compiler accepts',()=>{
 const definition=(hull:number,rooms:number,patches:number)=>({hull:{volume:{cells:Array(hull),surfaces:Array(patches)}},compartments:[{volumes:Array(rooms)}]});
 expect(()=>enforceDerivedLimits(definition(7208,2000,8772))).not.toThrow();
 expect(()=>enforceDerivedLimits({hull:{}})).toThrow('Missing derived construction geometry');
});
test('online sources are not capped below the local equipment and fitting limits',()=>{
 const source=(catalog:number,custom:number,definitions=1)=>({construction:{primitives:[{}],fittings:Array(definitions).fill({}),
  equipment:[...Array(catalog).fill({partId:'generic-bollard'}),...Array(custom).fill({partId:'design:fit-bollard'})]}});
 expect(()=>enforceSourceLimits(source(174,40,7))).not.toThrow();
 expect(()=>enforceSourceLimits(source(1000,1000,32))).not.toThrow();
 expect(()=>enforceSourceLimits({construction:{primitives:[{}],equipment:[]}})).not.toThrow();
 expect(()=>enforceSourceLimits({construction:{primitives:[{}]}})).toThrow('Invalid construction source');
 expect(()=>enforceSourceLimits({construction:{primitives:[{}],equipment:[],fittings:{}}})).toThrow('Invalid custom fitting definitions');
});

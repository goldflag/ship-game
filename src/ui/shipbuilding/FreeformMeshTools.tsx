import { useState } from 'react';
import type { ConstructionPrimitive } from '../../ships/blueprint';
import { editPrismOutline, insertMeshRing, removeMeshRing, scaleMeshRing } from '../../ships/constructionMesh';
import { selectionLabel, topology, type HullSelection } from '../../ships/constructionVertex';
import { NumberField } from './NumberField';

export function FreeformMeshTools({primitive:p,selection,onCommit,onSelect}:{primitive:ConstructionPrimitive;selection:HullSelection;onCommit(p:ConstructionPrimitive[]):unknown;onSelect(s:HullSelection):void}){
  const m=p.mesh!,t=topology(p),[point,setPoint]=useState(0);
  const count=selection.mode==='vertex'?t.vertices.length:selection.mode==='edge'?t.edges.length:selection.mode==='face'?t.faces.length:t.rings.length;
  const ring=selection.mode==='ring'?selection.index:Math.max(0,m.rings.findIndex(r=>r.includes(selection.mode==='vertex'?selection.index:-1)));
  const commit=(next:ConstructionPrimitive,selected:HullSelection={mode:'vertex',index:0})=>{onCommit([next]);onSelect(selected);};
  const width=(axis:0|2)=>{const values=m.rings[ring].map(i=>m.vertices[i][axis]*p.size[axis]);return Math.max(...values)-Math.min(...values);};
  return <div className="sb-shape-tools sb-mesh-tools">
    <div className="sb-shape-fields">
      <label>Selected <select aria-label="Selected shape element" value={selection.index} onChange={e=>onSelect({...selection,index:Number(e.target.value)})}>{Array.from({length:count},(_,i)=><option key={i} value={i}>{selectionLabel({...selection,index:i},p)}</option>)}</select></label>
      <span>{m.vertices.length} vertices · {m.faces.length} faces</span>
    </div>
    {!!m.rings.length&&<div className="sb-shape-fields" role="group" aria-label="Cross-section controls">
      <label>{m.family==='prism'?'Outline':'Ring'} <select aria-label="Control ring" value={ring} onChange={e=>onSelect({mode:'ring',index:Number(e.target.value)})}>{m.rings.map((_,i)=><option key={i} value={i}>{i===0?'Base':i===m.rings.length-1?'Top':`Ring ${i+1}`}</option>)}</select></label>
      {m.rings[ring].length>1&&([0,2] as const).map(axis=><NumberField key={axis} label={axis===0?'Width':'Depth'} value={width(axis)} min={.05} max={200} step={.1} unit="m" onChange={value=>commit(scaleMeshRing(p,ring,axis,value/Math.max(width(axis),1e-8)),{mode:'ring',index:ring})}/>)}
      {m.family==='rings'&&<><button disabled={ring===m.rings.length-1||m.rings.length>=24||m.vertices.length+m.rings[ring].length>256} onClick={()=>commit(insertMeshRing(p,ring),{mode:'ring',index:ring+1})}>Add ring above</button><button disabled={ring===0||ring===m.rings.length-1} onClick={()=>commit(removeMeshRing(p,ring),{mode:'ring',index:Math.max(0,ring-1)})}>Remove ring</button></>}
    </div>}
    {m.family==='prism'&&<div className="sb-shape-fields" role="group" aria-label="Prism outline controls">
      <label>Outline point <select aria-label="Outline point" value={Math.min(point,m.rings[0].length-1)} onChange={e=>{setPoint(Number(e.target.value));onSelect({mode:'vertex',index:m.rings[0][Number(e.target.value)]});}}>{m.rings[0].map((_,i)=><option key={i} value={i}>{i+1}</option>)}</select></label>
      <button disabled={m.rings[0].length>=32} onClick={()=>commit(editPrismOutline(p,Math.min(point,m.rings[0].length-1),false))}>Add outline point</button>
      <button disabled={m.rings[0].length<=3} onClick={()=>{commit(editPrismOutline(p,Math.min(point,m.rings[0].length-1),true));setPoint(0);}}>Remove outline point</button>
      <span>Drag the top outline to offset it; resize it to taper.</span>
    </div>}
  </div>;
}

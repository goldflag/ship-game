import { useState } from 'react';
import type { ConstructionPrimitive, ConstructionFreeformShape } from '../../ships/blueprint';
import { shapeOf, radiusLimit, mirroredIndices } from '../../ships/freeformShape';
import { VERTEX_EDGES, type HullSelection, type MirrorAxes } from '../../ships/constructionVertex';
import { NumberField } from './NumberField';

export function FreeformShapeTools({ primitive:p, selection, axes, onCommit, onSelect }: {
  primitive:ConstructionPrimitive; selection:HullSelection; axes:MirrorAxes;
  onCommit(replacements:ConstructionPrimitive[]):unknown; onSelect(selection:HullSelection):void;
}) {
  const [open,setOpen]=useState(false);
  const s=shapeOf(p),limit=radiusLimit(p);
  const commit=(patch:Partial<ConstructionFreeformShape>)=>onCommit([{...structuredClone(p),kind:'vertex',shaping:{...s,...patch}}]);
  const toggleEdge=(edge:number)=>{
    const indices=mirroredIndices('edge',[edge],axes),edges=new Set(s.edges),remove=indices.every(i=>edges.has(i));
    indices.forEach(i=>remove?edges.delete(i):edges.add(i));commit({edges:[...edges].sort((a,b)=>a-b),radius:s.radius||Math.min(.25,limit)});
  };
  return <div className="sb-shape-tools">
    <div className="sb-shape-tabs" role="group" aria-label="Shape tools">
      <button aria-expanded={open} onClick={()=>setOpen(!open)}>Round / chamfer</button>
      {p.shaping && <button onClick={()=>{const {shaping:_,...plain}=p;onCommit([plain]);onSelect({mode:'vertex',index:0});}}>Remove edge treatment</button>}
    </div>
    {open && <div className="sb-shape-panel">
        <div className="sb-shape-fields"><span>Edges to treat</span><button onClick={()=>commit({edges:VERTEX_EDGES.map((_,i)=>i),radius:s.radius||Math.min(.25,limit)})}>All edges</button><button onClick={()=>commit({edges:[]})}>Clear edges</button>
          {selection.mode==='edge' && <button onClick={()=>toggleEdge(selection.index)}>Toggle selected edge</button>}
        </div>
        <div className="sb-edge-choices" role="group" aria-label="Treated edges">{VERTEX_EDGES.map((_,i)=><button key={i} aria-label={`Treat edge ${i+1}`} aria-pressed={s.edges.includes(i)} onClick={()=>toggleEdge(i)} onMouseEnter={()=>onSelect({mode:'edge',index:i})}>{i+1}</button>)}</div>
        <div className="sb-shape-fields"><button aria-pressed={s.style==='round'} onClick={()=>commit({style:'round'})}>Round</button><button aria-pressed={s.style==='chamfer'} onClick={()=>commit({style:'chamfer'})}>Chamfer</button><NumberField label={s.style==='round'?'Radius':'Cut width'} value={s.radius} min={0} max={limit} step={.05} unit="m" onChange={radius=>commit({radius})}/></div>
        <p>Local mirror axes apply to edge selection. One radius for the treated edges; 0 restores sharp edges. Maximum {limit.toFixed(2)} m.</p>
    </div>}
  </div>;
}

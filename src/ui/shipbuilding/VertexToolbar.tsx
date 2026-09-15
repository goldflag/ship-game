import type { ConstructionPrimitive, Vec3 } from '../../ships/blueprint';
import { cornerVertices, editableCorners, type MirrorAxes } from '../../ships/constructionVertex';
import { NumberField } from './NumberField';
import type { BuilderView } from './BuilderViewport';
export interface VertexSettings {symmetry:boolean;axes:MirrorAxes;unit:number;axis:boolean;snap:boolean;splitAxis:number;count:number;corner:number}
export function VertexToolbar({primitive,settings:s,onChange,cycleUnit,onCoordinate,onView,perspective,onProjection,onReset,onSplit,onExit}: {
  primitive:ConstructionPrimitive;settings:VertexSettings;onChange(patch:Partial<VertexSettings>):void;cycleUnit():void;
  onCoordinate(axis:number,value:number):void;onView(view:BuilderView):void;perspective:boolean;onProjection():void;onReset():void;onSplit():void;onExit():void;
}) {
  const corners=editableCorners(s.symmetry,s.axes),position=cornerVertices(primitive)[s.corner].map((n,k)=>n*primitive.size[k]) as Vec3;
  return <section className="sb-vertex-tools" aria-label="Vertex hull editor">
    <div className="sb-vertex-title"><strong>Vertex hull</strong><span>{corners.length} editable {corners.length===1?'corner':'corners'}</span><button onClick={onExit}>Done <kbd>Esc</kbd></button></div>
    <div className="sb-vertex-controls">
      <div className="sb-vertex-group"><button aria-pressed={s.symmetry} onClick={()=>onChange({symmetry:!s.symmetry})} title="Mirror corner edits within this block">Symmetry</button>
        <div className="sb-vertex-axes">{['X','Y','Z'].map((a,k)=><button key={a} disabled={!s.symmetry} aria-label={`Mirror ${a}`} aria-pressed={s.axes[k]} onClick={()=>{const axes:MirrorAxes=[...s.axes];axes[k]=!axes[k];onChange({axes});}}>{a}</button>)}</div></div>
      <div className="sb-vertex-group"><button className="sb-unit" onClick={cycleUnit} title="Cycle move increments: 0.05, 0.1, 0.2, 0.5, 1, 2 m (G)">Unit <b>{s.unit} m</b><kbd>G</kbd></button></div>
      <div className="sb-vertex-group"><button aria-pressed={s.axis} onClick={()=>onChange({axis:!s.axis})} title="On: first drag direction locks one local axis. Off: move in the coordinate plane facing you.">Axis <b>{s.axis?'On':'Off'}</b></button><button aria-pressed={s.snap} onClick={()=>onChange({snap:!s.snap})} title="Also move nearby corners of other cube and vertex hull blocks">Snap <b>{s.snap?'On':'Off'}</b></button></div>
      <div className="sb-vertex-group"><div className="sb-vertex-views">{(['side','top','bow'] as const).map(v=><button key={v} onClick={()=>onView(v)}>{v==='side'?'Side':v==='top'?'Top':'Bow'}</button>)}</div><button onClick={onProjection} title="Toggle orthographic and perspective cameras (O)">{perspective?'Perspective':'Orthographic'} <kbd>O</kbd></button></div>
      <div className="sb-vertex-group"><div className="sb-vertex-axes">{['X','Y','Z'].map((a,k)=><button key={a} aria-label={`Split ${a}`} aria-pressed={s.splitAxis===k} onClick={()=>onChange({splitAxis:k})}>{a}</button>)}</div><div className="sb-vertex-split"><button onClick={onSplit}>Split</button><NumberField label="Count" value={s.count} min={2} max={16} onChange={count=>onChange({count:Math.round(count)})}/></div></div>
      <div className="sb-vertex-group"><button onClick={onReset} title="Restore this block to the shape it had when this edit session began">Reset edit</button></div>
    </div>
    <div className="sb-vertex-coordinates"><span>Corner {s.corner+1}</span>{['X','Y','Z'].map((a,k)=><NumberField key={`${primitive.id}-${s.corner}-${a}`} label={`Corner ${a}`} value={position[k]} min={-1000} max={1000} step={s.unit} unit="m" onChange={value=>onCoordinate(k,value)}/>)}<span>{s.snap?'Nearby corners move together':'This block only'}</span></div>
    <p>Drag a corner to shape. {s.axis?'First drag direction locks the axis.':'Drag in the plane facing you.'} Right-click or Esc cancels a drag.</p>
  </section>;
}

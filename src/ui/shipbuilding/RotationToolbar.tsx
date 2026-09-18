import type { ConstructionPrimitive } from '../../ships/blueprint';
import { blockAngles } from '../../ships/constructionOrientation';
import type { BuilderTool } from './builderTool';
import { NumberField } from './NumberField';
import { blockDimensions, dimensionText } from './blockDimensions';

export function RotationToolbar({ tool, preview }: { tool: BuilderTool; preview?: ConstructionPrimitive }) {
  const s = tool.getSnapshot(), primitive = tool.rotationPrimitive;
  const angles = primitive ? blockAngles(preview?.id === primitive.id ? preview : primitive) : undefined;
  return <section className="sb-rotation-tools" aria-label="Block rotation editor">
    <div className="sb-rotation-title"><b>Rotate block</b><span>{primitive ? dimensionText(blockDimensions(primitive)) : 'Select one block to rotate'}</span><button onClick={() => tool.setTool('select')}>Done <kbd>Esc</kbd></button></div>
    {angles && <>
      <div className="sb-rotation-axes" role="group" aria-label="Rotation axis">{['Pitch', 'Yaw', 'Roll'].map((name, axis) => <button key={name} data-axis={'XYZ'[axis]} aria-pressed={s.rotationAxis === axis} onClick={() => tool.setRotationAxis(axis)}><kbd>{'XYZ'[axis]}</kbd> {name}</button>)}</div>
      <div className="sb-rotation-actions"><button onClick={() => tool.rotateBlock(s.rotationAxis, -90)} title="Rotate −90° about the selected ship axis (Shift+R)">−90° <kbd>⇧R</kbd></button><button onClick={() => tool.rotateBlock(s.rotationAxis, 90)} title="Rotate +90° about the selected ship axis (R)">+90° <kbd>R</kbd></button><button aria-pressed={s.rotationSnap} onClick={tool.toggleRotationSnap}>Snap 15°</button></div>
      <div className="sb-rotation-values">{['Pitch', 'Yaw', 'Roll'].map((name, axis) => <NumberField key={name} label={name} value={angles[axis]} min={-360} max={360} step={1} unit="°" onChange={value => tool.setBlockAngle(axis, value)}/>)}<button onClick={tool.resetBlockRotation}>Reset</button><small>Shift: fine · Esc: cancel</small></div>
    </>}
  </section>;
}

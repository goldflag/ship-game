import { useEffect, useState } from 'react';
import type { ConstructionData, ConstructionFittingDefinition } from '../../ships/blueprint';
import type { ConstructionCommand } from '../../ships/constructionCommands';
import {
  customFittingFault,
  customFittingInstances,
  newCustomFittingId,
  resolveCustomFitting,
} from '../../ships/constructionCustomFittings';
import { CONSTRUCTION_PAINTS, constructionPaintColor } from '../../ships/constructionPaints';
import { Select, SelectOption } from '../components';
import { formatTonnes } from './builderLayers';

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** One design-local fitting definition: rename, its mass and shape count, repaint visual mesh groups, duplicate
 * and delete. Shown on a selected instance and beside the Custom shelf's active card. Shapes are not edited here yet;
 * a visual mesh is a unit (no vertex editing). */
export function CustomFittingFields({
  definition,
  data,
  locked,
  run,
}: {
  definition: ConstructionFittingDefinition;
  data: ConstructionData;
  locked: boolean;
  run(label: string, commands: ConstructionCommand[]): unknown;
}) {
  const [name, setName] = useState(definition.name);
  useEffect(() => setName(definition.name), [definition.id, definition.name]);
  const used = customFittingInstances(data, definition.id).length,
    fault = customFittingFault(definition);
  const mass = fault ? undefined : resolveCustomFitting(definition).massKg;
  const meshes = definition.meshes ?? [],
    meshTriangles = meshes.reduce((sum, mesh) => sum + mesh.triangles, 0);
  const shapes = [
    ...(definition.solids.length || !meshes.length ? [plural(definition.solids.length, 'solid')] : []),
    ...(definition.tubes.length || !meshes.length ? [plural(definition.tubes.length, 'tube')] : []),
    ...(meshes.length ? [`mesh, ${plural(meshTriangles, 'triangle')}`] : []),
  ];
  // Each painted group of a visual mesh stays repaintable; unpainted groups follow the instance and ship paint.
  const groups = meshes.flatMap((mesh, m) =>
    (mesh.groups ?? []).map((group, g) => ({ mesh: m, group: g, label: group.name ?? `${mesh.id} ${g + 1}`, paint: group.paint })),
  );
  const repaint = (m: number, g: number, paint: string) =>
    run('Repaint mesh group', [
      {
        op: 'fitting-patch',
        id: definition.id,
        changes: {
          meshes: meshes.map((mesh, i) =>
            i !== m
              ? mesh
              : {
                  ...mesh,
                  groups: mesh.groups!.map((group, j) =>
                    j !== g ? group : paint ? { ...group, paint } : (({ paint: _, ...rest }) => rest)(group),
                  ),
                },
          ),
        },
      },
    ]);
  const rename = () => {
    const next = name.trim().slice(0, 80);
    if (!next || next === definition.name) setName(definition.name);
    else run('Rename custom fitting', [{ op: 'fitting-patch', id: definition.id, changes: { name: next } }]);
  };
  return (
    <span className="sb-custom-fitting">
      <input
        className="sb-link"
        aria-label="Custom fitting name"
        value={name}
        maxLength={80}
        disabled={locked}
        onChange={(event) => setName(event.target.value)}
        onBlur={rename}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setName(definition.name);
            event.currentTarget.blur();
          }
        }}
      />
      <span title={fault ? `Custom fitting ${definition.id} ${fault}` : 'Shape volume × material density × fill, or the explicit mass'}>
        {mass === undefined ? 'invalid shape' : formatTonnes(mass)} · {shapes.join(' · ')} · used ×{used}
      </span>
      {groups.map(({ mesh, group, label, paint }) => (
        <Select
          key={`${mesh}:${group}`}
          aria-label={`Paint of mesh group ${label}`}
          disabled={locked}
          value={paint ?? ''}
          onValueChange={(next) => repaint(mesh, group, next)}
        >
          <SelectOption value="">{label}: instance paint</SelectOption>
          {CONSTRUCTION_PAINTS.map((entry) => (
            <SelectOption key={entry.id} value={entry.id}>
              <span className="hs-paint-swatch" style={{ background: constructionPaintColor(entry.id) }} />
              {label}: {entry.name}
            </SelectOption>
          ))}
        </Select>
      ))}
      <button
        className="sb-link"
        disabled={locked}
        title="A separate copy of this shape; existing instances keep the original"
        onClick={() => {
          const id = newCustomFittingId(data, definition.id);
          run('Duplicate custom fitting', [
            { op: 'fitting', value: { ...structuredClone(definition), id, name: `${definition.name} copy`.slice(0, 80) } },
          ]);
        }}
      >
        Duplicate definition
      </button>
      <button
        className="sb-link"
        disabled={locked || used > 0}
        title={
          used
            ? `Fitted ${used} time${used === 1 ? '' : 's'} in this design; remove those instances first`
            : 'Remove this shape from the design'
        }
        onClick={() => run('Delete custom fitting', [{ op: 'remove', ids: [definition.id] }])}
      >
        Delete definition
      </button>
    </span>
  );
}

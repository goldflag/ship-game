import { useEffect, useState } from 'react';
import type { ConstructionData, ConstructionFittingDefinition } from '../../ships/blueprint';
import type { ConstructionCommand } from '../../ships/constructionCommands';
import { customFittingFault, customFittingInstances, newCustomFittingId, resolveCustomFitting } from '../../ships/constructionCustomFittings';
import { formatTonnes } from './builderLayers';

/** One design-local fitting definition: rename, its mass and shape count, duplicate and delete.
 * Shown on a selected instance and beside the Custom shelf's active card. Shapes are not edited here yet. */
export function CustomFittingFields({ definition, data, locked, run }: {
  definition: ConstructionFittingDefinition;
  data: ConstructionData;
  locked: boolean;
  run(label: string, commands: ConstructionCommand[]): unknown;
}) {
  const [name, setName] = useState(definition.name);
  useEffect(() => setName(definition.name), [definition.id, definition.name]);
  const used = customFittingInstances(data, definition.id).length, fault = customFittingFault(definition);
  const mass = fault ? undefined : resolveCustomFitting(definition).massKg;
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
          if (event.key === 'Escape') { setName(definition.name); event.currentTarget.blur(); }
        }}
      />
      <span title={fault ? `Custom fitting ${definition.id} ${fault}` : 'Shape volume × material density × fill, or the explicit mass'}>
        {mass === undefined ? 'invalid shape' : formatTonnes(mass)} · {definition.solids.length} solid{definition.solids.length === 1 ? '' : 's'} ·{' '}
        {definition.tubes.length} tube{definition.tubes.length === 1 ? '' : 's'} · used ×{used}
      </span>
      <button
        className="sb-link"
        disabled={locked}
        title="A separate copy of this shape; existing instances keep the original"
        onClick={() => {
          const id = newCustomFittingId(data, definition.id);
          run('Duplicate custom fitting', [{ op: 'fitting', value: { ...structuredClone(definition), id, name: `${definition.name} copy`.slice(0, 80) } }]);
        }}
      >
        Duplicate definition
      </button>
      <button
        className="sb-link"
        disabled={locked || used > 0}
        title={used ? `Fitted ${used} time${used === 1 ? '' : 's'} in this design; remove those instances first` : 'Remove this shape from the design'}
        onClick={() => run('Delete custom fitting', [{ op: 'remove', ids: [definition.id] }])}
      >
        Delete definition
      </button>
    </span>
  );
}

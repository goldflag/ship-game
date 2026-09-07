"""Stable barrel layout matching src/ships/blueprint.ts; Blender axes."""
def barrel_layout(spec):
    count = spec.get('barrelCount', 2)
    ids = {1: ['center'], 2: ['left', 'right'], 3: ['left', 'center', 'right'],
           4: ['left-outer', 'left', 'right', 'right-outer']}
    if count == 8:
        names = [row + '-' + side for row in ['lower', 'upper'] for side in ids[4]]
        return [(name, (1.5 - index % 4) * spec['barrelSpacing'],
                 (-.5 if index < 4 else .5) * spec['barrelVerticalSpacing']) for index, name in enumerate(names)]
    return [(name, ((count - 1) / 2 - index) * spec['barrelSpacing'], 0) for index, name in enumerate(ids[count])]

/** Palette cards and rail entries.
 * Each function runs as a `BuilderTool` member: the class binds it under the same name. */
import type { BuilderToolId, RailEntry, SlotItem } from '../builderLayers';
import { fittingCategory, fittingNation } from '../fittingCategories';
import type { BuilderTool } from '../builderTool';

/** Choose a card: true when it acted, so the caller closes the drawer and its tooltip. */
export function toggleSlot(this: BuilderTool, item: SlotItem): boolean {
  if (this.locked || item.kind === 'empty') return false;
  // Armor has no Select to fall back to: pressing the active card again keeps its brush.
  if (this.state.layer === 'armor' && this.active?.id === item.id) {
    if (this.state.tool !== 'area') this.setTool('apply');
    return true;
  }
  if (this.state.tool !== 'select' && this.active?.id === item.id && item.kind !== 'scheme') {
    this.update({ tool: 'select', pathPoints: [] });
    return true;
  }
  const acted = this.selectSlot(item);
  if (acted && this.state.tool === 'select' && !this.state.surfaces.size && ['armor', 'thickness', 'opening', 'paint'].includes(item.kind))
    this.setTool('apply');
  return acted;
}

export function selectSlot(this: BuilderTool, item: SlotItem): boolean {
  if (item.kind === 'empty' || this.locked) return false;
  const { layer, tool, surfaces } = this.state;
  // A fitting found by search may sit on another shelf or under another nation: the bar follows it there.
  let fittingFilter = this.state.fittingFilter;
  if (layer === 'fittings' && item.kind === 'part' && !this.palette.drawer.includes(item)) {
    const nation = fittingNation(item.part);
    fittingFilter = {
      category: fittingCategory(item.part, this.catalog),
      nation: nation && fittingFilter.nation !== 'all' && nation !== fittingFilter.nation ? 'all' : fittingFilter.nation,
    };
  }
  this.update({ pathPoints: [], slots: { ...this.state.slots, [layer]: item.id }, sizeOverride: undefined, fittingFilter });
  const faceTools: BuilderToolId[] = ['apply', 'area', 'eyedrop', 'opening', 'select'];
  switch (item.kind) {
    case 'shape':
      this.clearSelection();
      if (tool !== 'place' && tool !== 'fill') this.setTool('place');
      break;
    case 'thickness':
      this.update({ customMm: item.mm }); // falls through: a value card behaves as the Armor card holding that value
    case 'armor':
    case 'opening':
    case 'paint':
      if (item.kind === 'paint' && this.selectedEquipment.length) {
        this.paintFittings([...this.state.selected], item.id);
        break;
      }
      // Armor cards only load the bucket; Paint may still assign a hand-built face selection.
      if (layer === 'armor') {
        if (tool !== 'area') this.setTool('apply');
      } else if (surfaces.size) this.applyItem(item, surfaces);
      else if (!faceTools.includes(tool)) this.setTool('apply');
      break;
    case 'scheme':
      this.applyScheme(item.id);
      break;
    case 'tool':
      this.setTool(item.tool);
      break;
    case 'part':
      this.clearSelection();
      this.setTool(layer === 'internals' ? 'module' : 'place');
      break;
  }
  return true;
}

export function activateRail(this: BuilderTool, entry: RailEntry) {
  if (this.locked) return;
  if (entry.kind === 'tool') {
    this.setTool(entry.id);
    if (entry.id === 'measure') {
      this.update({ measure: undefined });
      this.clearSelection();
    } else if (entry.id !== 'select') this.update({ surfaces: new Set() });
  } else if (entry.id === 'rotate') this.rotate();
  else if (entry.id === 'suggest') void this.suggest(this.state.layer === 'fittings');
}

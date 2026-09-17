import { armorThicknessColor, type ArmorScale } from '../../ships/inspection';
import type { SlotItem } from './builderLayers';

/** 20 px line glyphs for the tool rail and hotbar, in the naval icon family. */
const TOOL_PATHS: Record<string, string> = {
  Select: 'M5 3l11 7-5 1-2 5z', Place: 'M10 3l7 4v7l-7 4-7-4V7zM10 11v7M3 7l7 4 7-4', Fill: 'M3 3h14v14H3zM3 8h14M3 12.5h14M8 3v14M12.5 3v14',
  Erase: 'M3 3h14v14H3zM7 7l6 6M13 7l-6 6', Paint: 'M4 16c0-3 2-4 4-4l8-8 2 2-8 8c0 2-1 4-4 4z', Mirror: 'M10 2v16M3 5l5 5-5 5zM17 5l-5 5 5 5z',
  Measure: 'M2 14 14 2l4 4L6 18zM6 10l2 2M9 7l2 2M12 4l2 2', Deck: 'M3 3h14v14H3zM3 10h14', Bulkhead: 'M3 3h14v14H3zM10 3v14', Split: 'M3 3h14v14H3zM3 10h14M6 10v7M14 10v7',
  Merge: 'M3 5h6v10H3zM11 5h6v10h-6zM9 10h2', Module: 'M3 6h14v8H3zM6 6V4h8v2M6 14v2h8v-2', Opening: 'M3 3h5M12 3h5M17 3v14H3V3', Rotate: 'M16 10a6 6 0 1 1-2-4.5M14 2v4h-4',
  Arc: 'M10 17V4a13 13 0 0 1 8 8z', Suggest: 'M10 2v5M10 13v5M2 10h5M13 10h5M5 5l3 3M12 12l3 3M15 5l-3 3M8 12l-3 3', Area: 'M3 3h14v14H3z', Eyedrop: 'M3 17l7-7M12 4l4 4-6 6-4-4z',
  Fitting: 'M6 11a4 4 0 1 0 8 0 4 4 0 1 0-8 0M10 7V2M6 17h8', Part: 'M3 8h14v6H3zM6 8V5h8v3',
  View: 'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM7.5 10a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  Perspective: 'M3 3h14v14H3zM7 7h6v6H7zM3 3l4 4M17 3l-4 4M3 17l4-4M17 17l-4-4', Orthographic: 'M3 7h10v10H3zM7 3h10v10h-4M3 7l4-4M13 7l4-4',
  Slice: 'M4 15V7l6 3v8zM10 10l6-3v8l-6 3M4 7l6-3 6 3M1 12h18', Centers: 'M10 3v3M10 14v3M3 10h3M14 10h3M7 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  Snap: 'M3 7.5h14M3 12.5h14M7.5 3v14M12.5 3v14', Fit: 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 8h6v4H7z',
  Hull: 'M2 8h16l-3 6H5zM10 8V4M7 8V6', Armor: 'M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z',
  Keys: 'M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM7.7 8a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1 .9-1 1.6v.4M10 14.6v.4',
};
const SHAPE_PATHS: Record<string, string> = {
  cube: 'M4 7l6-3 6 3-6 3zM4 7v6l6 3 6-3V7M10 10v6', slab: 'M3 10l6-2 8 2-6 2zM3 10v2l8 2 6-2v-2M9 8v2', bar: 'M2 9l4-2 12 2-4 2zM2 9v3l12 2 4-2V9',
  wedge: 'M4 15V6l12 9zM4 6l4-2 12 9-4 2', slope: 'M3 15V11l14-6v10zM3 11l3-1', 'long-slope': 'M2 15v-2l16-6v8z', 'corner-out': 'M4 4h12v12L4 4zM4 4v12h12',
  'corner-in': 'M4 4h12L4 16zM16 4v12H4', plate: 'M3 11l7-3 7 3-7 3zM3 11v1l7 3 7-3v-1', block: 'M4 7l6-3 6 3-6 3zM4 7v6l6 3 6-3V7M10 10v6',
  'wide-slab': 'M2 10l8-3 8 3-8 3zM2 10v2l8 3 8-3v-2', 'long-bar': 'M2 9l3-2 13 2-3 2zM2 9v3l13 2 3-2V9', 'hull-section': 'M4 6l6-2 6 2-6 2zM4 6v8l6 3 6-3V6M10 8v9',
  'bow-wedge': 'M3 16V6l14 8zM3 6l4-2 14 8-4 2', 'tall-wedge': 'M5 17V3l10 14zM5 3l3-1 10 14-3 1',
};

export function ToolGlyph({ name }: { name: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d={TOOL_PATHS[name] ?? TOOL_PATHS.Part} strokeDasharray={name === 'Area' ? '3 2' : name === 'Split' ? undefined : undefined}/>
  </svg>;
}

export function SlotGlyph({ item, customMm, scale }: { item: SlotItem; customMm: number; scale?: ArmorScale }) {
  switch (item.kind) {
    case 'shape': return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true"><path d={SHAPE_PATHS[item.id] ?? SHAPE_PATHS.cube}/></svg>;
    case 'armor': case 'thickness': return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" fill={armorThicknessColor(item.kind === 'thickness' ? item.mm : customMm, scale)} stroke="#edf1ec55"/></svg>;
    case 'paint': return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" fill={item.color} stroke="#edf1ec55"/></svg>;
    case 'scheme': return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="7" fill={item.id === 'two-tone' ? '#64716f' : '#405d70'} stroke="#edf1ec55"/><rect x="3" y="10" width="14" height="7" fill={item.id === 'two-tone' ? '#7c8c91' : '#b5bfbc'} stroke="#edf1ec55"/></svg>;
    case 'opening': return <ToolGlyph name="Opening"/>;
    case 'tool': return <ToolGlyph name={item.name}/>;
    case 'part': return <ToolGlyph name={item.part.kind === 'gun' ? 'Fitting' : 'Part'}/>;
    default: return null;
  }
}

/** Count all derived physics cells, including compartment voids. Hull geometry
 * alone misses the subdivisions that dominate flooding and flotation work. */
export function enforceDerivedLimits(definition:any) {
  const volume=definition?.hull?.volume;
  if(!volume || !Array.isArray(volume.cells) || !Array.isArray(volume.surfaces)) throw new Error('Missing derived construction geometry');
  const cells=volume.cells.length + (definition.compartments ?? []).reduce((count:number,room:any)=>count+(room.volumes?.length ?? 0),0);
  if(cells>2048 || volume.surfaces.length>4096) throw new Error('Online limit: 2,048 derived cells (hull and compartments) and 4,096 surface patches');
}

/** Source bounds checked before the compiler runs. Design-local fitting instances (`partId: "design:…"`)
 * are counted apart from catalog equipment, as the compiler counts them. */
export function enforceSourceLimits(source:any) {
  const data=source?.construction;
  if(!Array.isArray(data?.primitives) || data.primitives.length>512 || !Array.isArray(data.equipment)) throw new Error('Online limit: 512 hull primitives and 32 equipment instances');
  const custom=data.equipment.filter((item:any)=>typeof item?.partId==='string' && item.partId.startsWith('design:')).length;
  if(data.equipment.length-custom>32) throw new Error('Online limit: 512 hull primitives and 32 equipment instances');
  if(data.fittings!==undefined && !Array.isArray(data.fittings)) throw new Error('Invalid custom fitting definitions');
  if((data.fittings?.length ?? 0)>16 || custom>96) throw new Error('Online limit: 16 custom fitting definitions and 96 custom fitting instances');
}

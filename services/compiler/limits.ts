/** Count all derived physics cells, including compartment voids. Hull geometry
 * alone misses the subdivisions that dominate flooding and flotation work. */
export function enforceDerivedLimits(definition:any) {
  const volume=definition?.hull?.volume;
  if(!volume || !Array.isArray(volume.cells) || !Array.isArray(volume.surfaces)) throw new Error('Missing derived construction geometry');
  const cells=volume.cells.length + (definition.compartments ?? []).reduce((count:number,room:any)=>count+(room.volumes?.length ?? 0),0);
  if(cells>2048 || volume.surfaces.length>4096) throw new Error('Online limit: 2,048 derived cells (hull and compartments) and 4,096 surface patches');
}

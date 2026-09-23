/** Online designs use the same limits as local ones: the native compiler enforces every count and
 * geometry bound itself, so the worker only checks the shape it relies on before and after compiling. */
export function enforceDerivedLimits(definition:any) {
  const volume=definition?.hull?.volume;
  if(!volume || !Array.isArray(volume.cells) || !Array.isArray(volume.surfaces)) throw new Error('Missing derived construction geometry');
}

/** Source shape checked before the compiler runs; counts are the compiler's local limits. */
export function enforceSourceLimits(source:any) {
  const data=source?.construction;
  if(!Array.isArray(data?.primitives) || !Array.isArray(data.equipment)) throw new Error('Invalid construction source');
  if(data.fittings!==undefined && !Array.isArray(data.fittings)) throw new Error('Invalid custom fitting definitions');
}

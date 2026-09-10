import catalog from '../../assets/aircraft/catalog.json';

const names = new Map((catalog as { aircraft: { id: string; name: string }[] }).aircraft.map(entry => [entry.id, entry.name]));
/** "Mitsubishi A6M2 Zero" reads as "A6M2 Zero" beside a count; the maker adds nothing on a chart. */
export function aircraftShortName(modelId: string | undefined): string | undefined {
  const name = modelId ? names.get(modelId) : undefined;
  if (!name) return undefined;
  const words = name.split(' ');
  return words.length > 1 ? words.slice(1).join(' ') : name;
}

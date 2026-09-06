export interface AircraftEntry {
  id: string; name: string; nation: string; role: string; year: number;
  length: number; wingspan: number;
  [key: string]: unknown;
}
export interface AircraftCatalog { schemaVersion: 1; aircraft: AircraftEntry[]; [key: string]: unknown }

export type ShapeStation = [number, number, number, number];
export interface AircraftShape {
  schemaVersion: 1; id: string;
  fuselage: ShapeStation[]; wing: ShapeStation[]; horizontalTail: ShapeStation[];
  canopy: ShapeStation[]; fin: [number, number][]; tailSpan: number;
  reference: { sourceUrl: string; imagePath: string; sourceTitle: string; [key: string]: unknown };
  cowling: { frontU: number; rearU: number; radiusM: number };
  propeller: { u: number; radiusM: number; blades: number; spinnerLengthM: number };
  gear: { mainU: number; trackM: number; wheelRadiusM: number; wheelZM: number; tailU: number; tailWheelZM: number };
  [key: string]: unknown;
}

/** Validate the measured source data before it can reach Blender. */
export function validateAircraftShape(input: unknown, aircraftId: string): AircraftShape {
  const require: (condition: unknown, message: string) => asserts condition = (condition, message) => {
    if (!condition) throw new Error(`${aircraftId}: invalid shape: ${message}`);
  };
  require(input && typeof input === 'object', 'expected an object');
  const shape = input as AircraftShape;
  require(shape.schemaVersion === 1 && shape.id === aircraftId, 'schemaVersion or aircraft ID does not match');
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const unit = (value: unknown) => finite(value) && value >= 0 && value <= 1;
  for (const key of ['fuselage', 'wing', 'horizontalTail', 'canopy'] as const) {
    const rows = shape[key];
    require(Array.isArray(rows) && rows.length >= 2 && rows.length <= 512, `${key} needs 2–512 stations`);
    for (const [index, row] of rows.entries()) {
      require(Array.isArray(row) && row.length === 4 && row.every(finite), `${key}[${index}] must contain four finite numbers`);
      require(unit(row[0]) && (index === 0 || rows[index - 1][0] < row[0]), `${key} stations must increase within 0..1`);
      if (key === 'fuselage' || key === 'canopy') {
        require(row[1] >= 0, `${key} width cannot be negative`);
        require(row[2] <= row[3], `${key} bottom/base must not exceed top`);
      } else {
        require(unit(row[1]) && unit(row[2]) && row[1] <= row[2], `${key} leading/trailing coordinates must increase within 0..1`);
      }
    }
    if (key === 'wing' || key === 'horizontalTail') require(rows[0][0] === 0 && rows.at(-1)![0] === 1, `${key} must cover centerline 0 through tip 1`);
  }
  require(Array.isArray(shape.fin) && shape.fin.length >= 3 && shape.fin.length <= 512 && shape.fin.every(row => Array.isArray(row) && row.length === 2 && unit(row[0]) && finite(row[1])), 'fin needs at least three finite [u,z] outline points');
  require(finite(shape.tailSpan) && shape.tailSpan > 0 && shape.tailSpan <= 100, 'invalid tailSpan');
  for (const key of ['sourceUrl', 'imagePath', 'sourceTitle'] as const) require(typeof shape.reference?.[key] === 'string' && shape.reference[key].trim().length > 0, `reference.${key} is required`);
  require(/^https?:\/\//.test(shape.reference.sourceUrl), 'reference.sourceUrl must identify an HTTP(S) source');
  const cowl = shape.cowling, prop = shape.propeller, gear = shape.gear;
  require(cowl && unit(cowl.frontU) && unit(cowl.rearU) && cowl.frontU < cowl.rearU && finite(cowl.radiusM) && cowl.radiusM > 0, 'invalid cowling');
  require(prop && unit(prop.u) && finite(prop.radiusM) && prop.radiusM > 0 && Number.isInteger(prop.blades) && prop.blades >= 2 && prop.blades <= 8 && finite(prop.spinnerLengthM) && prop.spinnerLengthM >= 0, 'invalid propeller');
  require(gear && unit(gear.mainU) && unit(gear.tailU) && finite(gear.trackM) && gear.trackM > 0 && finite(gear.wheelRadiusM) && gear.wheelRadiusM > 0 && finite(gear.wheelZM) && finite(gear.tailWheelZM), 'invalid gear');
  return shape;
}

export function validateAircraftCatalog(input: unknown): AircraftCatalog {
  if (!input || typeof input !== 'object') throw new Error('Aircraft catalog must be an object');
  const catalog = input as AircraftCatalog;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.aircraft) || catalog.aircraft.length === 0 || catalog.aircraft.length > 100) throw new Error('Expected aircraft catalog schemaVersion 1 and 1–100 entries');
  const ids = new Set<string>();
  for (const entry of catalog.aircraft) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Invalid or duplicate aircraft ID');
    ids.add(entry.id);
    for (const key of ['name', 'nation', 'role'] as const) if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 160) throw new Error(`${entry.id}: missing ${key}`);
    if (!Number.isInteger(entry.year) || entry.year < 1903 || entry.year > 1945) throw new Error(`${entry.id}: year must identify a WWII-era variant`);
    for (const key of ['length', 'wingspan'] as const) if (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]) || entry[key] < 1 || entry[key] > 100) throw new Error(`${entry.id}: invalid ${key} in meters`);
  }
  return catalog;
}

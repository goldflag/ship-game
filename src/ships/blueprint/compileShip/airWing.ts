/** Carrier air wing, squadrons and flight-deck layout. */
import { GAMEPLAY_AIRCRAFT } from '../blueprintTypes';
import { fail, record, text, numeric, list, id, vector, unique, type Rec } from '../validators';

export function validateAirWing(b: Rec, h: Rec, modules: Rec[]): void {
  if (b.airWing !== undefined) {
    const wing = record(b.airWing, 'airWing');
    if (wing.version !== 1) fail('airWing.version', 'expected version 1');
    for (const key of ['launchPosition', 'recoveryPosition']) {
      const p = vector(wing[key], `airWing.${key}`);
      if (Math.abs(p[0]) > (h.beam as number) / 2 || Math.abs(p[2]) > (h.length as number) / 2 || p[1] < 0 || p[1] > 40) fail(`airWing.${key}`, 'must be over the flight deck');
    }
    if (!modules.some(m => m.id === wing.serviceModuleId)) fail('airWing.serviceModuleId', 'unknown service module');
    numeric(wing.launchIntervalSeconds, 'airWing.launchIntervalSeconds', 1, 60);
    numeric(wing.rearmSeconds, 'airWing.rearmSeconds', 5, 600);
    for (const [key, max] of [['flightSize', 6], ['deckCapacity', 24], ['maxActiveFlights', 4]] as const) {
      numeric(wing[key], `airWing.${key}`, 1, max);
      if (!Number.isInteger(wing[key])) fail(`airWing.${key}`, 'expected an integer');
    }
    const squadrons = list(wing.squadrons, 'airWing.squadrons', 3).map(s => record(s, 'squadron'));
    if (!squadrons.length) fail('airWing.squadrons', 'requires aircraft');
    unique(squadrons, 'airWing.squadrons');
    for (const squadron of squadrons) {
      id(squadron.id, 'squadron.id'); text(squadron.name, 'squadron.name');
      if (!Object.hasOwn(GAMEPLAY_AIRCRAFT, String(squadron.modelId)) || GAMEPLAY_AIRCRAFT[String(squadron.modelId)] !== squadron.role) fail('squadron.modelId', 'unknown aircraft or incompatible role');
      numeric(squadron.count, 'squadron.count', 1, 36);
      if (!Number.isInteger(squadron.count)) fail('squadron.count', 'expected an integer');
    }
    if (squadrons.reduce((n, s) => n + Number(s.count), 0) > 96) fail('airWing.squadrons', 'maximum inventory is 96 aircraft');
    if (wing.deckLayout !== undefined) {
      const layout = record(wing.deckLayout, 'airWing.deckLayout');
      if (layout.version !== 1) fail('airWing.deckLayout.version', 'expected version 1');
      const deckStructures = list(b.structures, 'structures').map(s => record(s, 'structure'));
      const surface = deckStructures.find(s => s.id === layout.surfaceId);
      if (!surface) fail('airWing.deckLayout.surfaceId', 'unknown deck structure');
      const footprint = surface!.footprint as number[][];
      const onSurface = (x: number, z: number) => {
        let inside = false;
        for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
          const a = footprint[i], b = footprint[j];
          if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
      };
      const point = (value: unknown, path: string) => {
        const p = vector(value, path);
        if (Math.abs(p[0]) > (h.beam as number) || Math.abs(p[2]) > (h.length as number) * .55 || p[1] < 0 || p[1] > 40) fail(path, 'invalid deck position');
        if (!onSurface(p[0], p[2]) || Math.abs(p[1] - Number(surface!.baseY) - Number(surface!.height)) > .5) fail(path, 'must rest on the authored flight deck');
        return p;
      };
      const start = point(layout.launchStart, 'deckLayout.launchStart'), end = point(layout.launchEnd, 'deckLayout.launchEnd');
      const touchdown = point(layout.recoveryTouchdown, 'deckLayout.recoveryTouchdown'), stop = point(layout.recoveryStop, 'deckLayout.recoveryStop');
      if (end[2] >= start[2] - 30 || stop[2] >= touchdown[2] - 10) fail('airWing.deckLayout', 'launch and recovery paths must run toward the bow');
      const spots = list(layout.spots, 'deckLayout.spots', 100).map(s => record(s, 'deck spot'));
      if (!spots.length) fail('deckLayout.spots', 'requires parking positions');
      unique(spots, 'deckLayout.spots');
      for (const spot of spots) {
        id(spot.id, 'deck spot.id'); point(spot.position, 'deck spot.position');
        if (!['fighter', 'dive-bomber', 'torpedo-bomber'].includes(String(spot.preferredRole))) fail('deck spot.preferredRole', 'unknown aircraft role');
      }
      const elevators = list(layout.elevators, 'deckLayout.elevators', 8).map(e => record(e, 'elevator'));
      if (!elevators.length) fail('deckLayout.elevators', 'requires an elevator');
      unique(elevators, 'deckLayout.elevators');
      for (const elevator of elevators) {
        const structure = deckStructures.find(s => s.id === elevator.id);
        if (!structure) fail('elevator.id', 'unknown fitted elevator structure');
        const p = point(elevator.position, 'elevator.position');
        numeric(elevator.hangarY, 'elevator.hangarY', 0, p[1] - 2);
        numeric(elevator.widthM, 'elevator.widthM', 3, 30); numeric(elevator.lengthM, 'elevator.lengthM', 3, 30);
        const shape = structure!.footprint as number[][];
        const xs = shape.map(p => p[0]), zs = shape.map(p => p[1]);
        if (Number(elevator.widthM) > Math.max(...xs) - Math.min(...xs) + .001 || Number(elevator.lengthM) > Math.max(...zs) - Math.min(...zs) + .001) fail('elevator', 'operating dimensions exceed the fitted platform');
      }
    }
  }
}

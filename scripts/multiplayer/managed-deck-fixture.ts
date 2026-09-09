import legacy from '../../assets/gameplay/legacy-air.v1.json';
import type { AirRules } from '../../src/multiplayer/generated/AirRules';

/** Diagnostic content only. No published mission or compatibility asset changes. */
export function managedDeckFixture(bytes: Uint8Array) {
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  const rules: AirRules = { ...legacy, id: 'managed-deck-test-v1', groupSize: 4, deckCapacity: 24,
    activeFlights: { kind: 'unlimited' }, endurance: { kind: 'disabled' }, consolidation: 'hangar-compatible',
    deckCycle: { kind: 'managed', startupGroupsPerRole: 2,
      timings: { liftSeconds: 6, taxiSpeed: 12, turnRadiansPerSecond: .7, rearmSeconds: 35, repairSeconds: 90 } },
  };
  manifest.airProfiles.push(rules);
  return { manifest: new TextEncoder().encode(JSON.stringify(manifest)), airRules: rules };
}

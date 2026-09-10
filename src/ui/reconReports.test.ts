import { expect, test } from 'bun:test';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { ReconCoverage } from '../multiplayer/generated/ReconCoverage';
import { conditionReport, coveragePatches, reportPosition, reportState } from './reconReports';

const report: ContactTrack = { id:'contact-0-1',kind:'surface',affiliation:'hostile',status:'tracked',firstObservedTick:0,lastObservedTick:60,
  measuredPosition:[1000,0,2000],estimatedPosition:[1050,0,2000],velocity:[10,0,0],uncertaintyM:40,identificationConfidence:1,
  classification:'Small warship',identifiedPresetId:'fletcher',sources:[] };
test('current, predicted and stale positions remain distinct without reading an enemy actor', () => {
  expect(reportState(report,90)).toBe('current');
  expect(reportState({...report,status:'lost'},600)).toBe('estimated');
  const stale={...report,status:'stale' as const};
  expect(reportState(stale,6000)).toBe('last-known');
  expect(reportPosition(stale,6000)).toEqual(report.measuredPosition);
  expect(reportPosition(report,600)).toEqual(report.estimatedPosition);
});
test('condition wording describes observed cues and retains confirmation age', () => {
  expect(conditionReport(report,600)).toBe('Condition unconfirmed');
  const witnessed={...report,visibleCondition:{observedTick:120,fire:true,heavySmoke:true,listing:false,sinking:false}};
  expect(conditionReport(witnessed,600)).toBe('Fire visible · Heavy smoke · 8s ago');
  const sunk={...witnessed,visibleCondition:{...witnessed.visibleCondition,sinking:true}};
  expect(reportState(sunk,6000)).toBe('confirmed-sinking');
  expect(conditionReport(sunk,6000)).toBe('Sinking confirmed · 1m ago');
  expect(reportPosition(sunk,6000)).toEqual(report.measuredPosition);
});
test('coverage combines adjacent samples without bridging unsurveyed cells or different ages', () => {
  const coverage:ReconCoverage={cellSizeM:1000,target:'surface-vessel',referenceLengthM:100,referenceHeightM:5,sampleIntervalTicks:300,
    cells:[{x:500,z:500,lastObservedTick:6000},{x:1500,z:500,lastObservedTick:6000},{x:3500,z:500,lastObservedTick:6000},{x:4500,z:500,lastObservedTick:0}]};
  const patches=coveragePatches(coverage,6060);
  expect(patches).toHaveLength(3);
  expect(patches[0].points).toEqual([[0,0,0],[2000,0,0],[2000,0,1000],[0,0,1000]]);
  expect(patches.map(p=>p.age)).toEqual(['current','current','older']);
});

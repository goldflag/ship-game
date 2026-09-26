import type { CombatTelemetry } from '../game/session/telemetry';
import { scenarioForMission } from './battle/scenarios';
import './ObjectiveReadout.css';

/** What the clock runs down to in this battle: a scenario's deadline ("to dawn"), else plain time remaining. */
export const deadlineCaption = (combat: Pick<CombatTelemetry, 'objective'>) =>
  combat.objective ? (scenarioForMission(combat.objective.missionId)?.deadline ?? 'remaining') : 'remaining';

/** What the clock reaching zero is called in this battle. */
export const deadlineReached = (combat: Pick<CombatTelemetry, 'objective'>) =>
  (combat.objective && scenarioForMission(combat.objective.missionId)?.deadlineReached) || 'Time limit reached';

/** A scenario's protected ships still afloat, as a count beside the clock. */
export function ObjectiveReadout({ combat }: { combat: Pick<CombatTelemetry, 'objective'> }) {
  const objective = combat.objective;
  if (!objective?.protectedTotal) return null;
  const name = scenarioForMission(objective.missionId)?.protectedName ?? 'Protected ships';
  const lost = objective.protectedAfloat < objective.protectedTotal;
  return <span className="objective-readout" data-lost={lost} aria-label={`${name} afloat: ${objective.protectedAfloat} of ${objective.protectedTotal}`}>
    {name} <strong>{objective.protectedAfloat}/{objective.protectedTotal}</strong> afloat
  </span>;
}

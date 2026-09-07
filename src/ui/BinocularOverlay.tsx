import type { Telemetry } from '../game/types';
import './BinocularOverlay.css';

/** The eyepiece belongs to the camera view, so hiding instruments leaves it in place. */
export function BinocularOverlay({ data }: { data: Telemetry }) {
  const following = data.shellFollow === 'flight' || data.shellFollow === 'impact' || !!data.followedAircraftId;
  if (!data.binoculars || data.inspecting || following || data.airOperationsOpen) return null;

  return <div className="binocular-overlay" aria-hidden="true">
    <div className="binocular-eyepiece"/>
  </div>;
}

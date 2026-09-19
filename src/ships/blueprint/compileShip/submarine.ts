/** Submarine ballast, depth limits, engines and appendage joints. */
import { fail, record, text, numeric, list, id, vector, type Rec } from '../validators';

export function validateSubmarine(b: Rec, h: Rec, modules: Rec[]): void {
  if (b.submarine !== undefined) {
    const s = record(b.submarine, 'submarine');
    const handling = record(s.submergedHandling, 'submarine.submergedHandling');
    ['forwardSpeed', 'reverseSpeed', 'acceleration', 'braking', 'rudderRate', 'maxYawRate'].forEach((k) =>
      numeric(handling[k], `submarine.submergedHandling.${k}`, 0.00001, 100),
    );
    ['ballastCapacityM3', 'floodRateM3PerSecond', 'blowRateM3PerSecond', 'emergencyBlowRateM3PerSecond'].forEach((k) =>
      numeric(s[k], `submarine.${k}`, 0.01, 10000),
    );
    numeric(s.neutralBallastFraction, 'submarine.neutralBallastFraction', 0.1, 0.95);
    ['maxDiveSpeed', 'maxRiseSpeed'].forEach((k) => numeric(s[k], `submarine.${k}`, 0.1, 10));
    numeric(s.maxDepthM, 'submarine.maxDepthM', 10, 1000);
    numeric(s.periscopeDepthM, 'submarine.periscopeDepthM', 1, s.maxDepthM as number);
    numeric(s.maxTorpedoDepthM, 'submarine.maxTorpedoDepthM', s.periscopeDepthM as number, s.maxDepthM as number);
    const eye = vector(s.periscopeEye, 'submarine.periscopeEye');
    if (
      eye[1] <= (s.periscopeDepthM as number) ||
      eye[1] > 30 ||
      Math.abs(eye[0]) > (h.beam as number) / 2 ||
      Math.abs(eye[2]) > (h.length as number) / 2
    )
      fail('submarine.periscopeEye', 'must lie over the hull and above water at periscope depth');
    for (const key of ['surfaceEngineIds', 'submergedEngineIds']) {
      const ids = list(s[key], `submarine.${key}`, 16);
      if (!ids.length || new Set(ids).size !== ids.length) fail(`submarine.${key}`, 'requires distinct engine IDs');
      ids.forEach((value) => {
        id(value, key);
        if (!modules.some((m) => m.id === value && m.kind === 'engine')) fail(`submarine.${key}`, 'unknown engine module');
      });
    }
    const appendages = record(s.appendages, 'submarine.appendages'),
      joints = new Set<string>();
    for (const key of ['bowPlanes', 'sternPlanes', 'rudders', 'propellers'])
      list(appendages[key], `submarine.appendages.${key}`, 8).forEach((value) => {
        const joint = text(value, 'appendage joint');
        if (!/^[a-z][a-z0-9.-]{0,95}$/.test(joint) || joints.has(joint)) fail('submarine.appendages', 'requires distinct stable joint IDs');
        joints.add(joint);
      });
  }
}

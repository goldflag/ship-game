/** Published visual catalog; aircraft remain separate from ship definitions. */
export interface Aircraft {
  id: string;
  name: string;
  nation: string;
  role: string;
  year: number;
  length: number;
  wingspan: number;
  modelUrl: string;
  lods?: { level: number; modelUrl: string }[];
}

/** Discovery suggestions from the WoWS aircraft library, not approved variant matches.
 * Source: https://gamemodels3d.com/en/games/worldofwarships/misc/fighter
 * (the page embeds all aircraft categories). Verified 2026-09-09.
 */
export const suggestedAircraft: Record<string, { id: string; note?: string }> = {
  'a6m2-zero': { id: 'pjaf022' },
  'a6m5-zero': { id: 'pjaf011' },
  'd3a1-val': { id: 'pjad106', note: 'Source lists D3A Val; verify its fitted variant.' },
  'b5n2-kate': { id: 'pjab206' },
  'd4y2-judy': { id: 'pjad007', note: 'Source is the radial-engine D4Y3, not our inline-engine D4Y2. Use it only as a related variant.' },
  'b6n2-jill': { id: 'pjab998', note: 'Source lists B6N Tenzan; verify its fitted variant.' },
  'f4f-4-wildcat': { id: 'paaf030' },
  'sbd-3-dauntless': { id: 'paad202', note: 'Source lists SBD-4; our model is SBD-3.' },
  'tbd-1-devastator': { id: 'paab201', note: 'Source lists TBD Devastator; verify its fitted variant.' },
  'f6f-5-hellcat': { id: 'paaf002' },
  'sb2c-4-helldiver': { id: 'paad998', note: 'Source lists SB2C Helldiver; verify its fitted variant.' },
  'tbf-1c-avenger': { id: 'paab508', note: 'Source lists TBF Avenger; verify its fitted variant.' },
  'f4u-1d-corsair': { id: 'paaf208' },
};

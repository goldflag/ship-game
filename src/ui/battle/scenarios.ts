/** The Scenarios mode's actions: hand-authored battles fought where and when they happened. The simulation content
 * (fleets, positions, the raid's plans, scoring) is `assets/gameplay/scenarios/<id>.v1.json`; this file holds the
 * words around it. Only the owner's side of that content is shown: the raid's force and plans stay hidden. */
import savoIsland from '../../../assets/gameplay/scenarios/savo-island.v1.json';
import type { OceanMapId } from '../../maps/catalog';
import type { WithdrawReason } from '../../multiplayer/generated/WithdrawReason';
import type { ScenarioDebrief } from '../../game/session/BattleSession';

type ScenarioContent = typeof savoIsland;
export interface ScenarioInfo {
  id: string;
  /** The mission rules' id: how a running battle finds its scenario. */
  missionId: string;
  mapId: OceanMapId;
  title: string;
  date: string;
  place: string;
  /** One line under the title. */
  summary: string;
  situation: readonly string[];
  /** What the clock runs down to, as the HUD words it: "to dawn". */
  deadline: string;
  /** What the clock reaching zero is called: "Dawn". */
  deadlineReached: string;
  /** What the protected ships are called: "Transports". */
  protectedName: string;
  /** What the enemy is called in the result: "The raiders". */
  enemyName: string;
  /** Why the raid left, in the result's words. */
  withdrawal: Record<WithdrawReason, string>;
  /** Each of the raid's plans, revealed after the battle: "came through the south channel for your cruisers". */
  plans: Record<string, string>;
  /** The ships' own names by their ids in the content, both sides; the raid's appear only after the battle. */
  shipNames: Record<string, string>;
  /** Stand-in classes, said once. */
  note: string;
  content: ScenarioContent;
}

export const SCENARIOS: readonly ScenarioInfo[] = [
  {
    id: 'savo-island',
    missionId: savoIsland.mission.id,
    mapId: savoIsland.mapId as OceanMapId,
    title: 'Savo Island',
    date: '9 August 1942',
    place: 'Iron Bottom Sound, off Guadalcanal',
    summary: 'Guard the transports off Lunga Point until dawn.',
    situation: [
      'Two days after the landings on Guadalcanal, the transports are still unloading off Lunga Point. Your cruisers and destroyers screen the channels on either side of Savo Island, and two picket destroyers watch the western approaches.',
      'A search plane has reported Japanese cruisers coming down the Slot. Nobody knows when they will arrive, which channel they will take, or whether they are after your cruisers or the transports.',
      'Their lookouts see further at night than yours. Gun flashes and fires show a ship far beyond what the lookouts can make out, on either side.',
    ],
    deadline: 'to dawn',
    deadlineReached: 'Dawn',
    protectedName: 'Transports',
    enemyName: 'The raiders',
    withdrawal: {
      completed: 'The raiders withdrew after their attack',
      losses: 'The raiders broke off after heavy losses',
      dawn: 'The raiders turned for home before dawn',
    },
    plans: {
      'south-sweep': 'The raid came through the south channel for your cruisers, as Mikawa did.',
      'north-sweep': 'The raid came round the north of Savo for your cruisers.',
      'south-strike': 'The raid came through the south channel for the transports.',
      'north-strike': 'The raid came round the north of Savo for the transports.',
    },
    shipNames: {
      canberra: 'HMAS Canberra', chicago: 'USS Chicago', bagley: 'USS Bagley', patterson: 'USS Patterson',
      vincennes: 'USS Vincennes', quincy: 'USS Quincy', helm: 'USS Helm', wilson: 'USS Wilson',
      blue: 'USS Blue', 'ralph-talbot': 'USS Ralph Talbot', 'san-juan': 'USS San Juan',
      barnett: 'USS Barnett', 'george-f-elliott': 'USS George F. Elliott', 'hunter-liggett': 'USS Hunter Liggett', fuller: 'USS Fuller',
      chokai: 'Chōkai', aoba: 'Aoba', kako: 'Kako', kinugasa: 'Kinugasa', furutaka: 'Furutaka', tenryu: 'Tenryū', yunagi: 'Yūnagi',
    },
    note: 'Their classes stand in for the ships that fought here: BALTIMORE for the heavy cruisers, CLEVELAND for the light cruiser, GLEAVES and FLETCHER for the destroyers, merchant hulls for the transports.',
    content: savoIsland,
  },
];
export const scenarioInfo = (id: string | undefined) => SCENARIOS.find(scenario => scenario.id === id);
/** The scenario a running battle belongs to, found by its mission rules. */
export const scenarioForMission = (missionId: string | undefined) => SCENARIOS.find(scenario => scenario.missionId === missionId);

/** The scoring rules in words, from the content so the two never disagree. */
export function scenarioOrders(scenario: ScenarioInfo): string[] {
  const { objective, durationSeconds } = scenario.content.mission;
  const exposure = objective.exposedAtDeadline;
  return [
    `Keep the ${scenario.protectedName.toLowerCase()} afloat: each one sunk gives the enemy ${objective.protectedPoints} points.`,
    `Sink the raiders: ${objective.pointsPerKilotonne} point per 1,000 tonnes, and the same to them for yours.`,
    `Dawn comes in ${Math.round(durationSeconds / 60)} minutes. Raiders still in the sound then are caught by carrier aircraft: ${exposure.pointsPerKilotonne} point per 1,000 tonnes.`,
    'The side with more points wins. Sinking everything is not required.',
  ];
}
/** A group's opening orders, briefly. */
export const openingText = (orders: ScenarioContent['groups'][number]['orders']) =>
  orders.type === 'patrol' && orders.speedMps !== undefined ? `Patrolling at ${Math.round(orders.speedMps * 1.944)} kn` : 'At anchor';

/** The result's reason line for a scenario: why the raid left, or that the deadline came. */
export function scenarioReason(scenario: ScenarioInfo, debrief: ScenarioDebrief, reason: string): string | undefined {
  if (reason === 'withdrawal' && debrief.withdrawal) return scenario.withdrawal[debrief.withdrawal];
  if (reason === 'time-limit') {
    const caught = debrief.lines.filter(line => line.kind === 'exposed').length;
    return caught ? `${scenario.deadlineReached} found ${caught} ${caught === 1 ? 'raider' : 'raiders'} still in the sound` : `${scenario.deadlineReached} came`;
  }
  return undefined;
}
/** Victory points by where they came from, for one side. */
export function pointSources(debrief: ScenarioDebrief, team: 'friendly' | 'enemy'): { label: string; points: number }[] {
  const lines = debrief.lines.filter(line => line.team === team);
  const sum = (kind: ScenarioDebrief['lines'][number]['kind']) => lines.filter(line => line.kind === kind);
  const entry = (kind: ScenarioDebrief['lines'][number]['kind'], one: string, many: string) => {
    const matching = sum(kind);
    return matching.length ? [{ label: `${matching.length} ${matching.length === 1 ? one : many}`, points: matching.reduce((n, line) => n + line.points, 0) }] : [];
  };
  return [
    ...entry('protected', 'transport sunk', 'transports sunk'),
    ...entry('sunk', 'warship sunk', 'warships sunk'),
    ...entry('exposed', 'caught at dawn', 'caught at dawn'),
  ];
}
/** A scenario ship's own name in capitals, as historical ships are titled; undefined outside a scenario. */
export const scenarioShipTitle = (scenario: ScenarioInfo | undefined, shipId: string) => scenario?.shipNames[shipId]?.toUpperCase();

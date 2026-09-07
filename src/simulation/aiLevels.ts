/** Crew tuning changes decisions, never ship durability, weapon stats or physics. */
export const SHIP_AI_LEVELS = [
  { id: 'static', name: '1 · Static target', description: 'Stays still. Does not attack.' },
  { id: 'moving', name: '2 · Moving target', description: 'Sails a steady course. Does not attack.' },
  { id: 'easy', name: '3 · Easy', description: 'Slow reactions and less accurate fire.' },
  { id: 'normal', name: '4 · Normal', description: 'Balanced reactions, aim and maneuvers.' },
  { id: 'hard', name: '5 · Hard', description: 'Fast tracking, accurate fire and quicker evasive reactions.' },
] as const;
export type ShipAiLevel = typeof SHIP_AI_LEVELS[number]['id'];
export const DEFAULT_AI_LEVEL: ShipAiLevel = 'normal';
export const isShipAiLevel = (value: unknown): value is ShipAiLevel => SHIP_AI_LEVELS.some(level => level.id === value);
export const isPassiveAi = (level: ShipAiLevel | undefined): boolean => level === 'static' || level === 'moving';

interface CrewSkill {
  reactionScale: number;
  openingDelay: readonly [number, number];
  reacquireDelay: readonly [number, number];
  settleSeconds: number;
  velocityBlend: number;
  aimErrorScale: number;
  cadenceScale: number;
  maneuverDelay: readonly [number, number];
  evadeDamage: number;
}
const NORMAL_SKILL: CrewSkill = {
  reactionScale: 1, openingDelay: [8, 14], reacquireDelay: [3, 6], settleSeconds: 45,
  velocityBlend: .55, aimErrorScale: 1, cadenceScale: 1, maneuverDelay: [22, 38], evadeDamage: 15,
};
const CREW_SKILLS: Record<'easy' | 'normal' | 'hard', CrewSkill> = {
  easy: { reactionScale: 2.5, openingDelay: [16, 24], reacquireDelay: [7, 11], settleSeconds: 80,
    velocityBlend: .3, aimErrorScale: 2, cadenceScale: 3, maneuverDelay: [35, 50], evadeDamage: 35 },
  normal: NORMAL_SKILL,
  hard: { reactionScale: .4, openingDelay: [4, 7], reacquireDelay: [1, 2], settleSeconds: 22,
    velocityBlend: .85, aimErrorScale: .5, cadenceScale: .35, maneuverDelay: [14, 24], evadeDamage: 7 },
};
export const crewSkill = (level: ShipAiLevel): CrewSkill => level === 'easy' || level === 'hard' ? CREW_SKILLS[level] : NORMAL_SKILL;

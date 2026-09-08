import type { CombatSimulation } from '../../simulation/combat';
import type { Vec3 } from '../../ships/blueprint';
/** Renderer-facing state and addressed intent. Neither ShipView nor Game owns
 * collision, weapon or damage decisions for a snapshot-backed session. */
export interface BattleSession extends Pick<CombatSimulation, keyof CombatSimulation> {
 readonly networked?: boolean;
 readonly phase?: string;
 readonly connectionStatus?: string;
 dispose?(): void;
 setDepth?(depthM: number, emergency?: boolean): void;
 selectShip?(id: string): boolean;
 moveShip?(id: string, point: Vec3): void;
 focusShip?(id: string, targetId: string): void;
 holdShip?(id: string): void;
 automateShip?(id: string): void;
 surrender?(): void;
}

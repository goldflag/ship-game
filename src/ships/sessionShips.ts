import type { LocalShipRevision } from './localShips';
import { onAccountChange } from '../accounts/session';
// The active battle owns these immutable presentation references. They are never
// enumerated as library designs and disappear when that session is disposed.
let active: {owner:object; ships:ReadonlyMap<string,LocalShipRevision>} | undefined;
export function bindSessionShips(owner:object,ships:ReadonlyMap<string,LocalShipRevision>) { active={owner,ships}; }
export function releaseSessionShips(owner:object) { if(active?.owner===owner)active=undefined; }
export const sessionShip=(id:string)=>active?.ships.get(id);
onAccountChange(()=>{active=undefined;});
